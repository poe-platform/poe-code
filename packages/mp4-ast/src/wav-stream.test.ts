import assert from "node:assert/strict";
import { it } from "node:test";
import { probeWavStream, wavAst } from "./index.js";

function wav(dataSize = 8193) {
  const bytes = new Uint8Array(44 + dataSize), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 8000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  view.setUint32(40, dataSize, true); return bytes;
}

for (const chunkSize of [1, 3, 7, 16, 4096, 20000]) {
  it(`matches byte probing with borrowed ${chunkSize}-byte chunks`, async () => {
    const bytes = wav(), scratch = new Uint8Array(chunkSize);
    async function* source() {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const length = Math.min(chunkSize, bytes.length - offset);
        scratch.set(bytes.subarray(offset, offset + length)); yield scratch.subarray(0, length); scratch.fill(255);
      }
    }
    assert.deepEqual(await probeWavStream(source(), { filename: "stream.wav" }), wavAst().probe(bytes, { filename: "stream.wav" }));
  });
}

it("consumes a large payload without allocating a payload-sized buffer", async () => {
  const size = 8 * 1024 * 1024, head = wav(0), zero = new Uint8Array(16384);
  new DataView(head.buffer).setUint32(40, size, true);
  let reads = 0;
  async function* source() { yield head; for (let i = 0; i < size; i += zero.length) { reads++; yield zero; } }
  const Original = globalThis.Uint8Array;
  globalThis.Uint8Array = new Proxy(Original, { construct(target, args) {
    if (typeof args[0] === "number") assert.ok(args[0] <= 16, "parser allocated a payload buffer");
    return Reflect.construct(target, args);
  }});
  try {
    const result = await probeWavStream(source());
    assert.equal(result.format.size, String(size + 44)); assert.equal(result.streams[0]!.duration, "262.144000");
    assert.equal(reads, size / zero.length);
  } finally { globalThis.Uint8Array = Original; }
});

it("preserves clipping, trailing partial headers and truncated fmt errors", async () => {
  const complete = wav();
  for (const size of [0, 8, 12, 19, 20, 28, 35, 36, 40, 44, 99, complete.length]) {
    const bytes = complete.slice(0, size);
    async function* source() { yield bytes; }
    let expected;
    try { expected = wavAst().probe(bytes); } catch (error) {
      await assert.rejects(probeWavStream(source()), candidate => candidate instanceof Error && error instanceof Error && candidate.message === error.message);
      continue;
    }
    assert.deepEqual(await probeWavStream(source()), expected);
  }
});

it("preserves source failure priority over an earlier malformed signature", async () => {
  const reason = new Error("late source failure"); let closed = false;
  async function* source() { try { yield new Uint8Array(44); throw reason; } finally { closed = true; } }
  await assert.rejects(probeWavStream(source()), error => error === reason); assert.equal(closed, true);
});

it("checks cancellation after an awaited chunk and returns its iterator", async () => {
  const controller = new AbortController(), reason = new Error("cancelled"); let closed = false;
  async function* source() { try { controller.abort(reason); yield wav(); } finally { closed = true; } }
  await assert.rejects(probeWavStream(source(), { signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
});

it("preserves padded unknown chunks, later fmt and last data selection", async () => {
  const bytes = new Uint8Array(44 + 12 + 24 + 8 + 5), view = new DataView(bytes.buffer);
  bytes.set(wav(0));
  bytes.set(new TextEncoder().encode("JUNK"), 44); view.setUint32(48, 3, true); bytes.set([1, 2, 3], 52);
  bytes.set(new TextEncoder().encode("fmt "), 56); view.setUint32(60, 16, true);
  view.setUint16(64, 1, true); view.setUint16(66, 1, true); view.setUint32(68, 1000, true); view.setUint16(78, 8, true);
  bytes.set(new TextEncoder().encode("data"), 80); view.setUint32(84, 100, true);
  async function* source() { for (let offset = 0; offset < bytes.length; offset += 5) yield bytes.subarray(offset, offset + 5); }
  const result = await probeWavStream(source());
  assert.deepEqual(result, wavAst().probe(bytes));
  assert.equal(result.streams[0]!.duration, "0.005000"); assert.equal(result.streams[0]!.sample_rate, "1000");
});

it("does not acquire a source after pre-cancellation", async () => {
  const controller = new AbortController(), reason = new Error("already cancelled"); controller.abort(reason);
  await assert.rejects(probeWavStream({ [Symbol.asyncIterator]() { assert.fail("source acquired"); } }, { signal: controller.signal }), error => error === reason);
});
