import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { createIconvCommand, createIconvCommands, iconvCommands, type IconvLimits } from "../../../src/commands/iconv/index.js";
import { run } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const args = ["-f", "UTF-8", "-t", "UTF-8"];
test("factories and actual Shell VFS redirection preserve raw bytes", async () => {
  assert.deepEqual(createIconvCommands().map(command => command.name), ["iconv"]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Uint8Array.of(0, 0x80, 0xe9, 0xff));
  const shell = new Shell({ fs });
  try {
    shell.commands.register(createIconvCommand());
    assert.throws(() => iconvCommands().setup({ commands: shell.commands, use() {}, registerFileSystem() {} }));
    shell.use(iconvCommands({ replace: true }));
    const result = await shell.exec("iconv -f latin1 -t UTF-8 input > output");
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile("/output")).toString("hex"), "00c280c3a9c3bf");
    assert.equal(Buffer.from(await fs.readFile("/input")).toString("hex"), "0080e9ff");
  } finally { await shell.dispose(); }
});

for (const limit of ["maxArguments", "maxArgumentBytes", "maxInputBytes", "maxBufferedBytes", "maxOutputBytes", "maxDiagnosticBytes", "maxWork", "maxChunks", "maxEmptyChunks"] as const satisfies readonly (keyof IconvLimits)[]) test(`invalid ${limit} rejected`, () => {
  for (const value of [0, -1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createIconvCommand({ limits: { [limit]: value } }), RangeError);
});

test("actual Shell owned output drains before cancellation settles", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(iconvCommands());
  const entered = deferred(), gate = deferred(), caller = new AbortController();
  let writes = 0, settled = false;
  const execution = shell.exec("iconv -f UTF-8 -t UTF-16LE", { stdin: Uint8Array.of(65), signal: caller.signal, stdout: {
    async write() { assert.fail("opaque output route"); },
    ownedOutput: { consumerClosed: new AbortController().signal, async write(bytes) { assert.deepEqual([...bytes], [65, 0]); writes++; entered.resolve(); await gate.promise; } },
  } });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise; caller.abort(0); await setImmediate(); assert.equal(settled, false);
    gate.resolve(); await assert.rejects(execution, reason => reason === 0); assert.equal(writes, 1);
    const result = await shell.exec("iconv -f UTF-8 -t UTF-8", { stdin: Uint8Array.of(65), limits: { maxOutputBytes: 1 } });
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "A");
  } finally { gate.resolve(); await execution.catch(() => {}); await shell.dispose(); }
});

for (const reason of [false, 0, "", null]) {
  test(`admitted buffered read drains before ${JSON.stringify(reason)} abort`, async () => {
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(65));
    fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
    const entered = deferred(), gate = deferred(), caller = new AbortController();
    let settled = false;
    fs.readFile = async () => { entered.resolve(); await gate.promise; return Uint8Array.of(65); };
    const execution = run([...args, "input"], undefined, {}, { fs, signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise; caller.abort(reason); await setImmediate(); assert.equal(settled, false);
      gate.resolve(); await assert.rejects(execution, error => error === reason);
    } finally { gate.resolve(); await execution.catch(() => {}); }
  });
  test(`admitted next and return drain before ${JSON.stringify(reason)} abort`, async () => {
    const entered = deferred(), gate = deferred(), returnEntered = deferred(), returnGate = deferred(), caller = new AbortController();
    let settled = false, returns = 0;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { entered.resolve(); await gate.promise; return { done: false, value: Uint8Array.of(65) }; },
      async return() { returns++; returnEntered.resolve(); await returnGate.promise; return { done: true, value: undefined }; },
    }; } };
    const execution = run(args, undefined, {}, { stdin, signal: caller.signal });
    void execution.then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise; caller.abort(reason); await setImmediate(); assert.equal(settled, false); assert.equal(returns, 0);
      gate.resolve(); await returnEntered.promise; await setImmediate(); assert.equal(settled, false);
      returnGate.resolve(); await assert.rejects(execution, error => error === reason); assert.equal(returns, 1);
    } finally { gate.resolve(); returnGate.resolve(); await execution.catch(() => {}); }
  });
  for (const method of ["stat", "capabilitiesFor", "readFile", "readStream"] as const) test(`abort from ${method} method getter prevents invocation: ${JSON.stringify(reason)}`, async () => {
    const fs: FileSystem = new MemoryFileSystem();
    await fs.writeFile("/input", Uint8Array.of(65));
    if (method === "readFile") fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
    const caller = new AbortController();
    let calls = 0;
    Object.defineProperty(fs, method, { get() { caller.abort(reason); return () => { calls++; throw new Error("unadmitted call"); }; } });
    await assert.rejects(run([...args, "input"], undefined, {}, { fs, signal: caller.signal }), error => error === reason);
    assert.equal(calls, 0);
  });
  test(`abort from write getter prevents invocation: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let calls = 0;
    await assert.rejects(run(args, Uint8Array.of(65), {}, { signal: caller.signal, stdout: { get write() { caller.abort(reason); return async () => { calls++; }; } } }), error => error === reason);
    assert.equal(calls, 0);
  });
  test(`abort from iterator factory getter prevents invocation: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let calls = 0;
    const stdin: ByteSource = { get [Symbol.asyncIterator]() { caller.abort(reason); return () => { calls++; throw new Error("unadmitted factory"); }; } };
    await assert.rejects(run(args, undefined, {}, { signal: caller.signal, stdin }), error => error === reason);
    assert.equal(calls, 0);
  });
}

test("limit failure and return failure both survive", async () => {
  const cleanup = new Error("return failed");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Uint8Array.of(65, 66) }; },
    async return() { throw cleanup; },
  }; } };
  await assert.rejects(run(args, undefined, { limits: { maxInputBytes: 1 } }, { stdin }), error => error instanceof AggregateError && error.errors[1] === cleanup);
});

test("cooperative timer cancellation interrupts finite in-memory work", async () => {
  const caller = new AbortController();
  const timer = setTimeout(() => caller.abort(false), 0);
  try { await assert.rejects(run(args, new Uint8Array(131_072).fill(65), {}, { signal: caller.signal }), error => error === false); }
  finally { clearTimeout(timer); }
});

test("stream chunk count and cumulative file input are bounded", async () => {
  let closed = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { try { for (;;) yield Uint8Array.of(65); } finally { closed++; } } };
  const result = await run(args, undefined, { limits: { maxChunks: 2 } }, { stdin });
  assert.equal(result.exitCode, 1); assert.equal(closed, 1); assert.equal(result.stdoutHex, "");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Uint8Array.of(65)); await fs.writeFile("/second", Uint8Array.of(66));
  const files = await run([...args, "first", "second"], undefined, { limits: { maxInputBytes: 1 } }, { fs });
  assert.equal(files.exitCode, 1); assert.equal(files.stdoutHex, "41");
});

test("all ISO-8859-1 bytes roundtrip without Windows-1252 substitutions", async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const encoded = await run(["-f", "latin1", "-t", "UTF-8"], bytes);
  const decoded = await run(["-f", "UTF-8", "-t", "latin1"], Buffer.from(encoded.stdoutHex, "hex"));
  assert.equal(encoded.exitCode, 0); assert.equal(decoded.exitCode, 0);
  assert.equal(decoded.stdoutHex, Buffer.from(bytes).toString("hex"));
});
