import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

const args = ["-f", "UTF-8", "-t", "UTF-8"];
for (const reason of [false, 0, "", null]) {
  for (const property of ["done", "value", "next"] as const) test(`abort in ${property} getter: ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    let doneReads = 0, valueReads = 0, nextCalls = 0, returns = 0;
    const iterator = {
      get next() {
        if (property === "next") controller.abort(reason);
        return async () => {
          nextCalls++;
          return {
            get done() { doneReads++; if (property === "done") controller.abort(reason); return false; },
            get value() { valueReads++; if (property === "value") controller.abort(reason); return Uint8Array.of(65); },
          };
        };
      },
      async return() { returns++; return { done: true as const, value: undefined }; },
    };
    await assert.rejects(run(args, undefined, {}, { signal: controller.signal, stdin: { [Symbol.asyncIterator]: () => iterator } }), error => error === reason);
    assert.deepEqual({ doneReads, valueReads, nextCalls, returns }, { doneReads: property === "next" ? 0 : 1, valueReads: property === "value" ? 1 : 0, nextCalls: property === "next" ? 0 : 1, returns: 1 });
  });
  for (const property of ["cwd", "type", "capabilitiesFor", "readStream"] as const) test(`abort before VFS admission from ${property}: ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    const memory = new MemoryFileSystem();
    await memory.writeFile("/input", Uint8Array.of(65));
    let forbidden = 0, returns = 0, advances = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return { async next() { advances++; return { done: false, value: Uint8Array.of(65) }; }, async return() { returns++; return { done: true, value: undefined }; } }; } };
    const fs = new Proxy(memory, { get(target, key) {
      if (key === "stat") return async () => ({ ...await memory.stat("/input"), get type() { if (property === "type") controller.abort(reason); return "file"; } });
      if (key === "capabilitiesFor") { if (property === "type") forbidden++; if (property === "capabilitiesFor") controller.abort(reason); return undefined; }
      if (key === "capabilities") { if (property === "capabilitiesFor") forbidden++; return target.capabilities; }
      if (key === "readStream") return () => { if (property === "readStream") controller.abort(reason); return source; };
      return Reflect.get(target, key, target);
    } });
    const overrides: Partial<CommandContext> = { signal: controller.signal, fs };
    if (property === "cwd") {
      Object.defineProperty(overrides, "cwd", { enumerable: true, get() { controller.abort(reason); return "/"; } });
    }
    await assert.rejects(run([...args, "input"], undefined, {}, overrides), error => error === reason);
    assert.equal(forbidden, 0); assert.equal(advances, 0); assert.equal(returns, property === "readStream" ? 1 : 0);
  });
}

test("sample result.value once before its byte-budget admission", async () => {
  let values = 0, advances = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return { async next() {
    if (advances++) return { done: true, value: undefined };
    return { done: false, get value() { values++; return values === 1 ? Uint8Array.of(65) : Uint8Array.of(65, 66, 67, 68); } };
  } }; } };
  assert.deepEqual(await run(args, undefined, { limits: { maxInputBytes: 1 } }, { stdin }), { exitCode: 0, stdoutHex: "41", stderrHex: "" });
  assert.equal(values, 1);
});

test("copies producer bytes before advancing or returning", async () => {
  const buffer = Uint8Array.of(65);
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { try { yield buffer; buffer[0] = 66; yield buffer; } finally { buffer[0] = 90; } } };
  assert.deepEqual(await run(args, undefined, {}, { stdin }), { exitCode: 0, stdoutHex: "4142", stderrHex: "" });
});

test("late read failure emits no converted prefix", async () => {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { yield Uint8Array.of(65); throw new FsError("EIO"); } };
  const result = await run(args, undefined, {}, { stdin });
  assert.equal(result.exitCode, 1); assert.equal(result.stdoutHex, "");
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "iconv: error while reading the input: Input/output error\n");
});

for (const [limit, maximum] of [["maxInputBytes", 1], ["maxBufferedBytes", 1], ["maxOutputBytes", 1], ["maxWork", 1], ["maxArguments", 1], ["maxArgumentBytes", 1]] as const) test(`bounded ${limit}`, async () => {
  const result = await run(args, Uint8Array.of(65, 66), { limits: { [limit]: maximum } });
  assert.equal(result.exitCode, 1); assert.match(Buffer.from(result.stderrHex, "hex").toString(), /limit exceeded/);
});

test("empty chunk iteration is bounded and closed", async () => {
  let closed = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { try { for (;;) yield new Uint8Array(); } finally { closed++; } } };
  const result = await run(args, undefined, { limits: { maxEmptyChunks: 2 } }, { stdin });
  assert.equal(result.exitCode, 1); assert.equal(closed, 1);
});

test("unsupported codecs reject before acquiring input", async () => {
  let acquired = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { acquired++; yield* []; } };
  for (const encoding of ["Windows-1252", "UTF-32", "NO_SUCH_ENCODING"]) {
    const result = await run(["-f", encoding, "-t", "UTF-8"], undefined, {}, { stdin });
    assert.equal(result.exitCode, 1); assert.match(Buffer.from(result.stderrHex, "hex").toString(), /unsupported encoding/);
  }
  assert.equal(acquired, 0);
});
