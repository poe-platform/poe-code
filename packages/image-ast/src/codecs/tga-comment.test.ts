import { expect, it } from "vitest";
import { encodeImage } from "./index.js";
import { decodeTgaImage } from "./tga.js";
import { encodeStoredImage } from "../image-encode.js";
import type { RgbaImage } from "../ast.js";

for (const tgaCompression of ["none", "rle"] as const) {
  it.each([
    { name: "absent", properties: {}, id: [] },
    { name: "empty", properties: { comment: "" }, id: [] },
    { name: "ASCII", properties: { comment: "ticket" }, id: [116, 105, 99, 107, 101, 116] },
    { name: "UTF-8", properties: { comment: "café" }, id: [99, 97, 102, 195, 169] },
    { name: "255-byte limit", properties: { comment: "x".repeat(256) }, id: Array(255).fill(120) },
    { name: "partial UTF-8 at limit", properties: { comment: "x".repeat(254) + "é" }, id: [...Array(254).fill(120), 195] },
    { name: "partial four-byte UTF-8 at limit", properties: { comment: "x".repeat(254) + "😀" }, id: [...Array(254).fill(120), 240] },
    { name: "NUL terminator", properties: { comment: "a\0b" }, id: [97] },
  ])(`writes the $name comment before ${tgaCompression} pixels in both encoders`, async ({ properties, id }) => {
    // ImageMagick 7.1.2-35 writes min(strlen(comment), 255) bytes at offset 18.
    const image: RgbaImage = { width: 2, height: 1, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 128),
      format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72, properties };
    const options = { format: "tga" as const, tgaCompression };
    const encoded = encodeImage(image, options).data;
    expect(encoded[0]).toBe(id.length);
    expect([...encoded.subarray(18, 18 + id.length)]).toEqual(id);
    const pixels = [0, 0, 255, 255, 255, 0, 0, 128];
    expect([...encoded.subarray(18 + id.length)]).toEqual(tgaCompression === "rle" ? [1, ...pixels] : pixels);
    expect(decodeTgaImage(encoded).data).toEqual(image.data);
    const chunks: Uint8Array[] = [];
    const stream = encodeStoredImage({ ...image, position: 0 }, {
      allocate() { throw new Error("Unexpected allocation"); },
      async write() { throw new Error("Unexpected write"); },
      async read(position, length) { return image.data.subarray(position, position + length); }
    }, new AbortController().signal, options);
    let next = await stream.next();
    while (!next.done) { chunks.push(next.value); next = await stream.next(); }
    expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(encoded);
    expect(next.value?.size).toBe(encoded.length);
  });
}
