import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createTableTextCommands } from "../../../src/commands/table-text/index.js";
import { fixture, runTable, toByteSource } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function proxyFs(base: FileSystem, methods: Partial<FileSystem>): FileSystem {
  return new Proxy(base, { get(target, key) {
    const value = key in methods ? Reflect.get(methods, key) : Reflect.get(target, key);
    return typeof value === "function" ? value.bind(key in methods ? methods : target) : value;
  } });
}

for (const command of ["paste", "comm", "join"] as const) {
  test(`${command}: invalid bytes survive one-byte chunks`, async () => {
    const input = command === "join" ? Buffer.from([97, 32, 255, 128, 10]) : Buffer.from([97, 255, 128, 10]);
    const specimen = { ...fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a other\n" }), stdinHex: input.toString("hex") };
    const result = await runTable(specimen, {}, {}, 1);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdoutHex.includes("ff80"));
  });

  test(`${command}: caller cancellation is exact, including errno-shaped reasons`, async () => {
    const controller = new AbortController(), reason = new FsError("ENOENT", { message: "caller stopped" });
    controller.abort(reason);
    await assert.rejects(runTable(fixture(command, ["-", "right"], { right: "a x\n" }), {}, { signal: controller.signal }), error => error === reason);
  });

  test(`${command}: pending reads cancel and close with no unhandled rejection`, async () => {
    const started = deferred(), controller = new AbortController(), reason = new Error("cancel pending input");
    let returned = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { started.resolve(); await new Promise(() => {}); return { done: true, value: undefined } as const; },
      async return() { returned = true; throw new Error("cleanup rejection must be observed"); },
    }; } };
    const running = runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a x\n" }), {}, { stdin, signal: controller.signal });
    const rejected = assert.rejects(running, error => error === reason);
    await started.promise; controller.abort(reason); await rejected;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returned, true);
  });

  test(`${command}: producer exceptions retain failure and cleanup`, async () => {
    let returned = false;
    const stdin = (async function* () { try { throw new Error("injected producer failure"); yield new Uint8Array(); } finally { returned = true; } })();
    const result = await runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right: "a x\n" }), {}, { stdin });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /injected producer failure/u); assert.equal(returned, true);
  });

  test(`${command}: unsupported locale is explicit where ordering is required`, async () => {
    const result = await runTable(fixture(command, ["left", "right"], { left: "a x\n", right: "a y\n" }), {}, { env: { LC_ALL: "en_US.UTF-8" } });
    assert.equal(result.exitCode, command === "paste" ? 0 : 1);
    if (command !== "paste") assert.match(result.stderr, /C\/POSIX/u);
  });
}

for (const [label, limits, specimen] of [
  ["input", { maxInputBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["chunk", { maxChunkBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["record", { maxRecordBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["output", { maxOutputBytes: 3 }, fixture("paste", [], {}, "abcd\n")],
  ["file", { maxFiles: 1 }, fixture("paste", ["left", "right"], { left: "a\n", right: "b\n" })],
  ["field", { maxFields: 2 }, fixture("join", ["left", "right"], { left: "a b c\n", right: "a x\n" })],
  ["argument", { maxArgumentBytes: 2 }, fixture("paste", ["--serial"])],
  ["join group byte", { maxGroupBytes: 4 }, fixture("join", ["left", "right"], { left: "a one\na two\n", right: "a x\n" })],
  ["join group record", { maxGroupRecords: 2 }, fixture("join", ["left", "right"], { left: "a one\na two\n", right: "a x\n" })],
] as const) {
  test(`bounded ${label} quota fails explicitly`, async () => {
    const result = await runTable(specimen, { limits });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, new RegExp(`${label} limit`));
  });
}

test("invalid limits fail at plugin construction", () => {
  for (const value of [0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createTableTextCommands({ limits: { maxSteps: value } }), RangeError);
});

test("paste shares one stdin cursor and owns returned chunk bytes", async () => {
  const bytes = Buffer.from("a\nb\n");
  const stdin = (async function* () { yield bytes; bytes.fill(120); yield Buffer.from("c\nd\n"); })();
  const result = await runTable(fixture("paste", ["-", "-"]), {}, { stdin });
  assert.equal(result.stdoutHex, Buffer.from("a\tb\nc\td\n").toString("hex"));
});

for (const command of ["paste", "comm", "join"] as const) {
  test(`${command}: records retain Buffer fragments after producer reuse`, async () => {
    const fragment = Buffer.from("a ");
    const stdin = (async function* () {
      yield fragment;
      fragment.fill(120);
      yield Buffer.from("value\n");
    })();
    const right = command === "join" ? "a other\n" : "a value\n";
    const expected = command === "paste" ? "a value\n" : command === "comm" ? "\t\ta value\n" : "a value other\n";
    const result = await runTable(fixture(command, command === "paste" ? ["-"] : ["-", "right"], { right }), {}, { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutHex, Buffer.from(expected).toString("hex"));
    assert.equal(fragment.toString(), "xx");
  });
}

test("empty chunk producers cannot starve cancellation or step limits", async () => {
  const controller = new AbortController(), reason = new Error("stop empty chunks");
  let closed = false;
  const stdin = (async function* () { try { while (true) yield new Uint8Array(); } finally { closed = true; } })();
  const running = runTable(fixture("paste", []), {}, { stdin, signal: controller.signal });
  const rejected = assert.rejects(running, error => error === reason);
  const timer = setTimeout(() => controller.abort(reason), 10);
  try { await rejected; } finally { clearTimeout(timer); }
  assert.equal(closed, true);
  const result = await runTable(fixture("paste", []), { limits: { maxSteps: 10 } }, { stdin: (async function* () { while (true) yield new Uint8Array(); })() });
  assert.match(result.stderr, /step limit/u);
});

test("paste awaits writes before reading another record", async () => {
  const blocked = deferred(), release = deferred();
  let reads = 0;
  const stdin = (async function* () { for (let index = 0; index < 3; index++) { reads++; yield Buffer.from(`${index}\n`); } })();
  const writes: Uint8Array[] = [];
  const running = runTable(fixture("paste", []), {}, { stdin, stdout: { async write(bytes) { writes.push(bytes.slice()); if (writes.length === 1) { blocked.resolve(); await release.promise; } } } });
  await blocked.promise; assert.equal(reads, 1); release.resolve(); await running;
  assert.equal(Buffer.concat(writes).toString(), "0\n1\n2\n");
});

test("blocked output cancellation propagates and releases its VFS input signal", async () => {
  const base = createMemoryFileSystem(), blocked = deferred(), controller = new AbortController(), reason = new Error("stop output");
  let sourceSignal: AbortSignal | undefined, closed = false;
  const fs = proxyFs(base, { readStream(_path, options) {
    sourceSignal = options?.signal;
    return (async function* () { try { yield Buffer.from("a\nb\n"); await new Promise(() => {}); } finally { closed = true; } })();
  } });
  const running = runTable(fixture("paste", ["file"], { file: "a\nb\n" }), {}, { fs, signal: controller.signal, stdout: { async write() { blocked.resolve(); await new Promise(() => {}); } } });
  const rejected = assert.rejects(running, error => error === reason);
  await blocked.promise; controller.abort(reason); await rejected;
  assert.equal(sourceSignal?.aborted, true);
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, true);
});

test("downstream EPIPE cancels owned VFS transfer without aborting caller", async () => {
  const base = createMemoryFileSystem(), controller = new AbortController();
  let sourceSignal: AbortSignal | undefined, closed = false;
  const fs = proxyFs(base, { readStream(_path, options) {
    sourceSignal = options?.signal;
    return (async function* () { try { yield Buffer.from("first\nsecond\n"); } finally { closed = true; } })();
  } });
  const result = await runTable(fixture("paste", ["file"], { file: "first\nsecond\n" }), {}, { fs, signal: controller.signal, stdout: { async write() { throw new FsError("EPIPE"); } } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /EPIPE/u); assert.equal(controller.signal.aborted, false); assert.equal(sourceSignal?.aborted, true); assert.equal(closed, true);
});

test("bounded readFile fallback passes a limit and signal", async () => {
  const base = createMemoryFileSystem();
  const fs = proxyFs(base, { readFile: async (path, options) => {
    assert.equal(options?.maxBytes, 32); assert.ok(options.signal); return base.readFile(path, options);
  } });
  const fallback = new Proxy(fs, { get(target, key) { return key === "readStream" ? undefined : Reflect.get(target, key); } });
  const result = await runTable(fixture("paste", ["file"], { file: "value\n" }), { limits: { maxChunkBytes: 32 } }, { fs: fallback });
  assert.equal(result.stdoutHex, Buffer.from("value\n").toString("hex"));
});

test("join Cartesian expansion is bounded by output quota", async () => {
  const result = await runTable(fixture("join", ["left", "right"], { left: "a one\na two\na three\n", right: "a x\na y\na z\n" }), { limits: { maxOutputBytes: 20 } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /output limit/u); assert.ok(result.stdoutHex.length <= 40);
});

test("suppressed comm output still enforces bounded work", async () => {
  const result = await runTable(fixture("comm", ["-123", "left", "right"], { left: "a\n".repeat(40), right: "a\n".repeat(40) }), { limits: { maxSteps: 20 } });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /step limit/u); assert.equal(result.stdoutHex, "");
});
