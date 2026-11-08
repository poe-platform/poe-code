import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "./index.js";

for (const faststart of [false, true]) {
  it(`interleaves tracks by decode time with valid chunk offsets (faststart=${faststart})`, () => {
    const doc = parseMp4(createSyntheticMp4({ frameCount: 3, fps: 2, includeAudio: false }));
    const original = doc.tracks[0]!;
    const tracks = [1000, 90000].map((timescale, index) => ({
      ...original, id: index + 1, timescale, duration: timescale * 1.5,
      samples: original.samples.map((sample, i) => ({
        ...sample, dts: i * timescale / 2, duration: timescale / 2,
        pts: [0, 1, 0.5][i]! * timescale,
        cts: ([0, 1, 0.5][i]! - i / 2) * timescale,
        data: new Uint8Array([index, i, ...sample.data])
      }))
    }));
    const bytes = serializeMp4({ ...doc, tracks }, { faststart });
    const output = parseMp4(bytes);
    const physicalOrder = output.tracks.flatMap((track, index) => track.samples.map(sample => ({
      index, time: sample.dts / track.timescale, offset: sample.offset!
    }))).sort((a, b) => a.offset - b.offset);
    assert.deepEqual(physicalOrder.map(({ index, time }) => [index, time]),
      [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]]);
    for (const [index, track] of output.tracks.entries()) {
      assert.deepEqual(track.samples.map(sample => sample.data), tracks[index]!.samples.map(sample => sample.data));
      assert.deepEqual(track.samples.map(({ dts, pts, duration }) => [dts, pts, duration]),
        tracks[index]!.samples.map(({ dts, pts, duration }) => [dts, pts, duration]));
      for (const sample of track.samples) {
        assert.deepEqual(bytes.subarray(sample.offset!, sample.offset! + sample.size), sample.data);
      }
    }
  });
}
