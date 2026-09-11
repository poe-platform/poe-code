import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "../hexdump/helpers.js";

const asciiA = "00000000  41                                                |A|\n00000001\n";
const asciiAbcd = "00000000  41 42 43 44                                       |ABCD|\n00000004\n";

test("intrinsic four-byte input cannot claim a one-byte length", async () => {
  const chunk = Uint8Array.of(65, 66, 67, 68);
  let lengths = 0;
  Object.defineProperty(chunk, "length", { get() { lengths++; return 1; } });
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield chunk; } };
  const result = await run(["-C"], undefined, { limits: { maxInputBytes: 1 } }, { stdin });
  assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, lengths }, { exitCode: 1, stdout: "", lengths: 0 });
  assert.match(Buffer.from(result.stderr, "hex").toString(), /input bytes limit exceeded/);
});

test("finite replacement iterator cannot widen a one-byte input", async () => {
  const chunk = Uint8Array.of(65);
  let iterators = 0;
  Object.defineProperty(chunk, Symbol.iterator, { value: function* () { iterators++; yield 65; yield 66; yield 67; yield 68; } });
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield chunk; } };
  const result = await run(["-C"], undefined, { limits: { maxInputBytes: 1 } }, { stdin });
  assert.deepEqual({ exitCode: result.exitCode, stdout: Buffer.from(result.stdout, "hex").toString(), iterators }, { exitCode: 0, stdout: asciiA, iterators: 0 });
});

for (const reason of [false, 0, "", null]) {
  test("own length abort getter is never invoked " + JSON.stringify(reason), async () => {
    const caller = new AbortController(), chunk = Uint8Array.of(65, 66, 67, 68);
    let lengths = 0;
    Object.defineProperty(chunk, "length", { get() { lengths++; caller.abort(reason); return 1; } });
    const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield chunk; } };
    const result = await run(["-C"], undefined, { limits: { maxInputBytes: 4 } }, { stdin, signal: caller.signal });
    assert.deepEqual({ exitCode: result.exitCode, stdout: Buffer.from(result.stdout, "hex").toString(), lengths, aborted: caller.signal.aborted }, { exitCode: 0, stdout: asciiAbcd, lengths: 0, aborted: false });
  });

  test("own iterator abort getter is never invoked " + JSON.stringify(reason), async () => {
    const caller = new AbortController(), chunk = Uint8Array.of(65);
    let iterators = 0;
    Object.defineProperty(chunk, Symbol.iterator, { get() { iterators++; caller.abort(reason); return function* () { yield 65; yield 66; yield 67; yield 68; }; } });
    const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield chunk; } };
    const result = await run(["-C"], undefined, { limits: { maxInputBytes: 1 } }, { stdin, signal: caller.signal });
    assert.deepEqual({ exitCode: result.exitCode, stdout: Buffer.from(result.stdout, "hex").toString(), iterators, aborted: caller.signal.aborted }, { exitCode: 0, stdout: asciiA, iterators: 0, aborted: false });
  });
}

test("buffered fallback uses actual extent before snapshot retention", async () => {
  const fs: FileSystem = new MemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(65));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const chunk = Uint8Array.of(65, 66, 67, 68);
  let lengths = 0;
  Object.defineProperty(chunk, "length", { get() { lengths++; return 1; } });
  fs.readFile = async () => chunk;
  const result = await run(["-C", "file"], undefined, { limits: { maxInputBytes: 1 } }, { fs });
  assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, lengths }, { exitCode: 1, stdout: "", lengths: 0 });
  assert.match(Buffer.from(result.stderr, "hex").toString(), /buffered input bytes limit exceeded/);
});

for (const kind of ["Uint8Array", "Buffer"] as const) {
  test("intrinsic offset and ownership survive shadowed view properties " + kind, async () => {
    const backing = kind === "Buffer" ? Buffer.from([0, 65, 66, 67, 68, 0]) : Uint8Array.of(0, 65, 66, 67, 68, 0);
    const chunk = backing.subarray(1, 5);
    for (const property of ["length", "byteLength", "byteOffset", "buffer", "constructor"] as const) Object.defineProperty(chunk, property, { get() { assert.fail("untrusted " + property); } });
    Object.defineProperty(chunk, Symbol.iterator, { get() { assert.fail("untrusted iterator"); } });
    const stdin: ByteSource = { async *[Symbol.asyncIterator]() { try { yield chunk; } finally { backing.fill(255); } } };
    const result = await run(["-C", "-n4"], undefined, { limits: { maxInputBytes: 4 } }, { stdin });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(result.stdout, "hex").toString(), asciiAbcd);
    assert.ok(backing.every(byte => byte === 255));
  });
}
