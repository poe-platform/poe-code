import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeOggAudio } from "./index.js";

it("applies Opus bitrate to audio packets while preserving sample count", () => {
  const pcm = [Float32Array.from({ length: 36000 }, (_, index) => 0.125 * Math.sin(index * 440 * 2 * Math.PI / 48000))];
  const low = encodeOggAudio("opus", 48000, pcm, 16000);
  const high = encodeOggAudio("opus", 48000, pcm, 128000);
  assert.ok(high.packets.reduce((size, packet) => size + packet.data.length, 0) >
    3 * low.packets.reduce((size, packet) => size + packet.data.length, 0));
  for (const encoded of [low, high]) {
    const preSkip = new DataView(encoded.headers[0]!.buffer).getUint16(10, true);
    assert.equal(encoded.packets.at(-1)!.granule - preSkip, 36000);
  }
});

it("rejects invalid Opus bitrates before entering the native encoder", () => {
  for (const bitrate of [-1, 499, 512001, 16000.5, NaN, Infinity, 2 ** 32 + 16000]) {
    assert.throws(() => encodeOggAudio("opus", 48000, [Float32Array.of(0)], bitrate), /Opus bitrate/);
  }
  assert.deepEqual(encodeOggAudio("opus", 48000, [Float32Array.of(0)], 0),
    encodeOggAudio("opus", 48000, [Float32Array.of(0)]));
});
