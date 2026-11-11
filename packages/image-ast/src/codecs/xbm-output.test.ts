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

// ImageMagick 7.1.2-35 writes twelve uppercase byte literals per line,
// retaining the trailing comma and wrapping even immediately before the brace.
it.each([
  [5, "  0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, };\n"],
  [6, "  0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, \n  };\n"],
  [7, "  0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, 0xFF, 0x01, \n  0xFF, 0x01, };\n"],
] as const)("matches native XBM C formatting for a 9x%s bitmap", async (height, initializer) => {
  const image: RgbaImage = { width: 9, height, data: Uint8Array.from({ length: 9 * height * 4 }, (_, i) => i % 4 === 3 ? 255 : 0), format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 };
  const expected = `#define tile_width 9\n#define tile_height ${height}\nstatic char tile_bits[] = {\n${initializer}`;
  expect(new TextDecoder().decode(encodeXbmImage(image, "tile.xbm"))).toBe(expected);
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeXbmFromStorage({ ...image, position: 0 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { return image.data.slice(position, position + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal, "tile.xbm")) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe(expected);
});
