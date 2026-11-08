import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeXbmImage, encodeXbmFromStorage } from "./xbm-output.js";
import { readXbmImage } from "./xbm.js";

it("preserves partial bytes across bounded storage chunks and scanlines", async () => {
  const image: RgbaImage = { width: 1101, height: 2, data: Uint8Array.from(Array.from({ length: 2202 }, (_, i) => i % 3 ? [255, 255, 255, 255] : [0, 0, 0, 255]).flat()), format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 };
  const expected = encodeXbmImage(image), chunks: Uint8Array[] = [];
  for await (const chunk of encodeXbmFromStorage({ ...image, position: 0 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return image.data.slice(position, position + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  expect(readXbmImage(expected).data).toEqual(image.data);
});
