import { expect, it } from "vitest";
import { encodeTgaImage, encodeTgaFromStorage } from "./tga-output.js";
import { decodeTgaImage } from "./tga.js";
import type { RgbaImage } from "../ast.js";

for (const hasAlpha of [false, true]) {
  for (const isPalette of [false, true]) {
    for (const rle of [false, true]) {
      it(`packs RGB555 across packet and storage boundaries (alpha=${hasAlpha}, palette=${isPalette}, rle=${rle})`, async () => {
        const width = 1100;
        const data = Uint8Array.from(Array.from({ length: width * 2 }, (_, i) =>
          [16, 49, 82, i % width < 300 ? 132 : 66]).flat());
        const image: RgbaImage = { width, height: 2, data, hasAlpha, isPalette, channels: hasAlpha ? 4 : 3, format: "raw", depth: "uchar", space: "srgb", density: 72 };
        const options = { tgaDepth: 5, tgaCompression: rle ? "rle" as const : "none" as const };
        const bytes = encodeTgaImage(image, options);
        expect(bytes[isPalette ? 7 : 16]).toBe(16);
        expect([...bytes.subarray(18, 20)]).toEqual(isPalette || !rle ? [0xca, hasAlpha ? 0x88 : 0x08] : [0xff, 0xca]);
        const expected = data.map((value, i) => i % 4 === 3 ? !hasAlpha || value >= 128 ? 255 : 0 : value);
        if (isPalette) {
          expect(bytes[5]).toBe(hasAlpha ? 2 : 1);
          expect([...bytes.subarray(18, hasAlpha ? 22 : 20)]).toEqual(hasAlpha ? [0xca, 0x88, 0xca, 0x08] : [0xca, 0x08]);
        } else expect(decodeTgaImage(bytes).data).toEqual(expected);
        const chunks: Uint8Array[] = [];
        for await (const chunk of encodeTgaFromStorage({ ...image, position: 17 }, {
          allocate() { throw new Error("Must not allocate storage"); },
          async write() { throw new Error("Must not mutate storage"); },
          async read(position, length) {
            expect(length).toBeLessThanOrEqual(4096);
            return data.subarray(position - 17, position - 17 + length);
          }
        }, new AbortController().signal, options)) chunks.push(chunk);
        expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(bytes);
      });
    }
  }
}
