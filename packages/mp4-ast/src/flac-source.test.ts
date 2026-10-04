import assert from "node:assert/strict";
import { it } from "node:test";
import { flacAst } from "./index.js";

function fixture(size = 42) {
  const bytes = new Uint8Array(size);
  bytes.set([102, 76, 97, 67, 128, 0, 0, 34].slice(0, size));
  if (size >= 42) new DataView(bytes.buffer).setBigUint64(18, (48000n << 44n) | (1n << 41n) | (23n << 36n) | 96000n);
  return bytes;
}
const options = { filename: "recording.flac", showPackets: true, showFrames: true };
it("probes FLAC through retained header reads without touching encoded audio", async () => {
  const bytes = fixture(512 * 1024), plugin = flacAst();
  assert.equal(typeof plugin.probeMetadata, "function");
  let read = 0;
  const result = await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) {
    assert.ok(offset + length <= 42); read += Math.min(length, 3); return bytes.slice(offset, offset + Math.min(length, 3));
  } }, options);
  assert.deepEqual(result, plugin.probe(bytes, options)); assert.equal(read, 42);
});
for (const size of [0, 3, 4, 26, 41, 42, 512 * 1024]) it(`preserves FLAC byte probe semantics for ${size} bytes in a borrowed stream`, async () => {
  const bytes = fixture(size), plugin = flacAst(); let closed = false;
  assert.equal(typeof plugin.probeMetadataStream, "function");
  async function* chunks() {
    const borrowed = new Uint8Array(7);
    try { for (let offset = 0; offset < size; offset += borrowed.length) { const length = Math.min(borrowed.length, size - offset); borrowed.set(bytes.subarray(offset, offset + length)); yield borrowed.subarray(0, length); } }
    finally { closed = true; borrowed.fill(0); }
  }
  const result = await plugin.probeMetadataStream!(chunks(), options);
  assert.deepEqual(result, plugin.probe(bytes, options)); assert.equal(closed, true);
});
it("propagates late FLAC stream failure after a complete header", async () => {
  const plugin = flacAst(); assert.equal(typeof plugin.probeMetadataStream, "function");
  await assert.rejects(plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield fixture(); throw new Error("late read"); } }), { message: "late read" });
});
it("rechecks cancellation after retained FLAC reads", async () => {
  const plugin = flacAst(), controller = new AbortController(); assert.equal(typeof plugin.probeMetadata, "function");
  await assert.rejects(plugin.probeMetadata!({ size: 42, async read() { controller.abort(new Error("cancelled read")); return fixture(); } }, { signal: controller.signal }), { message: "cancelled read" });
});
it("rejects incomplete retained FLAC reads", async () => {
  const plugin = flacAst(); assert.equal(typeof plugin.probeMetadata, "function");
  await assert.rejects(plugin.probeMetadata!({ size: 42, async read() { return new Uint8Array(); } }), { message: "Unexpected end of FLAC source" });
});
it("decodes STREAMINFO timing and whole-input packet size independently", async () => {
  const header = fixture();
  new DataView(header.buffer).setBigUint64(18, (48000n << 44n) | (1n << 41n) | (23n << 36n) | (1n << 32n) | 96000n);
  const result = await flacAst().probeMetadata!({ size: 2 ** 30, async read(offset, length) { return header.slice(offset, offset + length); } }, options);
  const stream = result.streams[0]!;
  assert.equal(stream.sample_rate, "48000"); assert.equal(stream.channels, 2);
  assert.equal(stream.duration_ts, 2 ** 32 + 96000); assert.equal(stream.nb_frames, "1");
  assert.equal(result.format.size, String(2 ** 30));
  assert.equal(Array.from(result.packets!)[0]!.size, String(2 ** 30));
  assert.equal(Array.from(result.frames!)[0]!.nb_samples, 2 ** 32 + 96000);
});
it("rejects oversized retained reads without retaining their bytes", async () => {
  await assert.rejects(flacAst().probeMetadata!({ size: 3, async read() { return fixture(); } }), { message: "FLAC source returned more bytes than requested" });
});
it("checks cancellation when a sequential FLAC source completes", async () => {
  const controller = new AbortController();
  await assert.rejects(flacAst().probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield fixture(); controller.abort(new Error("cancelled end")); } }, { signal: controller.signal }), { message: "cancelled end" });
});
