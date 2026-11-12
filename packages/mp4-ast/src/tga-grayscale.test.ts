import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeTga } from "./containers/tga.js";

function grayscale(rle: boolean, descriptor = 32, payload = rle ? [0x82, 17, 2, 80, 160, 255] : [17, 17, 17, 80, 160, 255]) {
  const header = new Uint8Array(18);
  header[0] = 2;
  header[2] = rle ? 11 : 3;
  header[12] = 2;
  header[14] = 3;
  header[16] = 8;
  header[17] = descriptor;
  return Uint8Array.from([...header, 65, 66, ...payload]);
}

for (const rle of [false, true]) {
  for (const descriptor of [0, 16, 32, 48]) {
    it(`decodes grayscale with image ID and origin ${descriptor}, rle=${rle}`, () => {
      // The repeated packet crosses a row; the raw packet contains distinct samples.
      const rows = [[17, 17], [17, 80], [160, 255]];
      if (!(descriptor & 32)) rows.reverse();
      if (descriptor & 16) rows.forEach(row => row.reverse());
      const image = decodeTga(grayscale(rle, descriptor));
      assert.equal(image.width, 2);
      assert.equal(image.height, 3);
      assert.deepEqual([...image.data], rows.flat().flatMap(gray => [gray, gray, gray, 255]));
    });
  }
  it(`rejects truncated grayscale pixels and exhausted budgets, rle=${rle}`, () => {
    const input = grayscale(rle);
    assert.throws(() => decodeTga(input.subarray(0, -1)), /Truncated TGA pixels/);
    for (const limits of [{ maxMemoryBytes: 23 }, { maxPixelsPerFrame: 5 }]) {
      assert.throws(() => decodeTga(input, { limits }));
    }
    input[16] = 24;
    assert.throws(() => decodeTga(input), /Unsupported TGA image format/);
  });
}
for (const [payload, error] of [
  [[], "Truncated TGA RLE packet"],
  [[0x80], "Truncated TGA pixels"],
  [[0x86, 17], "TGA RLE packet exceeds image dimensions"]
] as const) {
  it(`rejects malformed grayscale RLE: ${error}`, () => {
    assert.throws(() => decodeTga(grayscale(true, 32, [...payload])), { message: error });
  });
}
