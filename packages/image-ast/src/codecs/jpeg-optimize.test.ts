import { expect, it } from "vitest";
import { decodeJpegImage, encodeJpegImage } from "./jpeg.js";
import type { RgbaImage } from "../ast.js";

for (const size of [1, 17]) for (const quality of [1, 100]) for (const samplingFactor of ["1x1", "2x2"]) {
  it(`preserves pixels with optimized tables for ${size}px, quality ${quality}, sampling ${samplingFactor}`, () => {
    const data = new Uint8Array(size * size * 4).fill(255);
    if (size > 1) for (let i = 0; i < data.length; i += 4) {
      data[i] = i * 17 % 256; data[i + 1] = i * 13 % 256; data[i + 2] = i * 7 % 256;
    }
    const image: RgbaImage = { width: size, height: size, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false };
    const standard = encodeJpegImage(image, { quality, samplingFactor });
    const optimized = encodeJpegImage(image, { quality, samplingFactor, jpegOptimizeCoding: true });
    expect(optimized.length).toBeLessThan(standard.length);
    expect(decodeJpegImage(optimized).data).toEqual(decodeJpegImage(standard).data);
  });
}
