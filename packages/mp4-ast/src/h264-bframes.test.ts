import assert from "node:assert/strict";
import { it } from "node:test";
import { BitReader } from "./binary.js";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./mp4.js";
import { decodeH264Samples } from "./h264.js";
import type { MediaVideoFrame } from "./types.js";

for (const frameCount of [1, 2, 3, 24, 49]) {
  it(`preserves ${frameCount} displayed pictures across B-frame runs and GOP boundaries`, () => {
    const input = createSyntheticMp4({ width: 16, height: 16, frameCount, fps: 12, includeAudio: false });
    let reference: MediaVideoFrame[] = [];
    for (const maxBFrames of [0, 1, 2, 16, 17, -1]) {
      const doc = parseMp4(input, { decodeFrames: true });
      const bytes = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track, samples: [] })) }, { maxBFrames });
      const track = parseMp4(bytes).tracks[0]!;
      assert.equal(track.samples.length, frameCount);
      assert.equal(track.codecDescriptions[0]!.profile, maxBFrames > 0 ? "Main" : "Constrained Baseline");
      const types = track.samples.map(sample => {
        const bits = new BitReader(sample.data.subarray(5));
        bits.readUE();
        return bits.readUE() % 5;
      });
      assert.equal(types.filter(type => type === 2).length, Math.ceil(frameCount / 24));
      assert.equal(types.includes(1), maxBFrames > 0 && frameCount > 1);
      let run = 0;
      for (const type of types) {
        run = type === 1 ? run + 1 : 0;
        assert.ok(run <= Math.min(16, Math.max(0, maxBFrames)));
      }
      const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, 16, 16, track.timescale)];
      assert.equal(frames.length, frameCount);
      frames.forEach((frame, i) => {
        assert.ok(Math.abs(frame.ptsSeconds - i / 12) < 0.00002);
        if (maxBFrames !== 0) assert.deepEqual(frame.data, reference[i]!.data, `picture ${i}, maxBFrames ${maxBFrames}`);
      });
      if (maxBFrames === 0) reference = frames;
    }
  });
}

it("rejects invalid SDK B-frame counts", () => {
  const doc = parseMp4(createSyntheticMp4({ frameCount: 1, includeAudio: false }));
  for (const maxBFrames of [NaN, Infinity, -2, 1.5, 2147483648]) {
    assert.throws(() => serializeMp4(doc, { maxBFrames }), /B-frame/);
  }
});
