import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, sliceMp4 } from "./index.js";

for (const [startSeconds, first] of [[1.01, 4], [1.124999, 4], [1.125, 5], [1.24, 5], [1.25, 5], [1.375, 6]] as const) {
  it(`decoded video seek ${startSeconds} rounds to its timebase`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 2, height: 2, fps: 4, frameCount: 6, includeAudio: false }));
    const frames = Array.from({ length: 6 }, (_, i) => ({
      width: 2, height: 2, ptsSeconds: i / 4, durationSeconds: 0.25, keyframe: true,
      data: new Uint8Array(16).fill(i)
    }));
    const track = { ...source.tracks[0]!, timescale: 4, duration: 6, samples: [], decodedVideoFrames: frames };
    const sliced = sliceMp4({ ...source, tracks: [track] }, { startSeconds });
    assert.deepEqual(sliced.tracks[0]!.decodedVideoFrames,
      frames.slice(first).map(frame => ({ ...frame, ptsSeconds: frame.ptsSeconds - first / 4 })));
    assert.equal(sliced.tracks[0]!.duration, 6 - first);
    assert.equal(sliced.durationSeconds, (6 - first) / 4);
    assert.equal(track.decodedVideoFrames, frames);
  });
}
