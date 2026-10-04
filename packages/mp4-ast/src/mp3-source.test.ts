import assert from "node:assert/strict";
import { it } from "node:test";
import { mp3Ast } from "./index.js";

const options = { filename: "input.mp3", showPackets: true, showFrames: true };
for (const size of [0, 3, 416, 417, 418, 833, 834, 512 * 1024]) {
  it(`preserves MP3 media probe semantics for ${size} bytes without reading payload`, async () => {
    const plugin = mp3Ast();
    assert.equal(typeof plugin.probeMetadata, "function");
    const result = await plugin.probeMetadata!({ size, async read() { throw new Error("payload read"); } }, options);
    assert.deepEqual({ ...result, packets: Array.from(result.packets!), frames: Array.from(result.frames!) }, plugin.probe(new Uint8Array(size), options));
    assert.deepEqual(Array.from(result.packets!), Array.from(result.packets!));
  });
}
it("counts borrowed MP3 streams through EOF without retaining chunks", async () => {
  const plugin = mp3Ast(); let closed = false;
  assert.equal(typeof plugin.probeMetadataStream, "function");
  async function* chunks() {
    const borrowed = new Uint8Array(13);
    try { for (let i = 0; i < 100; i++) { borrowed.fill(i); yield borrowed; } }
    finally { closed = true; borrowed.fill(0); }
  }
  const result = await plugin.probeMetadataStream!(chunks(), options);
  assert.equal(closed, true);
  assert.deepEqual({ ...result, packets: Array.from(result.packets!), frames: Array.from(result.frames!) }, plugin.probe(new Uint8Array(1300), options));
});
it("handles large logical MP3 inputs with lazy records and independent timing", async () => {
  const plugin = mp3Ast(); assert.equal(typeof plugin.probeMetadata, "function");
  const size = 2 ** 40, count = Math.floor(size / 417);
  const result = await plugin.probeMetadata!({ size, async read() { throw new Error("payload read"); } }, options);
  assert.equal(result.format.size, String(size));
  assert.equal(result.streams[0]!.nb_frames, String(count));
  assert.equal(result.streams[0]!.duration_ts, count * 1152);
  const packets = result.packets![Symbol.iterator]();
  assert.equal(packets.next().value?.pos, "0");
  assert.equal(packets.next().value?.pos, "417");
  assert.equal(packets.next().value?.pts, 2304);
});
it("preserves late source errors and completion cancellation", async () => {
  const plugin = mp3Ast(); assert.equal(typeof plugin.probeMetadataStream, "function");
  await assert.rejects(plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield new Uint8Array(4); throw new Error("late source"); } }), { message: "late source" });
  const controller = new AbortController();
  await assert.rejects(plugin.probeMetadataStream!({ async *[Symbol.asyncIterator]() { yield new Uint8Array(4); controller.abort(new Error("cancelled end")); } }, { signal: controller.signal }), { message: "cancelled end" });
});
it("rejects invalid sizes and observes cancellation during record replay", async () => {
  const plugin = mp3Ast(); assert.equal(typeof plugin.probeMetadata, "function");
  for (const size of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(plugin.probeMetadata!({ size, async read() { throw new Error("payload read"); } }), /Invalid MP3 source size/);
  }
  const controller = new AbortController();
  const result = await plugin.probeMetadata!({ size: 834, async read() { throw new Error("payload read"); } }, { ...options, signal: controller.signal });
  const packets = result.packets![Symbol.iterator](); packets.next();
  controller.abort(new Error("cancelled replay"));
  assert.throws(() => packets.next(), /cancelled replay/);
});
