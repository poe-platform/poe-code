import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";

const raw = rawAudioAsts();
for (const format of ["f32le", "f32be", "f64le", "f64be"]) {
  for (const output of ["s8", "u8"]) {
    it(`rounds ${format} directly to ${output} precision`, () => {
      const values = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5,
        -0.5 - 1 / 512, -0.5 + 1 / 512, 0.5 - 1 / 512, 0.5 + 1 / 512,
        -256, -128, 127, 127.5, 256];
      const width = format.startsWith("f32") ? 4 : 8;
      const bytes = new Uint8Array(values.length * width);
      const view = new DataView(bytes.buffer);
      values.forEach((value, i) => {
        if (width === 4) view.setFloat32(i * width, value / 128, format.endsWith("le"));
        else view.setFloat64(i * width, value / 128, format.endsWith("le"));
      });
      const doc = raw.find(plugin => plugin.id === format)!.parse(bytes);
      const actual = raw.find(plugin => plugin.id === output)!.serialize(doc);
      const expected = [-2, -2, 0, 0, 2, 2, -1, 0, 0, 1, -128, -128, 127, 127, 127];
      assert.deepEqual(actual, Uint8Array.from(expected, value => output === "u8" ? value + 128 : value));
    });
  }
}
