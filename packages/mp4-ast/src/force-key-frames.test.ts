import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

for (const [times, keys] of [
  [[.75], [0, 3]], [[1.25, .5], [0, 2, 5]], [[.6], [0, 2]], [[.625], [0, 3]]
] as const) {
  it(`forces encoded IDR pictures through the MP4 API: ${times}`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 8, fps: 4, includeAudio: false }));
    const track = source.tracks[0]!;
    const decodedVideoFrames = Array.from({ length: 8 }, (_, index) => ({
      width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(index * 20),
      ptsSeconds: index / 4, durationSeconds: .25, keyframe: true
    }));
    const output = parseMp4(serializeMp4({ ...source, tracks: [{ ...track, samples: [], decodedVideoFrames }] }, { forceKeyFrames: times })).tracks[0]!;
    assert.deepEqual(output.samples.map(sample => sample.pts / output.timescale), decodedVideoFrames.map(frame => frame.ptsSeconds));
    assert.deepEqual(output.samples.flatMap((sample, index) => sample.isKeyframe ? [index] : []), keys);
    assert.deepEqual(output.samples.flatMap((sample, index) => (sample.data[4]! & 31) === 5 ? [index] : []), keys);
  });
}
