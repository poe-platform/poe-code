import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

for (const start of [0, 4]) {
  it(`preserves a missing run of MP4 samples starting at ${start}`, () => {
    const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12 }));
    const track = source.tracks[0]!;
    const samples = track.samples.filter((_, index) => index < start || index >= start + 4);
    const input = { ...source, tracks: [{ ...track, samples }] };
    const output = parseMp4(serializeMp4(input));
    const actual = output.tracks[0]!;
    const delay = actual.editList?.filter(edit => edit.mediaTime < 0)
      .reduce((sum, edit) => sum + edit.segmentDuration * actual.timescale / output.timescale, 0) ?? 0;
    assert.deepEqual(actual.samples.map(sample => [sample.dts + delay, sample.pts + delay, sample.data]),
      samples.map(sample => [sample.dts, sample.pts, sample.data]));
    assert.equal(output.durationSeconds, source.durationSeconds);
  });
}
