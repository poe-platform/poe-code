import { createRequire } from "node:module";
import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodePngImage } from "./png.js";
import { encodePngFromStorage } from "./png-storage.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
for (const retained of [false, true]) {
  for (const pngInterlace of [false, true]) {
    it.each([
      { step: 255, depth: 1 }, { step: 85, depth: 2 }, { step: 17, depth: 4 }, { step: 1, depth: 8 },
      { step: 255, depth: 8, pngBitDepth: 8 as const },
      { step: 255, depth: 16, pngBitDepth: 16 as const },
      { step: 255, depth: 8, alpha: true },
      { step: 255, depth: 8, pngCoder: "png24" as const },
    ])(`preserves grayscale pixels with $depth-bit output (stored=${retained}, interlace=${pngInterlace}): %j`, async ({ step, depth, alpha, ...options }) => {
      const width = 2051, height = 9;
      const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? alpha ? 128 : 255 : Math.floor(i / 4) % (255 / step + 1) * step);
      const image: RgbaImage = { width, height, data, format: "png", space: "b-w", channels: alpha ? 2 : 1, hasAlpha: !!alpha, depth: "uchar", density: 72 };
      const chunks: Uint8Array[] = [];
      if (retained) {
        const storage = { allocate() { return 0; }, async write() {}, async read(offset: number, length: number) {
          expect(length).toBeLessThanOrEqual(4096);
          return data.slice(offset, offset + length);
        } };
        for await (const chunk of encodePngFromStorage({ ...image, position: 0 }, storage, new AbortController().signal, { ...options, pngInterlace })) chunks.push(chunk);
      } else chunks.push(encodePngImage({ ...image, data: data.slice() }, { ...options, pngInterlace, consumeInput: true }));
      const encoded = Buffer.concat(chunks);
      expect(await sharp(encoded).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(data));
      expect([...encoded.subarray(24, 26)]).toEqual([depth, options.pngCoder ? 2 : alpha ? 4 : 0]);
    });
  }
}
