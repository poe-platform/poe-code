import { expect, it } from "vitest";
import sharp, { encodeImage } from "./index.js";
import { sharpRgbToYuv420 } from "./codecs/webp-vp8/sharp-yuv.js";
import fixtures from "./webp-sharp-yuv-fixtures.json";

// YUV planes produced by libsharpyuv 0.4.2, SharpYuvConvert with kSharpYuvMatrixWebp.
// Includes odd dimensions and replicated borders; no VP8 quantization is involved.
for (const { width, height, y, u, v } of fixtures) {
  it(`matches native SharpYUV planes for ${width}x${height}`, () => {
    const data = Uint8Array.from(Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      return [(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255];
    }).flat());
    const pw = Math.ceil(width / 16) * 16, ph = Math.ceil(height / 16) * 16;
    const Y = new Uint8Array(pw * ph), U = new Uint8Array(pw * ph / 4), V = new Uint8Array(pw * ph / 4);
    sharpRgbToYuv420(data, width, height, pw, ph, Y, U, V);
    for (const [actual, expected, stride, w, h] of [
      [Y, y, pw, width, height],
      [U, u, pw / 2, Math.ceil(width / 2), Math.ceil(height / 2)],
      [V, v, pw / 2, Math.ceil(width / 2), Math.ceil(height / 2)]
    ] as const) {
      const native = Buffer.from(expected, "base64");
      expect(actual).toEqual(Uint8Array.from({ length: actual.length }, (_, i) => native[Math.min(Math.floor(i / stride), h - 1) * w + Math.min(i % stride, w - 1)]!));
    }
  });
}

it("passes smartSubsample through the SDK and leaves lossless output unchanged", () => {
  const width = 17, height = 19;
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 31 % 256);
  const image = { width, height, data, channels: 4 as const, depth: "uchar" as const, space: "srgb" as const, hasAlpha: true, density: 72 };
  for (const lossless of [false, true]) {
    const normal = encodeImage(image, { format: "webp", lossless, smartSubsample: false }).data;
    const sharpYuv = encodeImage(image, { format: "webp", lossless, smartSubsample: true }).data;
    const sdk = sharp(data, { raw: { width, height, channels: 4 } }).webp({ lossless, smartSubsample: true }).toBufferSync();
    expect(sdk).toEqual(sharpYuv);
    if (lossless) expect(sharpYuv).toEqual(normal);
    else expect(sharpYuv).not.toEqual(normal);
  }
});
