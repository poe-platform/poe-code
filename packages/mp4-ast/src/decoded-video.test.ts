import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

it("marks only encoded IDR pictures as sync samples", () => {
  const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 30, fps: 10, includeAudio: false }));
  const track = source.tracks[0]!;
  const decodedVideoFrames = Array.from({ length: 30 }, (_, index) => ({
    width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(index * 8),
    ptsSeconds: index / 10, durationSeconds: .1, keyframe: true
  }));
  const output = parseMp4(serializeMp4({ ...source, tracks: [{ ...track, samples: [], decodedVideoFrames }] }));
  const samples = output.tracks[0]!.samples;
  assert.equal(samples.length, 30);
  assert.ok(samples.some(sample => (sample.data[4]! & 0x1f) === 1));
  for (const sample of samples) assert.equal(sample.isKeyframe, (sample.data[4]! & 0x1f) === 5);
});
