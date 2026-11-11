import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeQoiImage, encodeQoiFromStorage } from "./qoi-output.js";

it("preserves alpha state across bounded storage chunks", async () => {
  const image: RgbaImage = { width: 1025, height: 1, data: new Uint8Array(1025 * 4), format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72 };
  for (let i = 0; i < image.data.length; i += 4) image.data.set([18, 52, 86, 128], i);
  const expected = encodeQoiImage(image), chunks: Uint8Array[] = [];
  for await (const chunk of encodeQoiFromStorage({ ...image, position: 100 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read(position, length) { expect(length).toBeLessThanOrEqual(4096); return image.data.slice(position - 100, position - 100 + length); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal)) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected));
  // One RGBA opcode sets alpha; later RGB opcodes retain it, even across reads.
  expect(Array.from(expected.subarray(14, 19))).toEqual([255, 18, 52, 86, 128]);
  expect(expected.length).toBe(14 + 5 + 1024 * 4 + 8);
  for (let offset = 19; offset < expected.length - 8; offset += 4) {
    expect(Array.from(expected.subarray(offset, offset + 4))).toEqual([254, 18, 52, 86]);
  }
});

it("rejects truncated pixel storage", async () => {
  const image: RgbaImage = { width: 1, height: 1, data: new Uint8Array(4), format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72 };
  const encoded = encodeQoiFromStorage({ ...image, position: 0 }, {
    allocate() { throw new Error("Unexpected allocation"); },
    async read() { return new Uint8Array(3); },
    async write() { throw new Error("Unexpected write"); },
  }, new AbortController().signal);
  await encoded.next();
  await expect(encoded.next()).rejects.toThrow("Truncated QOI pixel storage");
});

for (const magickColorspace of [undefined, "sRGB", "RGB"]) {
  it(`labels QOI samples using the colorspace (${magickColorspace}) in both encoders`, async () => {
    const image = { width: 1, height: 1, data: Uint8Array.of(55, 13, 4, 255), format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72, gamma: 1, magickColorspace } satisfies RgbaImage & { magickColorspace: string | undefined };
    const expected = Buffer.from(`716f6966000000010000000103${magickColorspace === "RGB" ? "01" : "00"}fe370d040000000000000001`, "hex");
    expect(encodeQoiImage(image)).toEqual(new Uint8Array(expected));
    const chunks: Uint8Array[] = [];
    for await (const chunk of encodeQoiFromStorage({ ...image, position: 0 }, {
      allocate() { throw new Error("Unexpected allocation"); },
      async read(position, length) { return image.data.slice(position, position + length); },
      async write() { throw new Error("Unexpected write"); },
    }, new AbortController().signal)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(expected);
  });
}
