import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeTgaImage, encodeTgaFromStorage } from "./tga-output.js";
import { decodeTgaImage } from "./tga.js";

for (const rle of [false, true]) for (const alpha of [false, true]) {
  it(`writes bounded indexed packets without changing pixels (rle=${rle}, alpha=${alpha})`, async () => {
    const width = 1100, height = 2;
    const data = Uint8Array.from(Array.from({ length: width * height }, (_, i) => {
      const value = i % width < 300 ? 0 : i % 256;
      return [value, 255 - value, 60, alpha ? value : 255];
    }).flat());
    const image: RgbaImage = { width, height, data, format: "raw", space: "srgb", channels: alpha ? 4 : 3, hasAlpha: alpha, depth: "uchar", density: 72, isPalette: true };
    const options = { tgaCompression: rle ? "rle" as const : "none" as const };
    const bytes = encodeTgaImage(image, options);
    expect(bytes[2]).toBe(rle ? 9 : 1);
    expect(bytes[16]).toBe(8);
    const paletteSize = new DataView(bytes.buffer).getUint16(5, true), stride = bytes[7]! / 8;
    expect(paletteSize).toBe(256);
    expect(stride).toBe(alpha ? 4 : 3);
    const indices: number[] = [];
    for (let offset = 18 + paletteSize * stride; offset < bytes.length;) {
      const packet = rle ? bytes[offset++]! : 0, count = (packet & 127) + 1;
      if (packet & 128) indices.push(...Array<number>(count).fill(bytes[offset++]!));
      else for (let i = 0; i < count; i++) indices.push(bytes[offset++]!);
    }
    expect(indices).toHaveLength(width * height);
    const pixels = indices.flatMap(index => {
      const offset = 18 + index * stride;
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset], alpha ? bytes[offset + 3] : 255];
    });
    expect(pixels).toEqual([...data]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeTgaFromStorage({ ...image, position: 17 }, {
      allocate() { throw new Error("Output must not allocate backing storage"); },
      async write() { throw new Error("Output must not mutate backing storage"); },
      async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return data.subarray(position - 17, position - 17 + length); }
    }, new AbortController().signal, options)) chunks.push(chunk);
    expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(bytes);
  });

  for (const isPalette of [false, true]) {
    it(`preserves true-color output when indexing is unavailable (rle=${rle}, alpha=${alpha}, palette=${isPalette})`, () => {
      const width = isPalette ? 257 : 6;
      const data = Uint8Array.from(Array.from({ length: width }, (_, i) => [i % 256, Math.floor(i / 256), 60, alpha ? 127 : 255]).flat());
      const image: RgbaImage = { width, height: 1, data, format: "raw", space: "srgb", channels: alpha ? 4 : 3, hasAlpha: alpha, depth: "uchar", density: 72, isPalette };
      const bytes = encodeTgaImage(image, { tgaCompression: rle ? "rle" : "none" });
      expect(bytes[2]).toBe(rle ? 10 : 2);
      expect(bytes[16]).toBe(alpha ? 32 : 24);
      expect(decodeTgaImage(bytes).data).toEqual(data);
    });
  }
}
