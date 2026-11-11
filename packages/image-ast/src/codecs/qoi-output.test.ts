import { expect, it } from "vitest";
import type { RgbaImage } from "../ast.js";
import { encodeQoiImage, encodeQoiFromStorage } from "./qoi-output.js";
import { decodeQoiImage } from "./qoi-input.js";

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
  expect(Array.from(expected.subarray(14, 19))).toEqual([255, 18, 52, 86, 128]);
  expect(Array.from(expected.subarray(19, -8))).toEqual([...Array<number>(16).fill(253), 223]);
  expect(decodeQoiImage(expected).data).toEqual(image.data);
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
const compactCases = [
  { width: 62, pixel: [0, 0, 0, 255], payload: [253] },
  { width: 63, pixel: [0, 0, 0, 255], payload: [253, 192] },
  { width: 128, pixel: [0, 0, 0, 255], payload: [253, 253, 195] },
  { width: 1, pixel: [1, 1, 1, 255], payload: [127] },
  { width: 1, pixel: [3, 5, 3, 255], payload: [165, 102] },
  { width: 1, pixel: [128, 64, 32, 255], payload: [254, 128, 64, 32] },
];

it.each(compactCases)("encodes $width pixels of $pixel compactly", ({ width, pixel, payload }) => {
  const image: RgbaImage = { width, height: 1, data: Uint8Array.from(Array.from({ length: width }, () => pixel).flat()), format: "raw", space: "srgb", channels: 3, depth: "uchar", hasAlpha: false, density: 72 };
  const encoded = encodeQoiImage(image);
  expect(Array.from(encoded.subarray(14, -8))).toEqual(payload);
  expect(encoded.length).toBe(22 + payload.length);
  expect(decodeQoiImage(encoded).data).toEqual(image.data);
});

it("flushes runs before color and alpha changes and wraps color deltas", () => {
  const image: RgbaImage = { width: 7, height: 1, data: Uint8Array.from([
    0, 0, 0, 255, 0, 0, 0, 255,
    255, 255, 255, 255, 254, 254, 254, 255,
    254, 254, 254, 0, 254, 254, 254, 0, 1, 3, 1, 0,
  ]), format: "raw", space: "srgb", channels: 4, depth: "uchar", hasAlpha: true, density: 72 };
  const encoded = encodeQoiImage(image);
  expect(Array.from(encoded.subarray(14, -8))).toEqual([193, 85, 85, 255, 254, 254, 254, 0, 192, 165, 102]);
  expect(decodeQoiImage(encoded).data).toEqual(image.data);
});
