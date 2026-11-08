import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { encodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";
import type { RgbaImage } from "../ast.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
for (const retained of [false, true]) {
  for (const pngInterlace of [false, true]) {
    it(`packs monochrome rows and partial bytes (stored=${retained}, interlace=${pngInterlace})`, async () => {
      const width = 2051, height = 9;
      const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 || Math.floor(i / 4) % 3 === 0 ? 255 : 0);
      const image: RgbaImage = { width, height, data, format: "png", space: "b-w", channels: 1, hasAlpha: false, depth: "uchar", density: 72 };
      const options = { pngBitDepth: 1 as const, pngInterlace, consumeInput: true };
      const chunks: Uint8Array[] = [];
      if (retained) {
        const storage = { async allocate() { return 0; }, async write() {}, async read(offset: number, length: number) {
          expect(length).toBeLessThanOrEqual(4096);
          return data.slice(offset, offset + length);
        } };
        for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, options)) chunks.push(chunk);
      } else chunks.push(encodePngImage({ ...image, data: data.slice() }, options));
      const encoded = Buffer.concat(chunks);
      expect([...encoded.subarray(24, 26)]).toEqual([1, 0]);
      expect(await sharp(encoded).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(data));
    });
  }
}
