import { expect, it } from "vitest";
import { GifPalette } from "./codecs/gif-output-parts.js";

it("retains dominant source colors after exceeding the exact palette capacity", () => {
  const palette = new GifPalette();
  const colors = [
    [24, 133, 194],
    [38, 167, 92],
    [247, 214, 33]
  ];
  for (const [r, g, b] of colors) {
    for (let i = 0; i < 10000; i++) palette.add(r!, g!, b!, 255);
  }
  for (let i = 0; i < 1024; i++) palette.add(i & 255, i >>> 2, 119, 255);
  palette.finish();
  for (const [r, g, b] of colors) {
    const at = palette.index(r!, g!, b!, 255) * 3;
    expect(Array.from(palette.bytes.slice(at, at + 3))).toEqual([r, g, b]);
  }
  expect(palette.index(255, 255, 255, 255)).toBe(254);
  expect(palette.index(255, 255, 255, 0)).toBe(255);
});

import { decodeGifImage, encodeGifImage } from "./codecs/gif.js";

it("preserves every animation frame, timing, loop, white and transparency with a quantized palette", () => {
  const width = 32,
    pageHeight = 16,
    frames = 3;
  const data = new Uint8Array(width * pageHeight * frames * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let i = 0; i < width * pageHeight; i++) {
      data.set(
        [i & 255, 60 + frame * 70, 100 + (i >>> 8), 255],
        (frame * width * pageHeight + i) * 4
      );
    }
    data.set([255, 255, 255, 255, 73, 99, 121, 0], frame * width * pageHeight * 4);
  }
  const bytes = encodeGifImage({
    width,
    height: pageHeight * frames,
    pageHeight,
    data,
    format: "raw",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density: 72,
    hasAlpha: true,
    delay: [80, 120, 160],
    loop: 3
  });
  const decoded = decodeGifImage(bytes, { animated: true });
  expect(decoded).toMatchObject({
    width,
    height: pageHeight * frames,
    pageHeight,
    pages: frames,
    delay: [80, 120, 160],
    loop: 3
  });
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * width * pageHeight * 4;
    expect(Array.from(decoded.data.slice(start, start + 4))).toEqual([255, 255, 255, 255]);
    expect(decoded.data[start + 7]).toBe(0);
    let error = 0;
    for (let i = start + 8; i < start + width * pageHeight * 4; i += 4) {
      expect(decoded.data[i + 3]).toBe(255);
      for (let c = 0; c < 3; c++) error += Math.abs(decoded.data[i + c]! - data[i + c]!);
    }
    expect(error / ((width * pageHeight - 2) * 3)).toBeLessThan(1);
  }
});
