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

for (const rle of [undefined, true, false]) {
  for (const compressible of [false, true]) {
    it(`selects native Targa storage for compressible=${compressible}, rle=${rle}`, () => {
      const data = compressible
        ? Uint8Array.from(Array.from({ length: 72 }, (_, i) => {
          const x = i % 24, y = Math.floor(i / 24);
          return [33 + 70 * y, 17 + 65 * Math.floor(x / 8), 128 - 24 * y, 32 + 64 * Math.floor(x / 8)];
        }).flat())
        : Uint8Array.from({ length: 288 }, (_, i) => 43 * i % 256);
      const compressed = compressible && rle !== false;
      const bytes = encodeTga({ width: 24, height: 3, data }, {
        ...(rle === undefined ? {} : { rle }),
        budget: new MediaBudgetTracker({ maxOutputBytes: compressed ? 89 : 332 })
      });
      assert.equal(bytes[2], compressed ? 10 : 2);
      assert.equal(bytes.length, compressed ? 89 : 332);
      assert.deepEqual(bytes.subarray(-26), Uint8Array.from([
        ...new Uint8Array(8), ...new TextEncoder().encode("TRUEVISION-XFILE.\0")
      ]));
      assert.deepEqual(decodeTga(bytes).data, data);
    });
  }
}
