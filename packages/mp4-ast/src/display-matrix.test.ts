import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, muxMp4, parseMp4, serializeMp4 } from "./index.js";
import { matrixForRotation } from "./binary.js";

for (const matrix of [
  [-65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824],
  [65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824],
  [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824],
  [-65536, 0, 0, 0, 65536, 0, 3145728, 0, 1073741824]
]) {
  it(`preserves all display matrix entries ${matrix} on remux`, () => {
    const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 }));
    const input = parseMp4(serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, rotation: undefined, matrix })) }));
    const output = parseMp4(serializeMp4(muxMp4([input])));
    assert.deepEqual(output.tracks[0]!.matrix, matrix);
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), input.tracks[0]!.samples.map(sample => sample.data));
    for (const rotation of [0, 90, 180, 270]) {
      const rotated = parseMp4(serializeMp4(muxMp4([input], { rotation })));
      assert.deepEqual(rotated.tracks[0]!.matrix, matrixForRotation(rotation));
    }
  });
}
