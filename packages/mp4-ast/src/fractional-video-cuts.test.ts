import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, sliceMp4 } from "./index.js";

for (const [endSeconds, count] of [[0.26, 1], [0.375, 2], [0.5, 2]] as const) {
  it(`decoded and packet video both round a ${endSeconds}s cut to track ticks`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 2, height: 2, fps: 4, frameCount: 6, includeAudio: false }));
    const track = { ...source.tracks[0]!, timescale: 4, duration: 6,
      samples: source.tracks[0]!.samples.map((sample, index) => ({ ...sample, dts: index, pts: index, cts: 0, duration: 1 })) };
    const frames = track.samples.map(sample => ({ width: 2, height: 2, data: new Uint8Array(16),
      ptsSeconds: sample.pts / track.timescale, durationSeconds: 0.25, keyframe: true }));
    const packet = sliceMp4({ ...source, tracks: [track] }, { endSeconds });
    const decoded = sliceMp4({ ...source, tracks: [{ ...track, decodedVideoFrames: frames }] }, { endSeconds });
    assert.equal(packet.tracks[0]!.samples.length, count);
    assert.deepEqual(decoded.tracks[0]!.decodedVideoFrames, frames.slice(0, count));
    assert.equal(decoded.tracks[0]!.duration, packet.tracks[0]!.duration);
  });
}
