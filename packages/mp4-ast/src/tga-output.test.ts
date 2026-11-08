import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeTga, decodeTga } from "./containers/tga.js";
import { MediaBudgetTracker } from "./types.js";

for (const rle of [false, true]) {
  for (const width of [1, 127, 128, 129, 300]) {
    it(`round trips mixed raw/repeated packets at width ${width}, rle=${rle}`, () => {
      const data = Uint8Array.from(Array.from({ length: width * 3 }, (_, i) =>
        [i < width ? 42 : i % 7 === 0 ? 255 : i % 256, i % 3, 80, i % 256]).flat());
      const frame = { width, height: 3, data };
      assert.deepEqual(decodeTga(encodeTga(frame, { rle })).data, data);
      const repeated = { ...frame, data: new Uint8Array(data.length).fill(120) };
      assert.deepEqual(decodeTga(encodeTga(repeated, { rle })).data, repeated.data);
    });
  }
}
it("rejects invalid dimensions, truncated RGBA and exhausted output/memory budgets", () => {
  for (const frame of [
    { width: 65536, height: 1, data: new Uint8Array(0) },
    { width: 1, height: 1, data: new Uint8Array(3) }
  ]) assert.throws(() => encodeTga(frame), /Invalid TGA/);
  const frame = { width: 1, height: 1, data: new Uint8Array(4) };
  for (const limits of [{ maxMemoryBytes: 1 }, { maxOutputBytes: 1 }]) {
    assert.throws(() => encodeTga(frame, { budget: new MediaBudgetTracker(limits) }));
  }
});
