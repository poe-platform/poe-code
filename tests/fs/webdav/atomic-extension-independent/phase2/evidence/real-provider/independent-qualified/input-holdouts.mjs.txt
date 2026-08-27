import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, lstat, readdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { FsError, WebDavFileSystem, createMountFileSystem, createMemoryFileSystem } from "virtual-bash";
import { createApplication, createAtomicBinding, operation } from "./example.mjs";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const output = process.argv[3];
const events = [];
const app = await createApplication(config, events);
const binary = Buffer.from("00ff80410d0a", "hex");
const native = path => join(config.serverRoot, "extension", path.replace(/^\//u, ""));
const url = path => `${config.namespaceUrl}${path.slice(1).split("/").map(encodeURIComponent).join("/")}/`;
const rows = [];
const replies = [];
const tokens = new Map();
const gates = [];
const authOther = `Basic ${Buffer.from("other:other-fixture-password").toString("base64")}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = path => lstat(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
const trace = async () => (await readFile(join(config.controlRoot, "independent.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const pathEvents = (entries, path) => entries.filter(entry => entry.path?.replace(/\/$/u, "") === path);
const rejected = (code, path) => error => {
  assert.ok(error instanceof FsError);
  assert.equal(error.code, code);
  if (path) { assert.equal(error.path, path); assert.equal(error.syscall, "rmdir"); }
  return true;
};
async function settings(value = {}) { await writeFile(join(config.controlRoot, "settings.json"), JSON.stringify(value)); }
async function witness(path) {
  try {
    const observed = await lstat(path);
    return { dev: observed.dev, ino: observed.ino, type: observed.isDirectory() ? "directory" : "file",
      ...(observed.isDirectory() ? { entries: (await readdir(path)).sort() } : { hex: (await readFile(path)).toString("hex") }) };
  } catch (error) { if (error.code === "ENOENT") return { code: "ENOENT" }; throw error; }
}
async function row(name, kind, paths, body) {
  const start = events.length;
  const replyStart = replies.length;
  const traceStart = (await trace()).length;
  const result = { name, kind, result: "fail", before: Object.fromEntries(await Promise.all(paths.map(async path => [path, await witness(path)]))) };
  try { await body(); result.result = kind === "mutation" ? "killed" : "pass"; }
  catch (error) { result.error = { message: String(error), code: error.code, stack: error.stack }; }
  finally {
    for (const identifier of gates) await writeFile(join(config.controlRoot, `release-${identifier}`), "release");
    await settings();
    result.after = Object.fromEntries(await Promise.all(paths.map(async path => [path, await witness(path)])));
    result.wire = events.slice(start);
    result.replies = replies.slice(replyStart);
    result.trace = (await trace()).slice(traceStart);
    rows.push(result);
    await writeFile(join(output, "rows.json"), JSON.stringify(rows, null, 2));
    console.log(result.result, name, result.error?.message ?? "");
  }
}
async function raw(path, method, headers = {}, body, destination = url(path)) {
  const response = await app.fetch(destination, { method, headers: { Authorization: config.authorization, ...headers },
    ...(body === undefined ? {} : { body }), redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(10000) });
  const result = { status: response.status, headers: Object.fromEntries(response.headers), text: await response.text() };
  replies.push({ path, method, ...result });
  return result;
}
async function atomic(path, headers = {}) {
  return raw(path, "DELETE", { Depth: "infinity", "X-Atomic-Empty-Directory": operation,
    "X-Atomic-Namespace": config.namespaceUrl, "X-Atomic-Path": Buffer.from(path).toString("base64url"), ...headers });
}
async function wrongHost(path) {
  const ca = await readFile(config.caFile);
  const destination = url(path);
  const headers = { Authorization: config.authorization, Host: "wrong.invalid", Depth: "infinity",
    "X-Atomic-Empty-Directory": operation, "X-Atomic-Namespace": config.namespaceUrl,
    "X-Atomic-Path": Buffer.from(path).toString("base64url") };
  const result = await new Promise((resolve, reject) => {
    const outgoing = httpsRequest(destination, { method: "DELETE", headers, ca, servername: "", agent: false }, response => {
      const chunks = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) outgoing.destroy(new Error("bounded wrong-Host response exceeded")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, tlsAuthorized: response.socket.authorized,
        headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    outgoing.on("error", reject); outgoing.setTimeout(5000, () => outgoing.destroy(new Error("wrong-Host deadline"))); outgoing.end();
  });
  replies.push({ method: "DELETE", path, destination, requestHeaders: headers, independentRawTlsControl: true, ...result });
  assert.equal(result.tlsAuthorized, true);
  return result;
}
async function lock(path, options = {}) {
  const result = await raw(path, "LOCK", { Depth: options.depth ?? "infinity", Timeout: options.timeout ?? "Second-60",
    "Content-Type": "application/xml", ...(options.authorization ? { Authorization: options.authorization } : {}) },
  '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>');
  assert.equal(result.status, 200);
  const token = /<(?:\w+:)?locktoken[^>]*>\s*<(?:\w+:)?href[^>]*>([^<]+)/u.exec(result.text)?.[1];
  assert.match(token ?? "", /^opaquelocktoken:/u);
  tokens.set(token, { path, authorization: options.authorization ?? config.authorization });
  return token;
}
async function unlock(token) {
  const entry = tokens.get(token);
  assert.ok(entry);
  const result = await raw(entry.path, "UNLOCK", { "Lock-Token": `<${token}>`, Authorization: entry.authorization });
  assert.equal(result.status, 204);
  tokens.delete(token);
}
async function discovery(path) {
  return raw(path, "PROPFIND", { Depth: "0", "Content-Type": "application/xml" },
    '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>');
}
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 6000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(message); await pause(10); }
}
async function gate(path, stage = "before-native") {
  const id = `${gates.length}-${path.slice(1).replaceAll("/", "-")}`;
  gates.push(id);
  await settings({ gate: { path, stage, id } });
  return { entered: () => waitUntil(() => exists(join(config.controlRoot, `entered-${id}`)), "native gate not entered"),
    release: () => writeFile(join(config.controlRoot, `release-${id}`), "release") };
}
async function assertWaiting(path, method, managerMethod) {
  await waitUntil(async () => pathEvents(await trace(), path).some(entry => entry.event === "provider-arrival" && entry.method === method), "competing request never reached real provider");
  await pause(80);
  assert.ok(!pathEvents(await trace(), path).some(entry => entry.event === `manager-${managerMethod}-enter` && entry.method === method), "actual manager changed inside serialized native interval");
}
async function caughtGuard(body) {
  let observed;
  try { await body(); } catch (error) { observed = { message: String(error), code: error.code }; }
  assert.ok(observed, "mutation survived strict guard");
  replies.push({ mutationCaughtByUnchangedGuard: observed });
}

try {
  await settings();
  await row("real handler checks precede native empty-only call, no recursive visitation", "positive", [native("ind-empty")], async () => {
    await mkdir(native("ind-empty"));
    const start = (await trace()).length;
    await app.dav.rmdir("/ind-empty/");
    assert.equal(await exists(native("ind-empty")), false);
    const observed = pathEvents((await trace()).slice(start), "/ind-empty");
    const parent = observed.find(entry => entry.event === "standard-check-return");
    const target = observed.find(entry => entry.event === "manager-check_write_permission-enter" && entry.arguments.depth === "infinity");
    const effect = observed.find(entry => entry.event === "os.rmdir-enter");
    assert.ok(parent && target && effect && parent.seq < target.seq && target.seq < effect.seq);
    assert.equal(observed.filter(entry => entry.event === "os.rmdir-return").length, 1);
    assert.ok(!observed.some(entry => entry.event === "base-descendants" && entry.method === "DELETE"));
  });

  for (const [name, authorization, status] of [["missing", "", 401], ["bad-password", `Basic ${Buffer.from("fixture:wrong").toString("base64")}`, 401], ["second-principal", authOther, 403]]) {
    const path = `/ind-auth-${name}`;
    await row(`actual auth ${name} preserves empty target`, "guard", [native(path)], async () => {
      await mkdir(native(path));
      const start = (await trace()).length;
      assert.equal((await atomic(path, { Authorization: authorization })).status, status);
      const observed = pathEvents((await trace()).slice(start), path);
      assert.ok(!observed.some(entry => entry.event === "os.rmdir-enter"));
      if (status === 401) assert.ok(!observed.some(entry => entry.event === "provider-arrival"));
      else assert.ok(observed.some(entry => entry.authenticated === "other"));
      assert.equal(await exists(native(path)), true);
    });
  }

  await row("native nonempty preserves exact binary bytes", "guard", [native("ind-nonempty"), native("ind-nonempty/child")], async () => {
    await mkdir(native("ind-nonempty")); await writeFile(native("ind-nonempty/child"), binary);
    await assert.rejects(app.dav.rmdir("/ind-nonempty/"), rejected("ENOTEMPTY", "/ind-nonempty/"));
    assert.deepEqual(await readFile(native("ind-nonempty/child")), binary);
  });
  await row("late native membership bypasses provider mutex but survives os.rmdir", "guard", [native("ind-native-race"), native("ind-native-race/child")], async () => {
    await mkdir(native("ind-native-race"));
    const held = await gate("/ind-native-race");
    const pending = assert.rejects(app.dav.rmdir("/ind-native-race"), rejected("ENOTEMPTY", "/ind-native-race"));
    await held.entered();
    await writeFile(native("ind-native-race/child"), binary);
    await held.release(); await pending;
    assert.deepEqual(await readFile(native("ind-native-race/child")), binary);
  });

  await row("actual target lock denies missing/wrong tokens, owner token removes", "positive", [native("ind-token")], async () => {
    await mkdir(native("ind-token"));
    const token = await lock("/ind-token");
    await assert.rejects(app.dav.rmdir("/ind-token"), rejected("EBUSY", "/ind-token"));
    assert.equal((await atomic("/ind-token", { If: "(<opaquelocktoken:wrong>)" })).status, 412);
    assert.match((await discovery("/ind-token")).text, /activelock/u);
    assert.equal((await atomic("/ind-token", { If: `(<${token}>)` })).status, 204);
    tokens.delete(token);
    assert.equal(await exists(native("ind-token")), false);
  });
  await row("another principal's genuine token cannot authorize fixture removal", "guard", [native("ind-other-lock")], async () => {
    await mkdir(native("ind-other-lock"));
    const token = await lock("/ind-other-lock", { authorization: authOther });
    assert.equal((await atomic("/ind-other-lock", { If: `(<${token}>)` })).status, 412);
    assert.equal(await exists(native("ind-other-lock")), true);
    await unlock(token);
  });
  for (const depth of ["0", "infinity"]) {
    const parent = `/ind-parent-${depth}`;
    await row(`actual parent ${depth} lock and tagged token`, "positive", [native(`${parent}/empty`)], async () => {
      await mkdir(native(`${parent}/empty`), { recursive: true });
      const token = await lock(parent, { depth });
      const before = (await trace()).length;
      assert.equal((await atomic(`${parent}/empty`)).status, 423);
      assert.ok(!pathEvents((await trace()).slice(before), `${parent}/empty`).some(entry => entry.event === "os.rmdir-enter"));
      assert.equal((await atomic(`${parent}/empty`, { If: `<${url(parent)}> (<${token}>)` })).status, 204);
      await unlock(token);
    });
  }
  await row("actual descendant lock fails before native call, binary child intact", "guard", [native("ind-descendant/child")], async () => {
    await mkdir(native("ind-descendant")); await writeFile(native("ind-descendant/child"), binary);
    const token = await lock("/ind-descendant/child");
    const start = (await trace()).length;
    assert.equal((await atomic("/ind-descendant")).status, 423);
    const observed = pathEvents((await trace()).slice(start), "/ind-descendant");
    assert.ok(observed.some(entry => entry.event === "manager-check_write_permission-rejected"));
    assert.ok(!observed.some(entry => entry.event === "os.rmdir-enter"));
    assert.deepEqual(await readFile(native("ind-descendant/child")), binary);
    await unlock(token);
  });
  await row("expired actual target token is not accepted, unlocked removal works", "positive", [native("ind-expired")], async () => {
    await mkdir(native("ind-expired"));
    const token = await lock("/ind-expired", { timeout: "Second-1" });
    await pause(1300);
    assert.equal((await atomic("/ind-expired", { If: `(<${token}>)` })).status, 412);
    assert.doesNotMatch((await discovery("/ind-expired")).text, /activelock/u);
    tokens.delete(token);
    await app.dav.rmdir("/ind-expired");
  });

  await row("contending target LOCK reaches provider but cannot grant before native failure", "guard", [native("ind-serialize/child")], async () => {
    await mkdir(native("ind-serialize")); await writeFile(native("ind-serialize/child"), binary);
    const held = await gate("/ind-serialize");
    const pendingDelete = atomic("/ind-serialize");
    await held.entered();
    const pendingLock = lock("/ind-serialize");
    await assertWaiting("/ind-serialize", "LOCK", "acquire");
    await held.release();
    const deletion = await pendingDelete;
    assert.equal(deletion.status, 409); assert.equal(deletion.headers["x-atomic-error"], "ENOTEMPTY");
    const token = await pendingLock;
    const observed = pathEvents(await trace(), "/ind-serialize");
    assert.ok(observed.find(entry => entry.event === "os.rmdir-error").seq < observed.find(entry => entry.event === "manager-acquire-return").seq);
    assert.deepEqual(await readFile(native("ind-serialize/child")), binary);
    await unlock(token);
  });
  await row("actual expiry and new parent grant serialize after successful native removal", "positive", [native("ind-expiry-parent/empty")], async () => {
    await mkdir(native("ind-expiry-parent/empty"), { recursive: true });
    const oldToken = await lock("/ind-expiry-parent", { timeout: "Second-1" });
    const held = await gate("/ind-expiry-parent/empty");
    const deletion = atomic("/ind-expiry-parent/empty", { If: `(<${oldToken}>)` });
    await held.entered(); await pause(1300);
    const start = (await trace()).length;
    const nextLock = lock("/ind-expiry-parent");
    await waitUntil(async () => (await trace()).slice(start).some(entry => entry.path === "/ind-expiry-parent/" && entry.event === "provider-arrival" && entry.method === "LOCK"), "queued parent LOCK missing");
    await pause(80);
    assert.ok(!(await trace()).slice(start).some(entry => entry.event === "manager-acquire-enter"));
    await held.release(); assert.equal((await deletion).status, 204);
    const nextToken = await nextLock; tokens.delete(oldToken);
    const observed = (await trace()).slice(start);
    assert.ok(observed.find(entry => entry.event === "os.rmdir-return").seq < observed.find(entry => entry.event === "manager-acquire-return").seq);
    await unlock(nextToken);
  });
  for (const action of ["refresh", "unlock"]) {
    const parent = `/ind-${action}`;
    await row(`real ${action} waits through permission/native interval`, "positive", [native(`${parent}/empty`)], async () => {
      await mkdir(native(`${parent}/empty`), { recursive: true });
      const token = await lock(parent);
      const held = await gate(`${parent}/empty`);
      const deletion = atomic(`${parent}/empty`, { If: `(<${token}>)` });
      await held.entered();
      const pending = action === "refresh" ? raw(parent, "LOCK", { If: `(<${token}>)`, Timeout: "Second-60" }) : raw(parent, "UNLOCK", { "Lock-Token": `<${token}>` });
      await assertWaiting(parent, action === "refresh" ? "LOCK" : "UNLOCK", action === "refresh" ? "refresh" : "release");
      await held.release(); assert.equal((await deletion).status, 204);
      assert.equal((await pending).status, action === "refresh" ? 200 : 204);
      if (action === "refresh") await unlock(token); else tokens.delete(token);
    });
  }
  await row("DAV membership PUT cannot interleave into removed parent", "guard", [native("ind-put-race"), native("ind-put-race/child")], async () => {
    await mkdir(native("ind-put-race"));
    const held = await gate("/ind-put-race");
    const deletion = atomic("/ind-put-race"); await held.entered();
    const put = raw("/ind-put-race/child", "PUT", {}, binary, url("/ind-put-race/child").replace(/\/$/u, ""));
    await waitUntil(async () => pathEvents(await trace(), "/ind-put-race/child").some(entry => entry.event === "provider-arrival"), "PUT never arrived");
    assert.ok(!pathEvents(await trace(), "/ind-put-race/child").some(entry => entry.event === "serialized-dispatch"));
    await held.release(); assert.equal((await deletion).status, 204); assert.equal((await put).status, 409);
    assert.equal(await exists(native("ind-put-race/child")), false);
  });

  await row("wrong operation/path/namespace/Host/query refuse before native effect", "guard", [native("ind-binding")], async () => {
    await mkdir(native("ind-binding"));
    for (const [headers, status] of [[{ "X-Atomic-Empty-Directory": "v0" }, 400], [{ "X-Atomic-Path": Buffer.from("/wrong").toString("base64url") }, 400],
      [{ "X-Atomic-Namespace": config.stockUrl }, 409]]) {
      assert.equal((await atomic("/ind-binding", headers)).status, status);
    }
    assert.equal((await wrongHost("/ind-binding")).status, 409);
    assert.equal((await raw("/ind-binding", "DELETE", { "X-Atomic-Empty-Directory": operation, "X-Atomic-Namespace": config.namespaceUrl,
      "X-Atomic-Path": Buffer.from("/ind-binding").toString("base64url") }, undefined, `${url("/ind-binding")}?wrong=1`)).status, 409);
    assert.ok(!pathEvents(await trace(), "/ind-binding").some(entry => entry.event === "os.rmdir-enter"));
    assert.equal(await exists(native("ind-binding")), true);
  });
  await row("real stock default and positive-HTTP probe both refuse before DELETE", "refusal", [join(config.serverRoot, "stock/ind-empty")], async () => {
    await mkdir(join(config.serverRoot, "stock/ind-empty"));
    const start = events.length;
    await assert.rejects(app.stock.rmdir("/ind-empty"), rejected("ENOTSUP", "/ind-empty"));
    const fs = new WebDavFileSystem({ baseUrl: config.stockUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
      atomicEmptyDirectory: createAtomicBinding(config.stockUrl, app.fetch, config.authorization) });
    await assert.rejects(fs.rmdir("/ind-empty"), rejected("ENOTSUP", "/ind-empty"));
    assert.ok(events.slice(start).some(entry => entry.method === "OPTIONS" && entry.status === 200));
    assert.ok(events.slice(start).every(entry => entry.method !== "DELETE"));
  });
  for (const change of ["missing-capability", "wrong-namespace"]) {
    await row(`real probe response ${change} is refused, no DELETE`, "guard", [native("ind-binding")], async () => {
      const transport = async (target, init) => {
        const response = await app.fetch(target, init);
        if (init.method !== "OPTIONS") return response;
        const headers = new Headers(response.headers);
        if (change === "missing-capability") headers.delete("X-Atomic-Capability"); else headers.set("X-Atomic-Namespace", config.stockUrl);
        return new Response(response.body, { status: response.status, headers });
      };
      const fs = new WebDavFileSystem({ baseUrl: config.namespaceUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
        atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, transport, config.authorization) });
      const start = events.length;
      await assert.rejects(fs.rmdir("/ind-binding"), rejected("ENOTSUP", "/ind-binding"));
      assert.ok(events.slice(start).every(entry => entry.method !== "DELETE"));
    });
  }
  await row("replaced configured native root is refused before native removal", "guard", [native("ind-root-binding")], async () => {
    const root = native(""); const moved = `${root}-temporarily-moved`;
    await rename(root, moved);
    try {
      await mkdir(root); await mkdir(native("ind-root-binding"));
      await assert.rejects(app.dav.rmdir("/ind-root-binding"), rejected("ENOTSUP", "/ind-root-binding"));
      assert.equal(await exists(native("ind-root-binding")), true);
      await rmdir(native("ind-root-binding")); await rmdir(root);
    } finally { await rename(moved, root); }
  });
  await row("same supported namespace is unknown without identity, truthful alias authority blocks copy", "guard", [native("ind-alias-bytes")], async () => {
    await writeFile(native("ind-alias-bytes"), binary);
    const unbound = new WebDavFileSystem({ baseUrl: config.namespaceUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
      atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, app.fetch, config.authorization) });
    assert.equal(await app.dav.compareEntry("/ind-alias-bytes", unbound, "/ind-alias-bytes"), "unknown");
    let left; let right;
    const comparison = async function(path, peer, peerPath) { return [left, right].includes(peer) && path === "/ind-alias-bytes" && peerPath === path ? "same" : "unknown"; };
    const make = () => new WebDavFileSystem({ baseUrl: config.namespaceUrl, fetch: app.fetch, headers: { Authorization: config.authorization }, compareEntry: comparison,
      atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, app.fetch, config.authorization) });
    left = make(); right = make();
    const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/left": left, "/right": right } });
    const start = events.length;
    await assert.rejects(mounted.copyFile("/left/ind-alias-bytes", "/right/ind-alias-bytes"), rejected("EINVAL"));
    assert.ok(events.slice(start).every(entry => entry.method === "PROPFIND"));
    assert.deepEqual(await readFile(native("ind-alias-bytes")), binary);
    const alias = new URL("/alias/ind-alias-bytes", config.namespaceUrl).href;
    assert.equal((await raw("/ind-alias-bytes", "PROPFIND", { Depth: "0" }, undefined, alias)).status, 404);
    assert.notEqual((await lstat(native(""))).ino, (await lstat(join(config.serverRoot, "stock"))).ino);
  });
  await row("mismatched receipt follows one real completed removal without rollback", "guard", [native("ind-receipt")], async () => {
    await mkdir(native("ind-receipt"));
    const transport = async (target, init) => {
      const response = await app.fetch(target, init);
      if (init.method !== "DELETE") return response;
      const headers = new Headers(response.headers); headers.set("X-Atomic-Receipt", Buffer.from(JSON.stringify({ outcome: "removed", operation, namespaceUrl: config.stockUrl, path: "/ind-receipt" })).toString("base64url"));
      return new Response(response.body, { status: response.status, headers });
    };
    const fs = new WebDavFileSystem({ baseUrl: config.namespaceUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
      atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, transport, config.authorization) });
    const start = events.length;
    await assert.rejects(fs.rmdir("/ind-receipt/"), rejected("EIO", "/ind-receipt/"));
    assert.equal(await exists(native("ind-receipt")), false);
    assert.equal(events.slice(start).filter(entry => entry.method === "DELETE").length, 1);
  });
  for (const stage of ["before-native", "after-native"]) {
    const path = `/ind-cancel-${stage}`;
    await row(`actual cancellation ${stage} has uncertain eventual effect, no retry`, "guard", [native(path)], async () => {
      await mkdir(native(path)); const held = await gate(path, stage); const controller = new AbortController();
      const start = events.length;
      const pending = assert.rejects(app.dav.rmdir(`${path}/`, { signal: controller.signal }), rejected("ECANCELED", `${path}/`));
      await held.entered(); controller.abort(new FsError("ENOENT")); await pending;
      assert.equal(await exists(native(path)), stage === "before-native");
      await held.release(); await waitUntil(() => exists(native(path)).then(value => !value), "late native effect not observed");
      await waitUntil(async () => pathEvents(await trace(), path).some(entry => entry.event === "provider-finished" && entry.method === "DELETE"), "late handler unfinished");
      assert.equal(events.slice(start).filter(entry => entry.method === "DELETE").length, 1);
    });
  }

  await row("mutation: recursive primitive is caught by strict nonempty guard", "mutation", [native("mut-recursive/child")], async () => {
    await mkdir(native("mut-recursive")); await writeFile(native("mut-recursive/child"), binary);
    await settings({ mutation: "recursive" });
    await caughtGuard(async () => {
      await assert.rejects(app.dav.rmdir("/mut-recursive"), rejected("ENOTEMPTY"));
      assert.deepEqual(await readFile(native("mut-recursive/child")), binary);
    });
    assert.equal(await exists(native("mut-recursive/child")), false);
  });
  await row("mutation: ignored real lock rejection is caught", "mutation", [native("mut-lock")], async () => {
    await mkdir(native("mut-lock")); const token = await lock("/mut-lock");
    await settings({ mutation: "ignore-lock" });
    await caughtGuard(() => assert.rejects(app.dav.rmdir("/mut-lock"), rejected("EBUSY")));
    assert.equal(await exists(native("mut-lock")), false); tokens.delete(token);
  });
  await row("mutation: relabeled authenticated principal is caught", "mutation", [native("mut-auth")], async () => {
    await mkdir(native("mut-auth")); await settings({ mutation: "ignore-auth" });
    await caughtGuard(async () => { assert.equal((await atomic("/mut-auth", { Authorization: authOther })).status, 403); });
    assert.equal(await exists(native("mut-auth")), false);
  });
  await row("mutation: stripped binding header demonstrates dynamic configuration limit", "mutation", [native("mut-binding/child")], async () => {
    await mkdir(native("mut-binding")); await writeFile(native("mut-binding/child"), binary);
    const transport = async (target, init) => {
      if (init.method !== "DELETE") return app.fetch(target, init);
      const headers = new Headers(init.headers); headers.delete("X-Atomic-Empty-Directory");
      return app.fetch(target, { ...init, headers });
    };
    const fs = new WebDavFileSystem({ baseUrl: config.namespaceUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
      atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, transport, config.authorization) });
    await caughtGuard(async () => {
      await assert.rejects(fs.rmdir("/mut-binding"), rejected("ENOTEMPTY"));
      assert.deepEqual(await readFile(native("mut-binding/child")), binary);
    });
    assert.equal(await exists(native("mut-binding/child")), false);
  });
} finally {
  await settings();
  const cleanupErrors = [];
  for (const token of tokens.keys()) { try { await unlock(token); } catch (error) { cleanupErrors.push(String(error)); } }
  const totals = Object.fromEntries(["positive", "guard", "refusal", "mutation"].map(kind => [kind, {
    pass: rows.filter(row => row.kind === kind && row.result === "pass").length,
    killed: rows.filter(row => row.kind === kind && row.result === "killed").length,
    fail: rows.filter(row => row.kind === kind && row.result === "fail").length,
  }]));
  await writeFile(join(output, "wire.json"), JSON.stringify(events, null, 2));
  await writeFile(join(output, "summary.json"), JSON.stringify({ rows: rows.length, totals, retainedLocks: tokens.size, cleanupErrors,
    rootResolution: import.meta.resolve("virtual-bash"), profile: "single stable /dav provider; separate stock root; no server aliases; mutations separately labeled" }, null, 2));
  console.log(JSON.stringify(totals));
  if (rows.some(row => row.result === "fail") || cleanupErrors.length) process.exitCode = 1;
}
