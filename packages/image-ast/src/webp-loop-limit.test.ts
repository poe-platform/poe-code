import { expect, it } from "vitest";
import type { RgbaImage } from "./ast.js";
import { encodeWebpImage, readWebpMetadata } from "./codecs/webp.js";
import { encodeWebpFromStorage } from "./codecs/webp-storage.js";

for (const lossless of [false, true]) {
  it.each([
    { loop: undefined, expected: 65535 },
    { loop: 100000, expected: 65535 },
    { loop: 0, expected: 0 },
    { loop: 1, expected: 1 }
  ])(`bounds inherited and explicit loops in buffered and streamed WebP (lossless=${lossless}, %j)`, async ({ loop, expected }) => {
    const image: RgbaImage = {
      width: 1, height: 2, pageHeight: 1, pages: 2, delay: [20, 30], loop: 65536,
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
      format: "webp", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
    };
    const options = { lossless, ...(loop === undefined ? {} : { loop }) };
    const buffered = encodeWebpImage(image, options);
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeWebpFromStorage({ ...image, position: 0 }, {
      allocate() { throw new Error("unexpected allocation"); },
      async write() { throw new Error("unexpected write"); },
      async read(position, length) { return image.data.subarray(position, position + length); }
    }, new AbortController().signal, options)) chunks.push(chunk);
    expect(readWebpMetadata(buffered)).toMatchObject({ pages: 2, delay: [20, 30], loop: expected });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(buffered));
  });
}
