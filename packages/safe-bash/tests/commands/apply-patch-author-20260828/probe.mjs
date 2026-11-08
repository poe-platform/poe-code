import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate } from "node:timers/promises";

const product = process.env.PRODUCT_ROOT;
const api = await import(pathToFileURL(path.join(product, "dist/index.js")));
const command = await import(pathToFileURL(path.join(product, "dist/commands/apply-patch/index.js")));
const data = JSON.parse(fs.readFileSync(new URL("./CASES-v1.json", import.meta.url)));
globalThis.fetch = () => { throw new Error("Unexpected network request"); };
const envelope = body => `*** Begin Patch\n${body}*** End Patch\n`;
const add = envelope("*** Add File: a\n+x\n");
const update = envelope("*** Update File: a\n@@\n-old\n+new\n");
const move = envelope("*** Update File: a\n*** Move to: b\n@@\n-old\n+new\n");
const text = bytes => Buffer.from(bytes).toString("utf8");
const encode = text => Buffer.from(text);
let shells = 0, disposed = 0;
const results = [];
const select = process.env.CASE_IDS?.split(",");
async function memory(before = {}) {
  const filesystem = new api.MemoryFileSystem();
  await filesystem.mkdir("/work");
  for (const [name, value] of Object.entries(before)) {
    await filesystem.mkdir(path.posix.dirname(name), { recursive: true });
    await filesystem.writeFile(name, typeof value === "string" ? encode(value) : value);
  }
  return filesystem;
}
function wrap(filesystem, overrides = {}, log = []) {
  return new Proxy(filesystem, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => { log.push([key, ...args]); return value.apply(target, args); };
  } });
}
async function direct(filesystem, patch, options = {}, extra = {}) {
  const stdout = [], stderr = [], cleanups = [];
  const context = {
    command: "apply_patch", args: [patch], cwd: "/work", env: {}, fs: filesystem,
    stdin: api.toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); }, ...extra,
  };
  let outcome, failed = false, reason;
  try { outcome = await command.createApplyPatchCommand(options).execute(context); }
  catch (error) { failed = true; reason = error; }
  const settled = await Promise.allSettled(cleanups.map(cleanup => cleanup()));
  if (failed) throw reason;
  const failure = settled.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return { ...outcome, stdout: text(Buffer.concat(stdout)), stderr: text(Buffer.concat(stderr)), cleanups: cleanups.length };
}
async function sameRejection(promise, expected) {
  let failed = false, reason;
  try { await promise; } catch (error) { failed = true; reason = error; }
  assert.equal(failed, true, "must reject rather than map to status");
  assert.equal(reason, expected, "exact rejection identity");
}
async function shell(filesystem, action, options = {}) {
  const instance = new api.Shell({ fs: filesystem, cwd: "/work", ...options }); shells++;
  try { instance.use(api.agentCommands()).use(command.applyPatchCommands()); return await action(instance); }
  finally { await instance.dispose(); disposed++; }
}
async function test(id, action) {
  if (select && !select.includes(id)) return;
  try { await action(); results.push({ id, pass: true }); }
  catch (error) { results.push({ id, pass: false, error: error?.stack ?? String(error) }); }
}

for (const row of data.literalCases) await test(row.id, async () => {
  const filesystem = await memory(row.before);
  const calls = [];
  const patch = row.patch ?? envelope(row.body);
  const stdin = row.stdinTrap ? { [Symbol.asyncIterator]() { throw new Error("stdin acquired in argument mode"); } } : api.toByteSource(patch);
  const result = await direct(wrap(filesystem, {}, calls), patch, {}, { args: row.input === "argument" ? [patch] : [], stdin });
  assert.equal(result.exitCode, row.status, result.stderr);
  if (row.fsCalls === 0) assert.equal(calls.length, 0);
  if (row.status === 0) assert.match(result.stdout, /^Success\. Updated the following files:\n/);
  else assert.equal(result.stdout, "");
  for (const [name, expected] of Object.entries(row.after ?? {})) assert.equal(text(await filesystem.readFile(name)), expected, name);
  for (const name of row.absent ?? []) await assert.rejects(filesystem.lstat(name), error => error.code === "ENOENT");
  if (row.unchanged) {
    assert.equal(calls.filter(([name]) => ["writeFile", "mkdir", "rm", "rename", "copyFile"].includes(name)).length, 0);
    for (const [name, expected] of Object.entries(row.before ?? {})) assert.equal(text(await filesystem.readFile(name)), expected);
  }
});
await test("T01", async () => {
  const result = await direct({}, "", {}, { args: ["one", "two"], stdin: { [Symbol.asyncIterator]() { assert.fail("input acquired"); } } });
  assert.equal(result.exitCode, 2);
});
await test("T02", async () => {
  const patch = envelope("*** Add File: a\n+猫🦉\n");
  const bytes = encode(patch), buffer = Buffer.alloc(1);
  const stdin = { async *[Symbol.asyncIterator]() { for (const byte of bytes) { buffer[0] = byte; yield buffer; } buffer[0] = 0; } };
  const filesystem = await memory();
  assert.equal((await direct(filesystem, "", {}, { args: [], stdin })).exitCode, 0);
  assert.equal(text(await filesystem.readFile("/work/a")), "猫🦉\n");
});
await test("T03", async () => {
  for (const bytes of [Buffer.from([0xff]), encode(add.replace("+x", "+\0"))]) {
    assert.equal((await direct({}, "", {}, { args: [], stdin: api.toByteSource(bytes) })).exitCode, 2);
  }
  assert.equal((await direct({}, add.replace("+x", "+\ud800"))).exitCode, 2);
  const filesystem = await memory({ "/work/a": Buffer.from([0xff]) });
  assert.equal((await direct(filesystem, update)).exitCode, 1);
  assert.equal(Buffer.compare(Buffer.from(await filesystem.readFile("/work/a")), Buffer.from([0xff])), 0);
});
await test("T04", async () => {
  for (const value of [4 * 1024 * 1024 + 1, Infinity, NaN, 1.5, 0]) assert.throws(() => command.createApplyPatchCommand({ limits: { maxPatchBytes: value } }));
  assert.throws(() => command.createApplyPatchCommand({ limits: { unknown: 1 } }));
  assert.throws(() => command.createApplyPatchCommand({ limits: { maxDiagnosticBytes: 31 } }));
  assert.equal(command.createApplyPatchCommand({ limits: { maxPatchBytes: 128 } }).name, "apply_patch");
});
await test("T05", async () => {
  const filesystem = await memory();
  assert.equal((await direct(filesystem, add, { limits: { maxPatchBytes: Buffer.byteLength(add) } })).exitCode, 0);
  assert.equal((await direct({}, add, { limits: { maxPatchBytes: Buffer.byteLength(add) - 1 } })).exitCode, 1);
  let returned = false;
  const stdin = { async *[Symbol.asyncIterator]() { try { yield Buffer.alloc(0); yield Buffer.alloc(0); } finally { returned = true; } } };
  assert.equal((await direct({}, "", { limits: { maxInputChunks: 1 } }, { args: [], stdin })).exitCode, 1);
  assert.equal(returned, true);
});
await test("T06", async () => {
  for (const limits of [{ maxFileBytes: 2 }, { maxStagedBytes: 2 }, { maxReadBytes: 2 }]) {
    const filesystem = await memory({ "/work/a": "old\n" });
    assert.equal((await direct(filesystem, update, { limits })).exitCode, 1);
    assert.equal(text(await filesystem.readFile("/work/a")), "old\n");
  }
});
await test("T07", async () => {
  assert.equal((await direct({}, add, { limits: { maxWork: 1 } })).exitCode, 1);
  const controller = new AbortController(), reason = { matching: true };
  const pending = direct({}, envelope("*** Add File: a\n+" + "🙂".repeat(16000) + "\n"), {}, { signal: controller.signal });
  await setImmediate(); controller.abort(reason);
  await sameRejection(pending, reason);
});
await test("T08", async () => {
  const cases = [
    [envelope("*** Add File: a\n*** Add File: b\n"), { maxFiles: 1 }],
    [envelope("*** Update File: a\n@@\n-a\n+A\n@@\n-b\n+B\n"), { maxHunks: 1 }],
    [add, { maxLines: 1 }], [add, { maxPathBytes: 2 }],
    [envelope("*** Add File: a/b\n+x\n"), { maxPathComponents: 1 }],
  ];
  for (const [patch, limits] of cases) assert.equal((await direct({}, patch, { limits })).exitCode, 1);
});
await test("T09", async () => {
  const filesystem = await memory(), calls = [];
  assert.equal((await direct(wrap(filesystem, {}, calls), add, { limits: { maxOutputBytes: 1 } })).exitCode, 1);
  assert.equal(calls.some(([name]) => name === "writeFile" || name === "mkdir"), false);
});
await test("T10", async () => {
  for (const mode of ["leaf", "dangling", "ancestor"]) {
    const filesystem = await memory({ "/work/real": "old\n" });
    await filesystem.symlink(mode === "dangling" ? "/missing" : mode === "ancestor" ? "/work" : "/work/real", "/work/link");
    const patch = mode === "ancestor" ? envelope("*** Add File: link/a\n+x\n") : update.replace("File: a", "File: link");
    assert.equal((await direct(filesystem, patch)).exitCode, 1);
    assert.equal(text(await filesystem.readFile("/work/real")), "old\n");
  }
});
await test("T11", async () => {
  const filesystem = await memory({ "/work/a": "old\n" }); await filesystem.link("/work/a", "/work/b");
  assert.equal((await direct(filesystem, envelope("*** Add File: a\n+new\n*** Delete File: b\n"))).exitCode, 1);
  assert.equal(text(await filesystem.readFile("/work/a")), "old\n");
  assert.equal(text(await filesystem.readFile("/work/b")), "old\n");
});
await test("T12", async () => {
  for (const code of ["EACCES", "EPERM", "EROFS", "ENOTSUP"]) {
    const filesystem = await memory();
    const wrapped = wrap(filesystem, { capabilities: { permissions: false }, async access() { throw new api.FsError(code); } });
    assert.equal((await direct(wrapped, add)).exitCode, code === "ENOTSUP" ? 0 : 1);
  }
  const filesystem = await memory();
  assert.equal((await direct(wrap(filesystem, { capabilities: { permissions: true }, async access() { throw new api.FsError("ENOTSUP"); } }), add)).exitCode, 1);
});
await test("T13", async () => {
  for (const reason of [false, null, 0, "", { why: "caller" }, new api.FsError("ENOENT"), undefined]) {
    const signal = { aborted: true, reason, throwIfAborted() { throw reason; } };
    let reads = 0;
    const args = new Proxy([add], { get(target, key) { reads++; return Reflect.get(target, key); } });
    await sameRejection(direct({}, add, {}, { signal, args }), reason);
    assert.equal(reads, 0, "pre-aborted caller before argument inspection");
  }
});
await test("T14", async () => {
  for (const reason of [undefined, false, 0, null, new api.FsError("EIO"), { opaque: true }]) {
    const stdin = { async *[Symbol.asyncIterator]() { throw reason; } };
    await sameRejection(direct({}, "", {}, { args: [], stdin }), reason);
    await sameRejection(direct(await memory(), add, {}, { stdout: { async write() { throw reason; } } }), reason);
  }
});
await test("T15", async () => {
  const filesystem = await memory();
  const reason = { provider: true };
  await sameRejection(direct(wrap(filesystem, { async lstat() { throw reason; } }), add), reason);
  const result = await direct(wrap(filesystem, { async lstat() { throw new api.FsError("EACCES"); } }), add);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /permission denied/);
});
await test("T16", async () => {
  const filesystem = await memory({ "/work/a": "old\n" });
  const wrapped = wrap(filesystem, { async writeFile(name, bytes, options) {
    if (name === "/work/b") { await filesystem.writeFile(name, encode("racer")); assert.equal(options.flag, "wx"); }
    return filesystem.writeFile(name, bytes, options);
  } });
  assert.equal((await direct(wrapped, move)).exitCode, 1);
  assert.equal(text(await filesystem.readFile("/work/a")), "old\n"); assert.equal(text(await filesystem.readFile("/work/b")), "racer");
});
await test("T17", async () => {
  const filesystem = await memory({ "/work/a": "old\n" });
  const wrapped = wrap(filesystem, { async writeFile(name, bytes, options) {
    await filesystem.writeFile(name, bytes.subarray(0, 1), options);
    throw new api.FsError("ENOSPC");
  } });
  const result = await direct(wrapped, move); assert.equal(result.exitCode, 1);
  assert.equal(text(await filesystem.readFile("/work/a")), "old\n"); assert.equal(text(await filesystem.readFile("/work/b")), "n");
  assert.match(result.stderr, /prior changes may remain/);
});
await test("T18", async () => {
  const filesystem = await memory({ "/work/a": "old\n" });
  const wrapped = wrap(filesystem, { async writeFile(name, bytes, options) {
    await filesystem.writeFile(name, bytes, options); await filesystem.writeFile("/work/a", encode("other\n"));
  } });
  assert.equal((await direct(wrapped, move)).exitCode, 1);
  assert.equal(text(await filesystem.readFile("/work/a")), "other\n"); assert.equal(text(await filesystem.readFile("/work/b")), "new\n");
});
await test("T19", async () => {
  const filesystem = await memory();
  const wrapped = wrap(filesystem, { async writeFile(name, bytes, options) {
    if (name === "/work/b") throw new api.FsError("EIO"); return filesystem.writeFile(name, bytes, options);
  } });
  const result = await direct(wrapped, envelope("*** Add File: a\n+one\n*** Add File: b\n+two\n"));
  assert.equal(result.exitCode, 1); assert.equal(text(await filesystem.readFile("/work/a")), "one\n");
  await assert.rejects(filesystem.stat("/work/b"), error => error.code === "ENOENT");
});
await test("T20", async () => {
  const filesystem = await memory();
  await shell(filesystem, async instance => {
    instance.register({ name: "literal", execute(context) { return context.invoke("apply_patch", [envelope("*** Add File: b\n+$literal\n")]); } });
    const result = await instance.exec(`apply_patch <<'PATCH'\n${envelope("*** Add File: a\n+$literal\n")}PATCH\nliteral\ncat a b`);
    assert.equal(result.exitCode, 0, result.stderr); assert.ok(result.stdout.endsWith("$literal\n$literal\n"));
  });
  await shell(await memory(), async instance => {
    await assert.rejects(instance.exec("true; true; true"), error => error instanceof api.ShellLimitError);
  }, { limits: { maxCommands: 2 } });
});
await test("T21", async () => {
  const filesystem = await memory(), reason = { output: true };
  const consumer = new AbortController(); consumer.abort(reason);
  const stdout = { async write() { assert.fail("closed output wrote"); }, ownedOutput: { consumerClosed: consumer.signal, async write() { assert.fail("closed owned output wrote"); } } };
  await sameRejection(direct(filesystem, add, {}, { stdout }), reason);
  assert.equal(text(await filesystem.readFile("/work/a")), "x\n");
});
await test("T22", async () => {
  const filesystem = await memory(); let cleanup, acquired = false;
  const stdin = { async *[Symbol.asyncIterator]() { assert.equal(typeof cleanup, "function"); acquired = true; yield encode(add); } };
  assert.equal((await direct(filesystem, "", {}, { args: [], stdin, registerCleanup(callback) { cleanup ??= callback; } })).exitCode, 0);
  assert.equal(acquired, true); cleanup(); cleanup();
  const reason = { register: true };
  await sameRejection(direct({}, add, {}, { registerCleanup() { throw reason; } }), reason);
});
await test("T23", async () => {
  const definitions = api.createAgentCommands(); assert.equal(definitions.length, 78);
  assert.equal(definitions.some(row => row.name === "apply_patch" || row.name === "curl" || row.name === "safejs"), false);
  assert.equal(Object.hasOwn(api, "createApplyPatchCommand"), false);
});
await test("T24", async () => {
  assert.equal(command.createApplyPatchCommands().length, 1);
  const registry = new api.CommandRegistry(); const host = { commands: registry };
  await command.applyPatchCommands().setup(host);
  assert.throws(() => command.applyPatchCommands().setup(host));
  await command.applyPatchCommands({ replace: true }).setup(host); assert.equal(registry.list().length, 1);
});

for (const profile of ["Memory", "Real", "ReadOnly", "Mount", "Overlay", "S3", "WebDAV"]) await test(`F-${profile}`, async () => {
  let filesystem, witness;
  if (profile === "Memory") filesystem = await memory();
  if (profile === "Real") { const root = path.join(process.env.FIXTURE_ROOT, "real"); fs.mkdirSync(root); filesystem = new api.RealFileSystem({ root }); }
  if (profile === "ReadOnly") { witness = await memory({ "/work/a": "old\n" }); filesystem = new api.ReadOnlyFileSystem(witness); }
  if (profile === "Mount") filesystem = new api.MountFileSystem({ root: new api.MemoryFileSystem(), mounts: { "/work": new api.MemoryFileSystem() } });
  if (profile === "Overlay") filesystem = new api.OverlayFileSystem({ upper: new api.MemoryFileSystem(), lower: new api.MemoryFileSystem() });
  if (profile === "S3") filesystem = new api.S3FileSystem({ transport: new api.MockS3Client({ buckets: ["author"], pageSize: 2 }), bucket: "author", prefix: "owned", pageSize: 2 });
  if (profile === "WebDAV") { const { MockDav } = await import(new URL("./mock.mjs", import.meta.url)); witness = new MockDav(); filesystem = new api.WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: witness.fetch }); }
  if (profile !== "ReadOnly" && profile !== "Memory" && profile !== "Mount") await filesystem.mkdir("/work");
  if (profile === "ReadOnly") {
    assert.equal((await direct(filesystem, update)).exitCode, 1); assert.equal(text(await witness.readFile("/work/a")), "old\n"); return;
  }
  await shell(filesystem, async instance => {
    for (const patch of [
      envelope("*** Add File: a\n+old\n*** Add File: obsolete\n+gone\n"),
      update,
      envelope("*** Update File: a\n*** Move to: nested/final\n@@\n new\n*** Delete File: obsolete\n"),
    ]) {
      const result = await instance.exec(`apply_patch <<'PATCH'\n${patch}PATCH`);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const result = await instance.exec("cat nested/final | sed 's/new/verified/'");
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "verified\n");
    assert.equal(text(await filesystem.readFile("/work/nested/final")), "new\n");
    await assert.rejects(filesystem.stat("/work/a"), error => error.code === "ENOENT");
    await assert.rejects(filesystem.stat("/work/obsolete"), error => error.code === "ENOENT");
  });
  if (profile === "Real") assert.equal(fs.readFileSync(path.join(process.env.FIXTURE_ROOT, "real/work/nested/final"), "utf8"), "new\n");
  if (profile === "WebDAV") { assert.equal(witness.locks.size, 0); assert.ok(witness.requests.some(row => row.init.method === "PUT")); }
});

for (const row of results) console.log(JSON.stringify(row));
assert.equal(shells, disposed, "all created Shell instances disposed");
console.log(JSON.stringify({ summary: { cases: results.length, passed: results.filter(row => row.pass).length, shells, disposed } }));
if (results.some(row => !row.pass)) process.exitCode = 1;
