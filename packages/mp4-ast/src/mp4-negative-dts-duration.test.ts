import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

it("preserves video duration when encoder reordering starts DTS before zero", () => {
  const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 10, includeAudio: false }));
  const track = source.tracks[0]!;
  const delay = track.samples[0]!.duration * 2;
  const samples = track.samples.map(sample => ({ ...sample, dts: sample.dts - delay, cts: sample.cts + delay }));
  const output = parseMp4(serializeMp4({ ...source, tracks: [{ ...track, editList: undefined, samples }] }));
  assert.equal(output.durationSeconds, 1);
  assert.equal(output.tracks[0]!.duration / track.timescale, 1);
  assert.equal(output.tracks[0]!.editList?.[0]?.mediaTime, delay);
  assert.deepEqual(output.tracks[0]!.samples.map(sample => [sample.pts - delay, sample.dts - delay, sample.duration]),
    samples.map(sample => [sample.pts, sample.dts, sample.duration]));
});
