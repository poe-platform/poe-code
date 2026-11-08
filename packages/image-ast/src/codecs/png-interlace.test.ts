import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { encodePngImage } from "./png.js";
import { encodePngFromStorage, type StoredPngEncodeOptions } from "./png-storage.js";
import type { RgbaImage } from "../ast.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
for (const retained of [false, true]) {
  it.each([
    { pngCoder: "png8" }, { pngCoder: "png24" }, { pngCoder: "png32" },
    { pngCoder: "png48" }, { pngCoder: "png64" },
    { pngColorType: 0 }, { pngColorType: 4 }, { palette: true },
  ] satisfies StoredPngEncodeOptions[])(`encodes Adam7 sample layouts with bounded reads (retained=${retained}, %j)`, async options => {
    const width = 2051, height = 3;
    const data = Uint8Array.from({length: width * height * 4}, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) % 4 * 60);
    const image: RgbaImage = {width, height, data, format: "png", space: options.pngColorType === 0 || options.pngColorType === 4 ? "b-w" : "srgb", channels: 3, hasAlpha: false, depth: "uchar", density: 72};
    const storage = {allocate: vi.fn(), write: vi.fn(), read: vi.fn(async (offset: number, length: number) => data.slice(offset, offset + length))};
    const chunks: Uint8Array[] = [];
    if (retained) {
      for await (const chunk of encodePngFromStorage({...image, position: 0}, storage, new AbortController().signal, {...options, pngInterlace: true})) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
        chunks.push(chunk);
      }
      expect(storage.read.mock.calls.every(([, length]) => length <= 4096)).toBe(true);
    } else {
      chunks.push(encodePngImage({...image, data: data.slice()}, {...options, pngInterlace: true, consumeInput: true}));
    }
    const encoded = Buffer.concat(chunks);
    expect(encoded[28]).toBe(1);
    const decode = (bytes: Uint8Array) => sharp(bytes).ensureAlpha().raw({depth: "ushort"}).toBuffer();
    expect(await decode(encoded)).toEqual(await decode(encodePngImage(image, options)));
  });
}
