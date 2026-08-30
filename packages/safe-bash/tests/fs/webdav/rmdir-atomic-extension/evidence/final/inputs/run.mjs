import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { operation, send, startFixture, validateRemoval } from "./server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../..");
const output = join(here, "evidence", process.argv[2] ?? "first");
assert.match(process.argv[2] ?? "first", /^[a-z0-9-]+$/u);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
const paths = git("ls-files", "src/fs/webdav", "src/contracts/filesystem.md", "src/contracts/filesystem.ts", "package.json",
  "tests/fs/webdav/rmdir-real-service").split("\n").filter(Boolean);
paths.push(...["server.mjs", "run.mjs", "proposal.ts"].map((name) => relative(repository, join(here, name))));
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async (path) => [path, hash(await readFile(join(repository, path)))])));
const beforeHashes = await hashes();
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await mkdir(join(output, "inputs"));
for (const name of ["server.mjs", "run.mjs", "proposal.ts"]) {
  await writeFile(join(output, "inputs", name), await readFile(join(here, name)));
}
const profile = {
  protocol: "test-only HTTP POST atomic-empty-rmdir/v1; not WebDAV",
  host: "127.0.0.1", nativePrimitive: "node:fs/promises.rmdir(path), no options",
  authorization: "fixed synthetic fixture-writer principal; /allowed descendants only",
  policyLocks: "in-process fixture policy table, NOT Apache/WsgiDAV lock integration",
  serialization: "all fixture HTTP operations serialized; native host writes remain outside queue",
  ancestors: "stable trusted namespace; lstat is a best-effort guard, not race confinement",
  conditions: "no identity CAS, If or If-Match; explicit rejection",
  dependencies: [], serverChildProcesses: 0, downloads: 0,
};
const baseline = {
  startedAt: new Date().toISOString(), head: git("rev-parse", "HEAD"),
  worktree: git("status", "--short"), sourceInputs: beforeHashes,
  node: process.version, nodeBinary: process.execPath, nodeBinarySha256: hash(await readFile(process.execPath)),
  platform: process.platform, architecture: process.arch, profile, profileSha256: hash(JSON.stringify(profile)),
  packageExports: JSON.parse(await readFile(join(repository, "package.json"), "utf8")).exports,
};
await writeFile(join(output, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
const rows = [];
const binary = Buffer.from([0, 255, 128, 65, 13, 10]);
let ownedRoot;
let fixture;
let cleanup;
let fatal;

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("fixture gate exceeded 3000ms")), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

function disconnectGate() {
  const reached = deferred();
  const disconnected = deferred();
  return {
    reached, disconnected,
    async hook(signal) {
      reached.resolve();
      if (signal.aborted) disconnected.resolve();
      else signal.addEventListener("abort", () => disconnected.resolve(), { once: true });
      await bounded(disconnected.promise);
    },
  };
}

try {
  ownedRoot = await mkdtemp(join(here, ".native-"));
  await mkdir(join(ownedRoot, "allowed"));
  await mkdir(join(ownedRoot, "denied"));
  fixture = await startFixture(ownedRoot);
  baseline.literalConfiguration = { endpoint: fixture.endpoint, namespaceUrl: fixture.namespaceUrl, nativeRoot: fixture.root, rootIdentity: fixture.rootIdentity };
  await writeFile(join(output, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  const native = (path) => join(ownedRoot, path.slice(1));
  const directory = async (path) => mkdir(native(path), { recursive: true });
  const exists = async (path) => lstat(native(path)).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const witness = async (path) => {
    try {
      const stat = await lstat(native(path));
      if (stat.isSymbolicLink()) return { type: "symlink", target: await readlink(native(path)) };
      if (stat.isDirectory()) return { type: "directory", entries: (await readdir(native(path))).sort(), inode: String(stat.ino) };
      const bytes = await readFile(native(path));
      return { type: "file", hex: bytes.toString("hex"), sha256: hash(bytes), bytes: bytes.length };
    } catch (error) { return { error: error.code }; }
  };
  async function check(name, kind, witnesses, body) {
    const row = { name, kind, result: "fail", before: {}, after: {} };
    const offset = fixture.records.length;
    for (const path of witnesses) row.before[path] = await witness(path);
    try { await body(); row.result = "pass"; }
    catch (error) { row.error = { message: String(error), stack: error.stack }; }
    finally {
      for (const path of witnesses) row.after[path] = await witness(path);
      row.requests = fixture.records.slice(offset);
      rows.push(row);
      await writeFile(join(output, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);
    }
    console.log(`${row.result} ${kind}: ${name}`);
  }
  async function expectError(path, status, code, options) {
    const reply = await send(fixture, path, options);
    assert.deepEqual(reply, { status, body: { code } });
  }
  async function noNative(path, status, code, options) {
    const offset = fixture.records.length;
    await expectError(path, status, code, options);
    assert.equal(fixture.records.slice(offset).reduce((sum, record) => sum + record.nativeCalls, 0), 0);
  }
  async function emptySuccess(path, options) {
    const reply = await send(fixture, path, options);
    validateRemoval(fixture, path, reply);
    assert.equal(await exists(path), false);
  }

  for (const path of ["/allowed/empty", "/allowed/UTF8-雪 % space"]) {
    await directory(path);
    await check(`empty native success ${path}`, "positive", [path], () => emptySuccess(path));
  }
  await directory("/allowed/existing");
  await writeFile(native("/allowed/existing/child"), binary);
  await check("preexisting binary child survives native ENOTEMPTY", "guard", ["/allowed/existing", "/allowed/existing/child"], async () => {
    await expectError("/allowed/existing", 409, "ENOTEMPTY");
    assert.equal(fixture.records.at(-1).nativeCalls, 1);
    assert.deepEqual(await readFile(native("/allowed/existing/child")), binary);
  });
  await directory("/allowed/late");
  fixture.hooks.set("/allowed/late", { beforeNative: () => writeFile(native("/allowed/late/child"), binary) });
  await check("native child inserted after checks survives final rmdir", "guard", ["/allowed/late", "/allowed/late/child"], async () => {
    await expectError("/allowed/late", 409, "ENOTEMPTY");
    assert.equal(fixture.records.at(-1).nativeCalls, 1);
    assert.deepEqual(await readFile(native("/allowed/late/child")), binary);
  });
  await writeFile(native("/allowed/file"), binary);
  await check("file is not removed", "guard", ["/allowed/file"], async () => {
    await noNative("/allowed/file", 409, "ENOTDIR");
    assert.deepEqual(await readFile(native("/allowed/file")), binary);
  });
  await directory("/allowed/target/child");
  await writeFile(native("/allowed/target/child/bytes"), binary);
  await symlink("target", native("/allowed/link"));
  await check("final symlink and target preserved", "guard", ["/allowed/link", "/allowed/target", "/allowed/target/child/bytes"], async () => {
    await noNative("/allowed/link", 409, "ENOTDIR");
    assert.equal(await readlink(native("/allowed/link")), "target");
    assert.deepEqual(await readFile(native("/allowed/target/child/bytes")), binary);
  });
  await check("stable ancestor symlink refused", "guard", ["/allowed/link", "/allowed/target/child/bytes"], async () => {
    await noNative("/allowed/link/child", 409, "ENOTDIR");
    assert.deepEqual(await readFile(native("/allowed/target/child/bytes")), binary);
  });
  await check("namespace root protected", "guard", ["/"], () => noNative("/", 409, "EBUSY"));
  await check("missing entry stays missing", "guard", ["/allowed/missing"], () => noNative("/allowed/missing", 404, "ENOENT"));
  await directory("/allowed/control");
  await directory("/denied/control");
  await check("synthetic auth missing and invalid", "guard", ["/allowed/control"], async () => {
    for (const authorization of ["", "Bearer wrong-fixture-token"]) await noNative("/allowed/control", 401, "EAUTH", { headers: { authorization } });
  });
  await check("authenticated principal lacks path grant", "guard", ["/denied/control"], () => noNative("/denied/control", 403, "EACCES"));
  await check("wrong namespace and undeclared alias binding", "guard", ["/allowed/control"], async () => {
    for (const namespaceUrl of [fixture.namespaceUrl.replace("/dav/", "/alias/"), "http://127.0.0.1:1/dav/"]) {
      await noNative("/allowed/control", 409, "EBINDING", { body: { namespaceUrl } });
    }
  });
  await check("wrong Host binding", "guard", ["/allowed/control"], () => noNative("/allowed/control", 409, "EBINDING", { headers: { host: "wrong.invalid" } }));
  await check("noncanonical paths rejected without normalization", "guard", ["/allowed/control"], async () => {
    for (const path of ["allowed/control", "/allowed/../control", "/allowed/./control", "/allowed//control", "/allowed/control/", "/allowed/\\control", "/allowed/\u0000control"]) {
      await noNative(path, 400, "EINVAL");
    }
  });
  await check("operation and root override rejected", "guard", ["/allowed/control"], async () => {
    await noNative("/allowed/control", 400, "EINVAL", { body: { operation: "recursive-delete" } });
    await noNative("/allowed/control", 400, "EINVAL", { body: { root: ownedRoot } });
  });
  await check("DELETE method not silently upgraded", "guard", ["/allowed/control"], () => noNative("/allowed/control", 405, "EMETHOD", { method: "DELETE" }));
  await check("unsupported DAV and entity conditions explicitly refused", "refusal", ["/allowed/control"], async () => {
    await noNative("/allowed/control", 501, "ENOTSUP", { headers: { "if-match": '"observed-but-not-atomic"' } });
    await noNative("/allowed/control", 501, "ENOTSUP", { headers: { if: "(<urn:fixture:token>)" } });
  });
  await directory("/allowed/locked/empty");
  fixture.policyLocks.set("/allowed/locked", { token: "fixture-token", principal: "fixture-writer", expiresAt: Date.now() + 60000 });
  await check("fixture parent lock requires matching authorization", "guard", ["/allowed/locked/empty"], async () => {
    await noNative("/allowed/locked/empty", 423, "ELOCKED");
    await noNative("/allowed/locked/empty", 423, "ELOCKED", { headers: { "x-fixture-lock-token": "wrong" } });
  });
  await check("token cannot authorize unrelated target", "guard", ["/allowed/control"], () => noNative("/allowed/control", 412, "EPRECONDITION", { headers: { "x-fixture-lock-token": "fixture-token" } }));
  await check("fixture lock-authorized empty deletion", "positive", ["/allowed/locked/empty"], () => emptySuccess("/allowed/locked/empty", { headers: { "x-fixture-lock-token": "fixture-token" } }));
  await directory("/allowed/expired");
  fixture.policyLocks.set("/allowed/expired", { token: "expired", principal: "fixture-writer", expiresAt: 0 });
  await check("expired submitted policy token rejected", "guard", ["/allowed/expired"], () => noNative("/allowed/expired", 412, "EPRECONDITION", { headers: { "x-fixture-lock-token": "expired" } }));
  await check("preabort sends no request", "guard", ["/allowed/control"], async () => {
    const offset = fixture.records.length;
    await assert.rejects(send(fixture, "/allowed/control", { signal: AbortSignal.abort() }));
    assert.equal(fixture.records.length, offset);
  });
  await directory("/allowed/cancel");
  const beforeGate = disconnectGate();
  fixture.hooks.set("/allowed/cancel", { beforeNative: beforeGate.hook });
  await check("disconnect before syscall preserves directory", "guard", ["/allowed/cancel"], async () => {
    const controller = new AbortController();
    const pending = send(fixture, "/allowed/cancel", { signal: controller.signal });
    const rejected = assert.rejects(pending);
    await bounded(beforeGate.reached.promise);
    controller.abort();
    await rejected;
    await bounded(beforeGate.disconnected.promise);
    await bounded((async () => { while (!fixture.records.at(-1).finished) await new Promise((resolveValue) => setImmediate(resolveValue)); })());
    assert.equal(fixture.records.at(-1).nativeCalls, 0);
    assert.equal(await exists("/allowed/cancel"), true);
  });
  await directory("/allowed/late-abort");
  const afterGate = disconnectGate();
  fixture.hooks.set("/allowed/late-abort", { afterNative: afterGate.hook });
  await check("abort after native success cannot roll back", "limitation", ["/allowed/late-abort"], async () => {
    const controller = new AbortController();
    const pending = send(fixture, "/allowed/late-abort", { signal: controller.signal });
    const rejected = assert.rejects(pending);
    await bounded(afterGate.reached.promise);
    controller.abort();
    await rejected;
    await bounded(afterGate.disconnected.promise);
    await bounded((async () => { while (!fixture.records.at(-1).finished) await new Promise((resolveValue) => setImmediate(resolveValue)); })());
    assert.equal(fixture.records.at(-1).nativeOutcome, "removed");
    assert.equal(await exists("/allowed/late-abort"), false);
  });
  await directory("/allowed/replaced");
  fixture.hooks.set("/allowed/replaced", { beforeNative: async () => {
    await rename(native("/allowed/replaced"), native("/allowed/original"));
    await directory("/allowed/replaced");
  } });
  await check("pathname rmdir is not target-inode compare-and-delete", "limitation", ["/allowed/replaced", "/allowed/original"], async () => {
    await emptySuccess("/allowed/replaced");
    assert.equal(await exists("/allowed/original"), true);
  });
  await directory("/allowed/concurrent");
  await check("two concurrent removals have one native success", "positive", ["/allowed/concurrent"], async () => {
    const replies = await Promise.all([send(fixture, "/allowed/concurrent"), send(fixture, "/allowed/concurrent")]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 404]);
    validateRemoval(fixture, "/allowed/concurrent", replies.find((reply) => reply.status === 200));
    assert.equal(replies.find((reply) => reply.status === 404).body.code, "ENOENT");
    assert.equal(await exists("/allowed/concurrent"), false);
  });
  assert.deepEqual(await hashes(), beforeHashes);
} catch (error) {
  fatal = { message: String(error), stack: error.stack };
} finally {
  cleanup = { serverChildrenSpawned: 0 };
  try {
    if (fixture) cleanup.server = await fixture.stop();
  } catch (error) {
    cleanup.serverError = String(error);
  } finally {
    if (ownedRoot) {
      cleanup.ownedRoot = ownedRoot;
      try {
        await rm(ownedRoot, { recursive: true, force: true });
        cleanup.rootRemoved = await lstat(ownedRoot).then(() => false, (error) => error.code === "ENOENT");
      } catch (error) { cleanup.rootError = String(error); }
    }
  }
  const totals = Object.fromEntries(["positive", "guard", "refusal", "limitation"].map((kind) => [kind, {
    passed: rows.filter((row) => row.kind === kind && row.result === "pass").length,
    failed: rows.filter((row) => row.kind === kind && row.result === "fail").length,
  }]));
  const summary = { finishedAt: new Date().toISOString(), totals, rows: rows.length, requests: fixture?.records.length ?? 0,
    cleanup, fatal, frozenInputsUnchanged: JSON.stringify(await hashes()) === JSON.stringify(beforeHashes),
    noProductionImplementation: true, notOriginalWebDavMatrix: true };
  await writeFile(join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (fatal || rows.some((row) => row.result === "fail") || !cleanup.rootRemoved || cleanup.serverError || !summary.frozenInputsUnchanged) process.exitCode = 1;
}
