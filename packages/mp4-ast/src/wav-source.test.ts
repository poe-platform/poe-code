import assert from "node:assert/strict";
import { it } from "node:test";
import { buildProbeResultFromDoc, parseWav, probeWavSource, wavAst } from "./index.js";

function header(size: number, bits = 16, channels = 2, tag = 1) {
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, tag, true); view.setUint16(22, channels, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000 * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
  view.setUint32(40, size - 44, true);
  return bytes;
}

for (const [bits, channels, tag] of [[8, 1, 1], [16, 2, 1], [24, 3, 1], [32, 2, 3]]) {
  it(`matches the established WAV metadata schema for ${bits}/${channels}/${tag}`, async () => {
    const bytes = new Uint8Array(44 + 12500); bytes.set(header(bytes.length, bits, channels, tag));
    const expected = buildProbeResultFromDoc(parseWav(bytes, { decodeAudio: false }), bytes.length, "x.wav", {
      formatName: "wav", formatLongName: "WAV / WAVE (Waveform Audio)"
    });
    const actual = await probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + Math.min(length, 3)) }, { filename: "x.wav" });
    assert.deepEqual(actual, expected);
    assert.deepEqual(wavAst().probe(bytes, { filename: "x.wav" }), expected);
  });
}

it("probes a 512 MiB caller source using only bounded header reads", async () => {
  const size = 512 * 1024 * 1024 + 44, bytes = header(size), reads: [number, number][] = [];
  const result = await probeWavSource({ size, async read(offset, length) {
    reads.push([offset, length]);
    assert.ok(offset + length <= 44, "must not request PCM payload");
    return bytes.slice(offset, offset + length);
  }});
  assert.equal(result.format.size, String(size));
  assert.equal(result.streams[0]!.nb_frames, String(512 * 1024 * 1024 / 4 / 1024));
  assert.equal(result.streams[0]!.duration, "16777.216000");
  assert.ok(reads.length <= 4);
  assert.ok(reads.every(([, length]) => length <= 16));
});

it("rejects truncated reads and rechecks cancellation after an awaited read", async () => {
  await assert.rejects(probeWavSource({ size: 44, read: async () => new Uint8Array() }), /Unexpected end/);
  const controller = new AbortController(), reason = new Error("stop");
  await assert.rejects(probeWavSource({ size: 44, async read(offset, length) {
    controller.abort(reason); return header(44).slice(offset, offset + length);
  }}, { signal: controller.signal }), error => error === reason);
});

it("preserves last-data-chunk, clipping, defaults, and ignored RIFF size behavior", async () => {
  const bytes = new Uint8Array(64); bytes.set(header(44));
  const view = new DataView(bytes.buffer); view.setUint32(4, 0, true);
  view.setUint16(22, 0, true); view.setUint32(24, 0, true); view.setUint16(34, 0, true);
  bytes.set(new TextEncoder().encode("data"), 44); view.setUint32(48, 50, true);
  const expected = buildProbeResultFromDoc(parseWav(bytes, { decodeAudio: false }), bytes.length, "input.wav", {
    formatName: "wav", formatLongName: "WAV / WAVE (Waveform Audio)"
  });
  assert.deepEqual(await probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }), expected);
});

it("skips large unknown chunks and honors odd-byte padding", async () => {
  const skip = 256 * 1024 * 1024 + 1, dataOffset = 44 + skip + 1, size = dataOffset + 8 + 4096;
  const prefix = header(size); prefix.set(new TextEncoder().encode("JUNK"), 36);
  new DataView(prefix.buffer).setUint32(40, skip, true);
  const dataHeader = new Uint8Array(8); dataHeader.set(new TextEncoder().encode("data"));
  new DataView(dataHeader.buffer).setUint32(4, 4096, true);
  const result = await probeWavSource({ size, async read(offset, length) {
    if (offset < 44) return prefix.slice(offset, offset + length);
    assert.equal(offset, dataOffset); assert.equal(length, 8);
    return dataHeader;
  }});
  assert.equal(result.streams[0]!.duration, "0.128000");
  assert.equal(result.streams[0]!.nb_frames, "1");
});

it("propagates source failures, rejects overreads and never reads after cancellation", async () => {
  const reason = new Error("remote read failed");
  await assert.rejects(probeWavSource({ size: 44, async read() { throw reason; } }), error => error === reason);
  await assert.rejects(probeWavSource({ size: 44, async read() { return new Uint8Array(13); } }), /more bytes/);
  const controller = new AbortController(); controller.abort(reason);
  await assert.rejects(probeWavSource({ size: 44, async read() { assert.fail("cancelled read"); } }, { signal: controller.signal }), error => error === reason);
  for (const size of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(probeWavSource({ size, async read() { assert.fail("invalid size read"); } }), /Invalid WAV source size/);
});

it("preserves truncated fmt errors and rejects invalid signatures", async () => {
  const bytes = header(44).slice(0, 30);
  await assert.rejects(probeWavSource({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) }), RangeError);
  assert.throws(() => wavAst().probe(bytes), RangeError);
  await assert.rejects(probeWavSource({ size: 44, read: async (_offset, length) => new Uint8Array(length) }), /missing RIFF WAVE signature/);
});
