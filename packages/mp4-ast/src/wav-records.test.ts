import assert from "node:assert/strict";
import { it } from "node:test";
import { probeWavSource, probeWavStream, wavAst } from "./index.js";

function fixture(size = 44 + 10240) {
  const head = new Uint8Array(44), view = new DataView(head.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    head.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, 8000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); view.setUint32(40, size - 44, true);
  return head;
}

it("enumerates WAV packets and frames without retaining payload or record arrays", async () => {
  const bytes = new Uint8Array(10284); bytes.set(fixture(bytes.length));
  const options = { showPackets: true, showFrames: true, filename: "x.wav" };
  const expected = wavAst().probe(bytes, options);
  const source = await probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, options);
  async function* chunks() { for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7); }
  const stream = await probeWavStream(chunks(), options);
  for (const result of [source, stream]) {
    assert.ok(result.packets); assert.ok(result.frames);
    assert.equal(Array.isArray(result.packets), false); assert.equal(Array.isArray(result.frames), false);
    assert.deepEqual({ ...result, packets: Array.from(result.packets), frames: Array.from(result.frames) }, expected);
  }
});

it("enumerates a large closed source lazily and checks cancellation between records", async () => {
  const size = 512 * 1024 * 1024 + 44, head = fixture(size), controller = new AbortController();
  let closed = false, reads = 0;
  const result = await probeWavSource({ size, async read(offset, length) {
    assert.equal(closed, false); assert.ok(offset + length <= 44); reads++;
    return head.slice(offset, offset + length);
  } }, { showPackets: true, showFrames: true, signal: controller.signal });
  closed = true;
  assert.ok(result.packets); assert.ok(result.frames); assert.equal(reads, 4);
  const packets = result.packets[Symbol.iterator]();
  assert.equal(packets.next().value?.pts, 0); assert.equal(packets.next().value?.pts, 1024);
  const frames = result.frames[Symbol.iterator](); assert.equal(frames.next().value?.nb_samples, 1024);
  const reason = new Error("stop"); controller.abort(reason);
  assert.throws(() => packets.next(), error => error === reason); assert.throws(() => frames.next(), error => error === reason);
});

for (const [bits, channels, tag] of [[8, 1, 1], [24, 2, 1], [32, 2, 3], [64, 2, 3]]) {
  it(`preserves ${bits}/${channels}/${tag} packet and frame descriptors`, async () => {
    const bytes = new Uint8Array(10285); bytes.set(fixture(bytes.length)); const view = new DataView(bytes.buffer);
    view.setUint16(20, tag!, true); view.setUint16(22, channels!, true); view.setUint16(34, bits!, true);
    const options = { showPackets: true, showFrames: true };
    const result = await probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }, options);
    assert.deepEqual({ ...result, packets: [...result.packets!], frames: [...result.frames!] }, wavAst().probe(bytes, options));
  });
}
