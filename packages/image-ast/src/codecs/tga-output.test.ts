import { expect, it } from "vitest";
import { encodeTgaImage } from "./tga-output.js";
import { decodeTgaImage } from "./tga.js";
import { encodeImage } from "./index.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const gray of [false, true]) {
  for (const alpha of [false, true]) {
    for (const rle of [false, true]) {
      it(`preserves raw and repeated packets across 128-pixel and storage boundaries (gray=${gray}, alpha=${alpha}, rle=${rle})`, async () => {
        const width = 1100, height = 2;
        const data = Uint8Array.from(Array.from({ length: width * height }, (_, index) => {
          const x = index % width;
          const value = x < 300 ? 40 : x % 251;
          return [value, gray ? value : x < 300 ? 60 : x % 239, gray ? value : Math.floor(index / width) * 200, alpha ? x % 7 === 0 ? 0 : 127 : 255];
        }).flat());
        const image: RgbaImage = { width, height, data, hasAlpha: alpha, channels: gray ? alpha ? 2 : 1 : alpha ? 4 : 3, format: "raw", depth: "uchar", space: gray ? "b-w" : "srgb", density: 72 };
        const options = { tgaCompression: rle ? "rle" as const : "none" as const };
        const encoded = encodeTgaImage(image, options);
        expect(encoded[2]).toBe((gray && !alpha ? 3 : 2) + (rle ? 8 : 0));
        expect(encoded[16]).toBe(alpha ? 32 : gray ? 8 : 24);
        expect(decodeTgaImage(encoded).data).toEqual(data);
        expect(encodeImage(image, { ...options, format: "tga" }).channels).toBe(alpha ? 4 : gray ? 1 : 3);
        const chunks: Uint8Array[] = [];
        const signal = new AbortController().signal;
        const stream = encodeStoredImage({ ...image, position: 0 }, {
          allocate() { throw new Error("Output must not allocate backing storage"); },
          async write() { throw new Error("Output must not mutate backing storage"); },
          async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return data.subarray(position, position + length); }
        }, signal, { ...options, format: "tga" });
        let next = await stream.next();
        while (!next.done) { chunks.push(next.value); next = await stream.next(); }
        expect(next.value?.channels).toBe(alpha ? 4 : gray ? 1 : 3);
        expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(encoded);
      });
    }
  }
}

it("rejects dimensions that cannot fit in a TGA header", () => {
  expect(() => encodeTgaImage({ width: 65536, height: 1, data: new Uint8Array(), hasAlpha: false } as RgbaImage, {})).toThrow("Invalid TGA dimensions");
});
