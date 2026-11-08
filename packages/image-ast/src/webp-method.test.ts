import { expect, it } from "vitest";
import { encode as referenceEncode, decode } from "@stacksjs/ts-webp";
import sharp, { encodeImage } from "./index.js";
import { encodeVP8 } from "./codecs/webp-vp8/encoder.js";
import { encodeLossyWebp } from "./codecs/webp-lossy.js";

for (const [width, height] of [[1, 1], [17, 19], [64, 48]]) {
  for (const alpha of [false, true]) {
    it(`preserves VP8 pixels across effort levels (${width}x${height}, alpha=${alpha})`, () => {
      const data = Uint8Array.from({ length: width! * height! * 4 }, (_, i) => i % 4 === 3 ? alpha ? i * 29 % 256 : 255 : i * 31 % 256);
      const image = { width: width!, height: height!, data };
      const baseline = referenceEncode(image, { lossless: false, quality: 80 });
      for (let effort = 0; effort <= 6; effort++) {
        const encoded = encodeLossyWebp(image, { quality: 80, effort });
        expect(encoded.length).toBeLessThanOrEqual(baseline.length);
        expect(decode(encoded)).toEqual(decode(baseline));
        if (effort === 0) expect(encoded).toEqual(baseline);
      }
    });
  }
}

it("passes effort through the image SDK and Sharp API", () => {
  const width = 64, height = 48;
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 31 % 256);
  const image = { width, height, data, channels: 4 as const, depth: "uchar" as const, space: "srgb" as const, hasAlpha: false, density: 72 };
  const fast = encodeImage(image, { format: "webp", lossless: false, quality: 80, effort: 0 }).data;
  const slow = encodeImage(image, { format: "webp", lossless: false, quality: 80, effort: 6 }).data;
  expect(slow.length).toBeLessThan(fast.length);
  const sdk = sharp(data, { raw: { width, height, channels: 4 } }).webp({ lossless: false, quality: 80, effort: 6 }).toBufferSync();
  expect(sdk).toEqual(slow);
});

it.each([-1, 7, 1.5, NaN, Infinity])("rejects invalid encoding effort %s", effort => {
  expect(() => encodeVP8({ width: 1, height: 1, data: new Uint8Array(4) }, { effort })).toThrow("effort");
});
