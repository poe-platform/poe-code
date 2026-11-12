import assert from "node:assert/strict";
import { it } from "node:test";
import { decodeTga } from "./containers/tga.js";

function rgb555(rle: boolean, descriptor = 32, payload = rle
  ? [0x82, 0x04, 0xc1, 2, 0x1f, 0, 0xe0, 3, 0xff, 0x7f]
  : [0x04, 0xc1, 0x04, 0xc1, 0x04, 0xc1, 0x1f, 0, 0xe0, 3, 0xff, 0x7f]) {
  const header = new Uint8Array(18);
  header[0] = 2;
  header[2] = rle ? 10 : 2;
  header[12] = 2;
  header[14] = 3;
  header[16] = 16;
  header[17] = descriptor;
  return Uint8Array.from([...header, 65, 66, ...payload]);
}

for (const rle of [false, true]) {
  for (const descriptor of [0, 16, 32, 48]) {
    it(`decodes packed RGB555 with image ID and origin ${descriptor}, rle=${rle}`, () => {
      // A repeated packet crosses rows, followed by a raw packet of distinct colors.
      const color = [132, 66, 33, 255];
      const rows = [[color, color], [color, [0, 0, 255, 255]], [[0, 255, 0, 255], [255, 255, 255, 255]]];
      if (!(descriptor & 32)) rows.reverse();
      if (descriptor & 16) rows.forEach(row => row.reverse());
      const image = decodeTga(rgb555(rle, descriptor));
      assert.equal(image.width, 2);
      assert.equal(image.height, 3);
      assert.deepEqual([...image.data], rows.flat(2));
    });
  }
  it(`rejects truncated RGB555 pixels and exhausted budgets, rle=${rle}`, () => {
    const input = rgb555(rle);
    assert.throws(() => decodeTga(input.subarray(0, -1)), /Truncated TGA pixels/);
    for (const limits of [{ maxMemoryBytes: 23 }, { maxPixelsPerFrame: 5 }]) {
      assert.throws(() => decodeTga(input, { limits }));
    }
  });
}
for (const [payload, error] of [
  [[], "Truncated TGA RLE packet"],
  [[0x80, 0], "Truncated TGA pixels"],
  [[0x86, 0, 0], "TGA RLE packet exceeds image dimensions"]
] as const) {
  it(`rejects malformed RGB555 RLE: ${error}`, () => {
    assert.throws(() => decodeTga(rgb555(true, 32, [...payload])), { message: error });
  });
}
