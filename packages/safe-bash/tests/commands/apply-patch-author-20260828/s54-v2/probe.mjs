import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate as immediate } from "node:timers/promises";

const product = process.env.PRODUCT_ROOT;
const load = relative => import(pathToFileURL(path.join(product, relative)));
const api = await load("dist/index.js");
const command = await load("dist/commands/apply-patch/index.js");
const { Work, PatchError } = await load("dist/commands/apply-patch/shared.js");
const { settings } = await load("dist/commands/apply-patch/options.js");
const { contents } = await load("dist/commands/apply-patch/matcher.js");
const selected = process.env.FOCUS_IDS?.split(",");
const rows = [];
let registrations = 0, cleanupCalls = 0;
const patch = "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch\n";
const initial = "x".repeat(8192) + "\nold\n";
const encode = value => Buffer.from(value);
const decode = value => Buffer.from(value).toString("utf8");
const bare = signal => ({ cwd: "/work", signal: signal ?? new AbortController().signal });
async function memory(value = initial) {
  const filesystem = new api.MemoryFileSystem();
  await filesystem.mkdir("/work");
  await filesystem.writeFile("/work/a", encode(value));
  return filesystem;
}
function wrapped(filesystem, changes) {
  return new Proxy(filesystem, { get(target, key) {
    if (Object.hasOwn(changes, key)) return changes[key];
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
async function direct(filesystem, source = patch, options = {}, extra = {}) {
  const stdout = [], stderr = [], cleanups = [];
  const context = {
    ...bare(), command: "apply_patch", args: [source], env: {}, fs: filesystem,
    stdin: api.toByteSource(""),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { registrations++; cleanups.push(cleanup); }, ...extra,
  };
  let result, reason, failed = false;
  try { result = await command.createApplyPatchCommand(options).execute(context); }
  catch (error) { failed = true; reason = error; }
  finally {
    for (const cleanup of cleanups) { await cleanup(); cleanupCalls++; }
  }
  return { result, failed, reason, stdout: decode(Buffer.concat(stdout)), stderr: decode(Buffer.concat(stderr)) };
}
async function test(id, role, run) {
  if (selected && !selected.includes(id)) return;
  try { const detail = await run(); rows.push({ id, role, pass: true, detail }); }
  catch (error) { rows.push({ id, role, pass: false, error: error?.stack ?? String(error) }); }
  console.log(JSON.stringify({ focus: rows.at(-1) }));
}
await test("F01", "unmodified runtime: original S54-sized positive", async () => {
  const filesystem = await memory();
  const result = await direct(filesystem);
  assert.equal(result.result.exitCode, 0, result.stderr);
  assert.equal(decode(await filesystem.readFile("/work/a")), initial.replace("old", "new"));
});
await test("F02", "unmodified runtime: UTF8, CRLF, unterminated input", async () => {
  const original = "a".repeat(1023) + "🦉猫".repeat(1200) + "\r\nold";
  const filesystem = await memory(original);
  const result = await direct(filesystem);
  assert.equal(result.result.exitCode, 0, result.stderr);
  assert.equal(decode(await filesystem.readFile("/work/a")), original.replace(/old$/, "new"));
});
await test("F03", "unmodified runtime: host read schedules caller cancellation", async () => {
  const observations = [];
  for (const reason of [false, 0, "", { cancellation: "original" }]) {
    const filesystem = await memory();
    const controller = new AbortController();
    let scheduled, writes = 0;
    const filesystemView = wrapped(filesystem, {
      async readFile(...args) {
        const bytes = await filesystem.readFile(...args);
        scheduled ??= immediate().then(() => controller.abort(reason));
        return bytes;
      },
      async writeFile(...args) { writes++; return filesystem.writeFile(...args); },
    });
    const result = await direct(filesystemView, patch, {}, { signal: controller.signal });
    await scheduled;
    assert.equal(result.failed, true);
    assert.equal(result.reason, reason);
    assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); assert.equal(writes, 0);
    assert.equal(decode(await filesystem.readFile("/work/a")), initial);
    observations.push({ exactIdentity: true, writes, reasonType: typeof reason });
  }
  return observations;
});
await test("F04", "unmodified runtime: retained producer and cancellation cleanup", async () => {
  const filesystem = await memory();
  const controller = new AbortController();
  let pulls = 0, finalized = 0, scheduled;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      pulls++;
      scheduled = immediate().then(() => controller.abort(false));
      yield Buffer.alloc(8197, 120);
      pulls++;
      yield encode("unexpected");
    } finally { finalized++; }
  } };
  const result = await direct(filesystem, "", {}, { args: [], stdin, signal: controller.signal });
  await scheduled;
  assert.equal(result.failed, true); assert.equal(result.reason, false);
  assert.equal(pulls, 1); assert.equal(finalized, 1);
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  assert.equal(decode(await filesystem.readFile("/work/a")), initial);
  return { pulls, finalized };
});
await test("F05", "unmodified runtime: sink identity and no rollback", async () => {
  const filesystem = await memory();
  const result = await direct(filesystem, patch, {}, { stdout: { async write() { throw 0; } } });
  assert.equal(result.failed, true); assert.equal(result.reason, 0);
  assert.equal(decode(await filesystem.readFile("/work/a")), initial.replace("old", "new"));
});
await test("F06", "unmodified runtime: low work refusal", async () => {
  const filesystem = await memory();
  const result = await direct(filesystem, patch, { limits: { maxWork: 100 } });
  assert.equal(result.result.exitCode, 1); assert.match(result.stderr, /maxWork limit exceeded/);
  assert.equal(result.stdout, ""); assert.equal(decode(await filesystem.readFile("/work/a")), initial);
});
await test("F07", "unmodified runtime: file limit refusal", async () => {
  const filesystem = await memory();
  const result = await direct(filesystem, patch, { limits: { maxFileBytes: 8196 } });
  assert.equal(result.result.exitCode, 1); assert.equal(result.stdout, "");
  assert.equal(decode(await filesystem.readFile("/work/a")), initial);
});
await test("F08", "instrumented private helper and typed-array copy observer", async () => {
  const work = new Work(bare(), settings({}));
  const bytes = Uint8Array.from({ length: 8197 }, (_, index) => index % 251);
  const original = Uint8Array.prototype.set, chunks = [];
  let copied;
  Uint8Array.prototype.set = function(source, offset) { chunks.push(source.length); return original.call(this, source, offset); };
  try { copied = await work.copy(bytes); }
  finally { Uint8Array.prototype.set = original; work.close(); }
  assert.deepEqual(copied, bytes); assert.deepEqual(chunks, [4096, 4096, 5]);
  return { chunks, qualification: "prototype-instrumented, not RSS or unmodified runtime scheduling" };
});
await test("F09", "instrumented allocation admission", async () => {
  const work = new Work(bare(), settings({ limits: { maxWork: 8196 } }));
  const bytes = new Uint8Array(8197), original = globalThis.Uint8Array;
  let allocations = 0, rejected = false;
  globalThis.Uint8Array = new Proxy(original, { construct(target, args) { allocations++; return Reflect.construct(target, args); } });
  try { await work.copy(bytes); }
  catch (error) { assert.ok(error instanceof PatchError); assert.equal(error.message, "maxWork limit exceeded"); rejected = true; }
  finally { globalThis.Uint8Array = original; work.close(); }
  assert.equal(rejected, true); assert.equal(allocations, 0);
  return { allocations, qualification: "allocator interception, not measured RSS" };
});
await test("F10", "instrumented native encoding call size", async () => {
  const work = new Work(bare(), settings({}));
  const text = "a".repeat(1023) + "🦉猫".repeat(2000), target = Buffer.alloc(Buffer.byteLength(text));
  const original = TextEncoder.prototype.encodeInto, calls = [];
  let end;
  TextEncoder.prototype.encodeInto = function(source, destination) { calls.push(source.length); return original.call(this, source, destination); };
  try { end = await work.encodeInto(text, target, 0); }
  finally { TextEncoder.prototype.encodeInto = original; work.close(); }
  assert.equal(end, target.length); assert.equal(decode(target), text);
  assert.ok(calls.length > 1); assert.ok(calls.every(length => length <= 1024));
  return { calls };
});
await test("F11", "instrumented private charged-work intervals", async () => {
  const work = new Work(bare(), settings({}));
  const checkpoint = work.checkpoint.bind(work), observations = [];
  work.checkpoint = async () => { if (work.due) observations.push(work.units); return checkpoint(); };
  work.step(17);
  try { await work.charge(9000); }
  finally { work.close(); }
  assert.deepEqual(observations, [4096, 8192]); assert.equal(work.units, 9017);
  return { observations, charged: work.units, qualification: "private-field/prototype observation" };
});
await test("F12", "instrumented scans do not cross charged boundary", async () => {
  const work = new Work(bare(), settings({}));
  const step = work.step.bind(work), endpoints = [];
  work.step = amount => { step(amount); assert.ok(work.units <= work.nextYield); if (work.due) endpoints.push(work.units); };
  try {
    assert.equal(await work.utf8("a".repeat(4095) + "🦉" + "b".repeat(4100), 20000), 8199);
    assert.equal(await work.equal("x".repeat(8197), "x".repeat(8196) + "y"), false);
  } finally { work.close(); }
  assert.ok(endpoints.length >= 3); return { endpoints };
});
await test("F13", "unmodified runtime: NUL retains precedence over invalid UTF8", async () => {
  const filesystem = await memory(), bytes = Buffer.alloc(8197, 120);
  bytes[0] = 255; bytes[8196] = 0;
  const result = await direct(filesystem, "", {}, { args: [], stdin: api.toByteSource(bytes) });
  assert.equal(result.result.exitCode, 2); assert.match(result.stderr, /NUL bytes are unsupported/);
  assert.equal(decode(await filesystem.readFile("/work/a")), initial);
});
await test("F14", "unmodified runtime: inclusive file cap", async () => {
  const filesystem = await memory();
  const result = await direct(filesystem, patch, { limits: { maxFileBytes: 8197 } });
  assert.equal(result.result.exitCode, 0, result.stderr);
  assert.equal(decode(await filesystem.readFile("/work/a")), initial.replace("old", "new"));
});
await test("F15", "instrumented first charged yield abort(false), S54 input", async () => {
  const filesystem = await memory(), controller = new AbortController();
  const original = Work.prototype.checkpoint, endpoints = [];
  Work.prototype.checkpoint = async function() {
    if (this.due && !endpoints.length) { endpoints.push(this.units); controller.abort(false); }
    return original.call(this);
  };
  let result;
  try { result = await direct(filesystem, patch, {}, { signal: controller.signal }); }
  finally { Work.prototype.checkpoint = original; }
  assert.deepEqual(endpoints, [4096]); assert.equal(result.failed, true); assert.equal(result.reason, false);
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  assert.equal(decode(await filesystem.readFile("/work/a")), initial);
  return { endpoints, qualification: "injected at private checkpoint, not the original static S54 execution" };
});
await test("F16", "instrumented staged encoding admission", async () => {
  const work = new Work(bare(), settings({ limits: { maxWork: 350 } }));
  const original = globalThis.Uint8Array;
  let allocations = 0, rejected = false;
  globalThis.Uint8Array = new Proxy(original, { construct(target, args) { if (args[0] === 101) allocations++; return Reflect.construct(target, args); } });
  try { await contents({ kind: "add", added: ["x".repeat(100)] }, undefined, work); }
  catch (error) { assert.ok(error instanceof PatchError); assert.equal(error.message, "maxWork limit exceeded"); rejected = true; }
  finally { globalThis.Uint8Array = original; work.close(); }
  assert.equal(rejected, true); assert.equal(allocations, 0);
  return { allocations };
});
assert.equal(registrations, cleanupCalls, "all registered direct-command cleanups awaited");
console.log(JSON.stringify({ focusSummary: { cases: rows.length, passed: rows.filter(row => row.pass).length, registrations, cleanupCalls } }));
if (rows.some(row => !row.pass)) process.exitCode = 1;
