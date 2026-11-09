import assert from "node:assert/strict";
import { it } from "node:test";
import { yuv420pToRgba } from "./binary.js";

// Native FFmpeg 7.0.2 RGB24 output, including luma outside the legal range.
for (const { chroma, rgb } of [
  {
    chroma: [128, 128, 128, 128],
    rgb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
      253, 253, 253, 255, 255, 255, 255, 255, 255, 255, 255, 255]
  },
  {
    chroma: [16, 240, 240, 16],
    rgb: [159, 0, 0, 176, 0, 0, 0, 47, 225, 0, 48, 226,
      255, 204, 27, 255, 206, 29, 77, 255, 255, 99, 255, 255]
  }
]) {
  it(`converts limited-range YUV with chroma ${chroma.join(",")} before clipping RGB`, () => {
    const rgba = yuv420pToRgba(Uint8Array.from([0, 15, 16, 17, 234, 235, 236, 255]),
      Uint8Array.from(chroma.slice(0, 2)), Uint8Array.from(chroma.slice(2)), 4, 2);
    assert.deepEqual([...rgba], rgb.flatMap((value, index) => index % 3 === 2 ? [value, 255] : [value]));
  });
}
