import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { FsError, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createHexdumpCommand, createHdCommand, createHexdumpCommands, hexdumpCommands, type HexdumpLimits } from "../../../src/commands/hexdump/index.js";
import { run } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("factories and plugin expose both aliases, with atomic collision preflight", async () => {
  assert.deepEqual(createHexdumpCommands().map(command => command.name), ["hexdump", "hd"]);
  assert.equal(createHdCommand().name, "hd");
  const shell = new Shell({ fs: new MemoryFileSystem() });
  try {
    shell.commands.register(createHdCommand());
    assert.throws(() => hexdumpCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    assert.equal(shell.commands.has("hexdump"), false);
    shell.use(hexdumpCommands({ replace: true }));
    const result = await shell.exec("hd -n1", { stdin: Buffer.from([255]) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "00000000  ff                                                |.|\n00000001\n");
  } finally { await shell.dispose(); }
});

for (const limit of ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxFormats", "maxWork", "maxEmptyChunks"] as const satisfies readonly (keyof HexdumpLimits)[]) {
  test(`invalid ${limit} rejected before execution`, () => {
    for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createHexdumpCommand({ limits: { [limit]: value } }), RangeError);
  });
}

for (const [args, input, limits, message] of [
  [["a", "b"], "", { maxArguments: 1 }, "argument count"],
  [["abc"], "", { maxArgumentBytes: 2 }, "argument bytes"],
  [[], "abc", { maxInputBytes: 2 }, "input bytes"],
  [[], "abc", { maxBufferedBytes: 2 }, "buffered bytes"],
  [[], "abc", { maxWork: 1 }, "work"],
  [["-CC"], "abc", { maxFormats: 1 }, "format count"],
] as const) test(`bounded ${message}`, async () => {
  const result = await run([...args], Buffer.from(input), { limits });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(Buffer.from(result.stderr, "hex").toString().includes(`${message} limit exceeded`));
});

test("zero length ignores skip and missing files without acquiring stdin or filesystem", async () => {
  const fs = new MemoryFileSystem();
  fs.stat = async () => assert.fail("unexpected stat");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.fail("unexpected stdin acquisition"); } };
  for (const args of [["-n0", "-s99", "missing"], ["-n0", "-s99"]]) {
    assert.deepEqual(await run(args, undefined, {}, { fs, stdin }), { exitCode: 0, stdout: "", stderr: "" });
  }
});

test("unsupported format programs are rejected without acquiring input", async () => {
  const stdin: ByteSource = { [Symbol.asyncIterator]() { assert.fail("unexpected input"); } };
  for (const flag of ["-e", "-f"]) {
    const result = await run([flag, "100000000000/1 %x"], undefined, {}, { stdin });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(Buffer.from(result.stderr, "hex").toString(), /custom formats are not supported/);
  }
});

test("numeric overflow fails closed before input", async () => {
  for (const args of [["-s9007199254740992"], ["-n9007199254740992"], ["-s9007199254740991m"]]) {
    assert.equal((await run(args)).exitCode, 1);
  }
});

test("stdout cap preserves whole previously emitted rows", async () => {
  const input = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const result = await run(["-C"], input, { limits: { maxOutputBytes: 79 } });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stdout, "hex").length, 79);
  assert.match(Buffer.from(result.stderr, "hex").toString(), /output bytes limit exceeded/);
});

test("diagnostic overflow preserves both the original and reporting errors", async () => {
  await assert.rejects(run(["-z"], undefined, { limits: { maxDiagnosticBytes: 1 } }), AggregateError);
});

test("stdout FsError is not mistaken for an input-file warning", async () => {
  const failure = new FsError("EIO");
  await assert.rejects(run(["-C"], Buffer.alloc(16), {}, {
    stdout: { async write() { throw failure; } }, stderr: { async write() { assert.fail("misattributed output failure"); } },
  }), error => error === failure);
});

test("fragment ownership survives Buffer producer reuse and partial repetitions", async () => {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    const reused = Buffer.alloc(16, 65);
    yield reused;
    reused.fill(66);
    yield reused;
    reused.fill(67);
    yield reused.subarray(0, 3);
  } };
  assert.deepEqual(await run(["-C"], undefined, {}, { stdin }), await run(["-C"], Buffer.concat([Buffer.alloc(16, 65), Buffer.alloc(16, 66), Buffer.alloc(3, 67)])));
});

test("iterator is returned on early count without a second pull", async () => {
  let pulled = 0, returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { pulled++; return { done: false, value: Buffer.alloc(64, 65) }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  assert.equal((await run(["-n1"], undefined, {}, { stdin })).exitCode, 0);
  assert.deepEqual({ pulled, returned }, { pulled: 1, returned: 1 });
});

test("empty-fragment count is bounded and cleanup runs", async () => {
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: new Uint8Array() }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const result = await run([], undefined, { limits: { maxEmptyChunks: 2 } }, { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(Buffer.from(result.stderr, "hex").toString(), /empty input chunks limit exceeded/);
  assert.equal(returned, 1);
});

test("empty-source loops yield to caller cancellation", async () => {
  const caller = new AbortController();
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { for (;;) yield new Uint8Array(); } };
  const execution = run([], undefined, { limits: { maxEmptyChunks: 100_000 } }, { stdin, signal: caller.signal });
  const cancellation = setImmediate().then(() => { caller.abort(false); });
  await assert.rejects(execution, error => error === false);
  await cancellation;
});

test("large buffered inputs yield to caller cancellation", async () => {
  const caller = new AbortController();
  const execution = run(["-s50000"], Buffer.alloc(65_536), {}, { signal: caller.signal });
  const cancellation = setImmediate().then(() => { caller.abort(null); });
  await assert.rejects(execution, error => error === null);
  await cancellation;
});

test("buffered-only VFS preserves bytes", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from([0, 127, 128, 255]));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  assert.deepEqual(await run(["-C", "input"], undefined, {}, { fs }), await run(["-C"], Buffer.from([0, 127, 128, 255])));
});

test("oversized buffered-only input is refused before readFile", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.alloc(4096));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  fs.readFile = async () => assert.fail("unbounded readFile");
  const result = await run(["input"], undefined, { limits: { maxInputBytes: 16 } }, { fs });
  assert.equal(result.exitCode, 1);
});

for (const property of ["stat", "capabilitiesFor", "readStream", "readFile"] as const) test(`cancellation in filesystem ${property} getter blocks invocation`, async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("A"));
  if (property === "readFile") fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const caller = new AbortController();
  let called = 0;
  Object.defineProperty(fs, property, { get() { caller.abort(0); return () => { called++; assert.fail("unadmitted method"); }; } });
  await assert.rejects(run(["input"], undefined, {}, { fs, signal: caller.signal }), error => error === 0);
  assert.equal(called, 0);
});

test("cancellation in iterator next getter blocks invocation and returns iterator", async () => {
  const caller = new AbortController();
  let returned = 0, called = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    get next() { caller.abort(""); return async () => { called++; return { done: true as const, value: undefined }; }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  await assert.rejects(run([], undefined, {}, { stdin, signal: caller.signal }), error => error === "");
  assert.deepEqual({ called, returned }, { called: 0, returned: 1 });
});

for (const diagnostic of [false, true]) test(`cancellation in ${diagnostic ? "stderr" : "stdout"} write getter blocks invocation`, async () => {
  const caller = new AbortController();
  let called = 0;
  const sink = { get write() { caller.abort(false); return async () => { called++; }; } };
  await assert.rejects(run(diagnostic ? ["-z"] : ["-C"], Buffer.alloc(16), {}, { signal: caller.signal, ...(diagnostic ? { stderr: sink } : { stdout: sink }) }), error => error === false);
  assert.equal(called, 0);
});

for (const reason of [false, 0, "", null]) {
  test(`synchronous stream acquisition abort cleans the admitted source: ${JSON.stringify(reason)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("A"));
    const caller = new AbortController();
    let returned = 0, pulled = 0;
    fs.readStream = () => {
      caller.abort(reason);
      return { [Symbol.asyncIterator]() { return {
        async next() { pulled++; return { done: true, value: undefined }; },
        async return() { returned++; return { done: true, value: undefined }; },
      }; } };
    };
    await assert.rejects(run(["input"], undefined, {}, { fs, signal: caller.signal }), error => Object.is(error, reason));
    assert.deepEqual({ pulled, returned }, { pulled: 0, returned: 1 });
  });

  test(`held next drains before returning iterator and caller reason: ${JSON.stringify(reason)}`, async () => {
    const entered = deferred(), gate = deferred();
    const caller = new AbortController();
    let returned = false, completed = false, settled = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { entered.resolve(); await gate.promise; completed = true; return { done: false, value: Buffer.from("A") }; },
      async return() { assert.equal(completed, true); returned = true; return { done: true, value: undefined }; },
    }; } };
    const execution = run([], undefined, {}, { stdin, signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      await setImmediate();
      assert.deepEqual({ returned, completed, settled }, { returned: false, completed: false, settled: false });
      gate.resolve();
      await assert.rejects(execution, error => Object.is(error, reason));
      assert.equal(returned, true);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });
}

test("actual Shell owned output drains and is charged once", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(hexdumpCommands());
  const entered = deferred(), gate = deferred(), caller = new AbortController();
  let writes = 0, settled = false;
  const execution = shell.exec("hexdump -C", { stdin: Buffer.alloc(16), signal: caller.signal, stdout: {
    async write() { assert.fail("opaque output route"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write() { writes++; entered.resolve(); await gate.promise; } },
  } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    caller.abort(0);
    await setImmediate();
    assert.equal(settled, false);
    gate.resolve();
    await assert.rejects(execution, error => error === 0);
    assert.equal(writes, 1);
    const result = await shell.exec("hexdump -C", { stdin: Buffer.alloc(16), limits: { maxOutputBytes: 88 } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, 88);
  } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

test("primary input-limit failure and failing return both survive", async () => {
  const cleanup = new Error("return failed");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Buffer.alloc(4) }; },
    async return() { throw cleanup; },
  }; } };
  await assert.rejects(run([], undefined, { limits: { maxInputBytes: 2 } }, { stdin }), error => error instanceof AggregateError && error.errors[1] === cleanup);
});

test("cancellation in streaming capability getter prevents source acquisition", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("A"));
  const caller = new AbortController();
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, get streamingRead() { caller.abort(false); return true; } });
  fs.readStream = () => assert.fail("source must not be acquired");
  await assert.rejects(run(["input"], undefined, {}, { fs, signal: caller.signal }), error => error === false);
});

test("cancellation in iterator factory getter prevents unadmitted factory invocation", async () => {
  const caller = new AbortController();
  let called = 0;
  const stdin: ByteSource = { get [Symbol.asyncIterator]() {
    caller.abort(null);
    return () => { called++; throw new Error("unadmitted factory"); };
  } };
  await assert.rejects(run([], undefined, {}, { stdin, signal: caller.signal }), error => error === null);
  assert.equal(called, 0);
});

test("admitted buffered read drains before cancellation settlement", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("A"));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const entered = deferred(), gate = deferred(), caller = new AbortController();
  let settled = false;
  fs.readFile = async () => { entered.resolve(); await gate.promise; return Buffer.from("A"); };
  const execution = run(["input"], undefined, {}, { fs, signal: caller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    caller.abort("");
    await setImmediate();
    assert.equal(settled, false);
    gate.resolve();
    await assert.rejects(execution, error => error === "");
  } finally { gate.resolve(); await execution.catch(() => {}); }
});

test("owned output consumer closure returns input and preserves its falsey reason", async () => {
  const consumer = new AbortController();
  let returned = 0, writes = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Buffer.alloc(32) }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  await assert.rejects(run(["-C"], undefined, {}, { stdin, stdout: {
    async write() { assert.fail("opaque output"); },
    ownedOutput: { consumerClosed: consumer.signal, async write() { writes++; consumer.abort(false); } },
  } }), error => error === false);
  assert.deepEqual({ writes, returned }, { writes: 1, returned: 1 });
});

test("input budget is cumulative across files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("AB"));
  await fs.writeFile("/second", Buffer.from("CD"));
  const result = await run(["-C", "first", "second"], undefined, { limits: { maxInputBytes: 3 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(Buffer.from(result.stderr, "hex").toString(), /input bytes limit exceeded/);
});
