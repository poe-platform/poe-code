import assert from "node:assert/strict";
import { it } from "node:test";
import { mp3Ast } from "./index.js";

const options = { filename: "input.mp3", showPackets: true, showFrames: true };
function fixture() {
  const bytes = new Uint8Array(10 + 384 * 52 + 128);
  bytes.set([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 52; i++) bytes.set([255, 251, 148, 0], 10 + i * 384);
  bytes.set(new TextEncoder().encode("Info"), 10 + 36);
  bytes.set(new TextEncoder().encode("TAG"), bytes.length - 128);
  return bytes;
}
it("reads actual 48 kHz frames, excluding ID3 and Info metadata", async () => {
  const bytes = fixture(), plugin = mp3Ast();
  async function* chunks() {
    const borrowed = new Uint8Array(13);
    for (let pos = 0; pos < bytes.length; pos += 13) {
      const length = Math.min(13, bytes.length - pos);
      borrowed.set(bytes.subarray(pos, pos + length)); yield borrowed.subarray(0, length);
    }
    borrowed.fill(0);
  }
  const expected = plugin.probe(bytes, options);
  for (const result of [expected,
    await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + Math.min(length, 7)); } }, options),
    await plugin.probeMetadataStream!(chunks(), options)]) {
    const packets = Array.from(result.packets!), frames = Array.from(result.frames!);
    assert.equal(packets.length, 51); assert.equal(frames.length, 51);
    assert.equal(result.streams[0]!.nb_frames, undefined);
    assert.equal(result.streams[0]!.sample_rate, "48000");
    assert.equal(result.streams[0]!.time_base, "1/14112000");
    assert.deepEqual(packets.map(p => [p.pts, p.duration, p.size, p.pos]),
      Array.from({ length: 51 }, (_, i) => [i * 338688, 338688, "384", String(394 + i * 384)]));
    assert.equal(frames[0]!.nb_samples, 1152);
  }
});
it("preserves late source errors and completion cancellation", async () => {
  const plugin = mp3Ast();
  await assert.rejects(plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield new Uint8Array(4); throw new Error("late source"); } }), { message: "late source" });
  const controller = new AbortController();
  await assert.rejects(plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield new Uint8Array(4); controller.abort(new Error("cancelled end")); } }, { signal: controller.signal }), { message: "cancelled end" });
});
it("rejects invalid sizes and observes cancellation during record replay", async () => {
  const plugin = mp3Ast();
  for (const size of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(plugin.probeMetadata!({ size, async read() { throw new Error("payload read"); } }), /Invalid MP3 source size/);
  }
  const controller = new AbortController(), bytes = fixture();
  const result = await plugin.probeMetadata!({ size: bytes.length, async read(offset, length) { return bytes.slice(offset, offset + length); } }, { ...options, signal: controller.signal });
  const packets = result.packets![Symbol.iterator](); packets.next();
  controller.abort(new Error("cancelled replay"));
  assert.throws(() => packets.next(), /cancelled replay/);
});
it("applies Xing encoder delay and padding to decoded frame timestamps", () => {
  const bytes = fixture();
  bytes.set(new TextEncoder().encode("Lavc"), 10 + 44);
  // 576 encoder-delay samples and 576 padding samples; decoder delay is 529.
  bytes.set([36, 2, 64], 10 + 44 + 21);
  const frames = mp3Ast().probe(bytes, options).frames!;
  assert.equal(frames.length, 51);
  assert.equal(frames[0]!.pts, 324870);
  assert.equal(frames[0]!.nb_samples, 47);
  assert.equal(frames.at(-1)!.nb_samples, 1105);
});
for (const [header, size, samples, rate] of [
  [[255, 251, 146, 0], 418, 1152, 44100],
  [[255, 243, 128, 192], 208, 576, 22050],
  [[255, 227, 128, 192], 417, 576, 11025]
] as const) {
  it(`reads padded MPEG frames at ${rate} Hz`, async () => {
    const nextSize = size + (header[2] & 2 ? -1 : 1);
    const bytes = new Uint8Array(size + nextSize);
    bytes.set(header); bytes.set([header[0], header[1], header[2] ^ 2, header[3]], size);
    const result = mp3Ast().probe(bytes, options);
    assert.deepEqual(result.packets!.map(p => Number(p.size)), [size, nextSize]);
    assert.equal(result.packets![1]!.pts, samples * 14112000 / rate);
    assert.equal(result.frames![1]!.nb_samples, samples);
  });
}
it("rejects truncated frames and inputs without audio instead of inventing packets", async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(417), fixture().subarray(0, 500)]) {
    assert.throws(() => mp3Ast().probe(bytes, options));
    await assert.rejects(mp3Ast().probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield bytes; } }, options));
  }
});

it("uses each VBR frame's bitrate to locate the next packet", () => {
  const bytes = new Uint8Array(384 + 576 + 192);
  bytes.set([255, 251, 148, 0]);
  bytes.set([255, 251, 180, 0], 384);
  bytes.set([255, 251, 84, 0], 960);
  const result = mp3Ast().probe(bytes, options);
  assert.deepEqual(result.packets!.map(p => [p.pos, p.size, p.pts]), [
    ["0", "384", 0], ["384", "576", 338688], ["960", "192", 677376]
  ]);
});
