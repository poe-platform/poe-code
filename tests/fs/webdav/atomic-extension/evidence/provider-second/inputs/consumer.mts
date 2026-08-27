import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat, readdir, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { FsError, WebDavFileSystem as RootWebDav, createReadOnlyFileSystem } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import { createApplication, createAtomicBinding, operation, type LiteralConfiguration } from "./example.mjs";
import type { WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const output = process.argv[3]!;
const events: WireObservation[] = [];
const app = await createApplication(config, events);
assert.equal(RootWebDav, WebDavFileSystem);
const binary = Buffer.from([0, 255, 128, 65, 13, 10]);
const native = (path: string) => join(config.serverRoot, "extension", path.replace(/^\//u, ""));
const rows: Record<string, unknown>[] = [];
const replies: Record<string, unknown>[] = [];
const tokens = new Map<string, string>();
const expected = (code: string) => (error: unknown) => error instanceof FsError && error.code === code;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function exists(path: string) {
  return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
}
async function witness(path: string): Promise<unknown> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return { type: "symlink", target: await readlink(path) };
    if (stat.isDirectory()) return { type: "directory", entries: (await readdir(path)).sort() };
    return { type: "file", hex: (await readFile(path)).toString("hex") };
  } catch (error) { return { code: (error as NodeJS.ErrnoException).code }; }
}
async function row(name: string, kind: string, paths: string[], body: () => Promise<void>) {
  const wireStart = events.length;
  const replyStart = replies.length;
  const result: Record<string, unknown> = { name, kind, result: "fail", before: Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await witness(path)]))) };
  try { await body(); result.result = "pass"; }
  catch (error) { result.error = { message: String(error), code: (error as NodeJS.ErrnoException).code, stack: (error as Error).stack }; }
  finally {
    result.after = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await witness(path)])));
    result.wire = events.slice(wireStart);
    result.replies = replies.slice(replyStart);
    rows.push(result);
    await writeFile(join(output, "consumer.json"), JSON.stringify(rows, null, 2));
  }
  console.log(`${result.result} ${kind}: ${name}`);
}
function target(path: string) { return `${config.namespaceUrl}${path.slice(1).split("/").map(encodeURIComponent).join("/")}/`; }
async function raw(path: string, method: string, headers: Record<string, string> = {}, body?: string) {
  const response = await app.fetch(target(path), { method, headers: { Authorization: config.authorization, ...headers },
    redirect: "manual", credentials: "omit", ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  const reply = { status: response.status, headers: Object.fromEntries(response.headers), text };
  replies.push({ method, path, ...reply });
  return reply;
}
async function atomic(path: string, headers: Record<string, string> = {}) {
  return raw(path, "DELETE", { Depth: "infinity", "X-Atomic-Empty-Directory": operation,
    "X-Atomic-Namespace": config.namespaceUrl, "X-Atomic-Path": Buffer.from(path).toString("base64url"), ...headers });
}
async function lock(path: string) {
  const reply = await raw(path, "LOCK", { Depth: "infinity", Timeout: "Second-60", "Content-Type": "application/xml" },
    '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>');
  assert.equal(reply.status, 200);
  const token = /<(?:\w+:)?locktoken[^>]*>\s*<(?:\w+:)?href[^>]*>([^<]+)</u.exec(reply.text)?.[1];
  assert.ok(token && /^opaquelocktoken:[A-Za-z0-9-]+$/u.test(token), "actual DAV:locktoken href URI required");
  tokens.set(path, token);
  return token;
}
async function unlock(path: string) {
  const token = tokens.get(path);
  if (!token) return;
  const reply = await raw(path, "UNLOCK", { "Lock-Token": `<${token}>` });
  assert.equal(reply.status, 204);
  tokens.delete(path);
}
async function discovery(path: string) {
  return raw(path, "PROPFIND", { Depth: "0", "Content-Type": "application/xml" }, '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>');
}

try {
  await mkdir(native("empty"));
  await row("configured public atomic empty removal", "positive", [native("empty")], async () => {
    await app.dav.rmdir("/empty");
    assert.equal(await exists(native("empty")), false);
  });
  await mkdir(native("雪 % space"));
  await row("UTF8 percent and space target", "positive", [native("雪 % space")], async () => {
    await app.dav.rmdir("/雪 % space/");
    assert.equal(await exists(native("雪 % space")), false);
  });
  await row("actual Shell pipeline and mounted strict cleanup", "positive", [native("shell-dir"), native("shell-bytes")], async () => {
    const result = await app.shell.exec("mkdir /dav/shell-dir && printf 'native-backed\\n' | cat > /dav/shell-bytes; rmdir /dav/shell-dir; cat /dav/shell-bytes");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "native-backed\n");
    assert.equal(await exists(native("shell-dir")), false);
    assert.equal((await readFile(native("shell-bytes"))).toString(), "native-backed\n");
  });
  await mkdir(native("nonempty"));
  await writeFile(native("nonempty/child"), binary);
  await row("existing child rejected by native operation", "guard", [native("nonempty"), native("nonempty/child")], async () => {
    await assert.rejects(app.dav.rmdir("/nonempty"), expected("ENOTEMPTY"));
    assert.deepEqual(await readFile(native("nonempty/child")), binary);
  });
  await mkdir(native("late-child"));
  await row("external native child after provider checks survives", "guard", [native("late-child"), native("late-child/child")], async () => {
    const pending = assert.rejects(app.dav.rmdir("/late-child"), expected("ENOTEMPTY"));
    const deadline = Date.now() + 4000;
    while (!await exists(join(config.controlRoot, "entered-native-gate"))) {
      if (Date.now() > deadline) throw new Error("provider gate not entered");
      await pause();
    }
    await writeFile(native("late-child/child"), binary);
    await writeFile(join(config.controlRoot, "release-native-gate"), "release");
    await pending;
    assert.deepEqual(await readFile(native("late-child/child")), binary);
  });
  await row("bad credentials rejected before extension hook", "guard", [native("nonempty/child")], async () => {
    const reply = await atomic("/nonempty", { Authorization: `Basic ${Buffer.from("fixture:wrong").toString("base64")}` });
    assert.equal(reply.status, 401);
    assert.deepEqual(await readFile(native("nonempty/child")), binary);
  });
  await row("real authenticated but ungranted principal", "guard", [native("nonempty/child")], async () => {
    const reply = await atomic("/nonempty", { Authorization: `Basic ${Buffer.from("other:other-fixture-password").toString("base64")}` });
    assert.equal(reply.status, 403);
    assert.deepEqual(await readFile(native("nonempty/child")), binary);
  });
  await row("wrong namespace binding rejected before mutation", "guard", [native("nonempty/child")], async () => {
    const reply = await atomic("/nonempty", { "X-Atomic-Namespace": config.stockUrl });
    assert.equal(reply.status, 409);
    assert.equal(reply.headers["x-atomic-error"], "ENOTSUP");
    assert.deepEqual(await readFile(native("nonempty/child")), binary);
  });
  await mkdir(native("control"));
  await row("wrong operation and path binding", "guard", [native("control")], async () => {
    assert.equal((await atomic("/control", { "X-Atomic-Empty-Directory": "wrong" })).status, 400);
    assert.equal((await atomic("/control", { "X-Atomic-Path": Buffer.from("/elsewhere").toString("base64url") })).status, 400);
    assert.equal(await exists(native("control")), true);
  });
  await row("public preabort root missing and file controls", "guard", [native("control"), native("shell-bytes")], async () => {
    await assert.rejects(app.dav.rmdir("/control", { signal: AbortSignal.abort() }), expected("ECANCELED"));
    await assert.rejects(app.dav.rmdir("/"), expected("EBUSY"));
    await assert.rejects(app.dav.rmdir("/absent"), expected("ENOENT"));
    await assert.rejects(app.dav.rmdir("/shell-bytes"), expected("ENOTDIR"));
    assert.equal(await exists(native("control")), true);
  });
  await symlink("nonempty", native("final-link"));
  await row("raw final symlink and target preserved", "guard", [native("final-link"), native("nonempty/child")], async () => {
    const reply = await atomic("/final-link");
    assert.equal(reply.status, 409);
    assert.equal(reply.headers["x-atomic-error"], "ENOTDIR");
    assert.equal(await readlink(native("final-link")), "nonempty");
    assert.deepEqual(await readFile(native("nonempty/child")), binary);
  });
  await mkdir(native("lock-target"));
  await row("real target lock blocks public callback", "guard", [native("lock-target")], async () => {
    await lock("/lock-target");
    try {
      await assert.rejects(app.dav.rmdir("/lock-target"), expected("EBUSY"));
      assert.match((await discovery("/lock-target")).text, /activelock/u);
      assert.equal(await exists(native("lock-target")), true);
    } finally { await unlock("/lock-target"); }
  });
  await mkdir(native("parent/empty"), { recursive: true });
  await row("standard parent lock blocks before early provider hook", "guard", [native("parent/empty")], async () => {
    await lock("/parent");
    try {
      assert.equal((await atomic("/parent/empty")).status, 423);
      assert.equal((await atomic("/parent/empty", { If: "(<opaquelocktoken:wrong>)" })).status, 412);
      assert.equal(await exists(native("parent/empty")), true);
    } finally { await unlock("/parent"); }
  });
  await row("actual inherited token authorizes native empty removal", "positive", [native("parent/empty")], async () => {
    const token = await lock("/parent");
    try {
      const reply = await atomic("/parent/empty", { If: `(<${token}>)` });
      assert.equal(reply.status, 204);
      assert.equal(await exists(native("parent/empty")), false);
      assert.match((await discovery("/parent")).text, /activelock/u);
    } finally { await unlock("/parent"); }
  });
  await mkdir(native("descendant/child"), { recursive: true });
  await row("real descendant lock rejected before native call", "guard", [native("descendant/child")], async () => {
    await lock("/descendant/child");
    try {
      assert.equal((await atomic("/descendant")).status, 423);
      assert.equal(await exists(native("descendant/child")), true);
    } finally { await unlock("/descendant/child"); }
  });
  await mkdir(join(config.serverRoot, "stock", "empty"));
  await row("actual stock default retains ENOTSUP", "refusal", [join(config.serverRoot, "stock", "empty")], async () => {
    const start = events.length;
    await assert.rejects(app.stock.rmdir("/empty"), expected("ENOTSUP"));
    assert.ok(events.slice(start).every((event) => event.method === "PROPFIND"));
    assert.equal(await exists(join(config.serverRoot, "stock", "empty")), true);
  });
  await row("unregistered stock extension refused by OPTIONS before DELETE", "refusal", [join(config.serverRoot, "stock", "empty")], async () => {
    const fs = new WebDavFileSystem({ baseUrl: config.stockUrl, fetch: app.fetch, headers: { Authorization: config.authorization },
      atomicEmptyDirectory: createAtomicBinding(config.stockUrl, app.fetch, config.authorization) });
    const start = events.length;
    await assert.rejects(fs.rmdir("/empty"), expected("ENOTSUP"));
    assert.ok(events.slice(start).every((event) => event.method !== "DELETE"));
    assert.equal(await exists(join(config.serverRoot, "stock", "empty")), true);
  });
  await row("read-only wrapper and mount root stay protected", "guard", [native("control")], async () => {
    await assert.rejects(createReadOnlyFileSystem(app.dav).rmdir!("/control"), expected("EROFS"));
    await assert.rejects(app.mounted.rmdir!("/dav"), expected("EBUSY"));
    assert.equal(await exists(native("control")), true);
  });
} finally {
  for (const path of tokens.keys()) await unlock(path);
  await writeFile(join(output, "wire.json"), JSON.stringify(events, null, 2));
  const totals = Object.fromEntries(["positive", "guard", "refusal"].map((kind) => [kind, {
    pass: rows.filter((row) => row.kind === kind && row.result === "pass").length,
    fail: rows.filter((row) => row.kind === kind && row.result === "fail").length,
  }]));
  await writeFile(join(output, "summary.json"), JSON.stringify({ totals, rows: rows.length, retainedLocks: tokens.size,
    rootResolution: import.meta.resolve("virtual-bash"), subpathResolution: import.meta.resolve("virtual-bash/fs/webdav") }, null, 2));
  console.log(totals);
  if (rows.some((row) => row.result === "fail")) process.exitCode = 1;
}
