import { expect, it } from "vitest";
import { decodeJpegImage } from "./jpeg.js";

const segment = (marker: number, data: readonly number[]) =>
  [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];

// Authored one-component image. DC-zero and EOB each use a one-bit code.
function jpeg({ progressive = false, width = 1, entropy = [progressive ? 0x7f : 0x3f], restart = false, dc8 = false } = {}): Uint8Array {
  const dcTable = dc8 ? [1, 1, ...Array<number>(14).fill(0), 0, 8] : [1, ...Array<number>(15).fill(0), 0];
  return Uint8Array.from([255, 216,
    ...segment(219, [0, ...Array<number>(64).fill(1)]),
    ...segment(progressive ? 194 : 192, [8, 0, 1, width >>> 8, width & 255, 1, 1, 0x11, 0]),
    ...segment(196, [0, ...dcTable, 16, 1, ...Array<number>(15).fill(0), 0]),
    ...(restart ? segment(221, [0, 1]) : []),
    ...(progressive ? [
      ...segment(218, [1, 1, 0, 0, 0, 0]), ...entropy,
      ...segment(218, [1, 1, 0, 1, 63, 0]), ...entropy,
    ] : [...segment(218, [1, 1, 0, 0, 63, 0]), ...entropy]),
    255, 217]);
}

for (const progressive of [false, true]) {
  it(`decodes complete ${progressive ? "progressive" : "baseline"} entropy`, () => {
    expect(decodeJpegImage(jpeg({ progressive })).data).toEqual(Uint8Array.of(128, 128, 128, 255));
  });

  it(`rejects missing ${progressive ? "progressive" : "baseline"} entropy before EOI`, () => {
    expect(() => decodeJpegImage(jpeg({ progressive, entropy: [] }))).toThrow(/JPEG/);
  });

  it(`consumes restart markers between ${progressive ? "progressive" : "baseline"} scan units`, () => {
    const sample = progressive ? 0x7f : 0x3f;
    const decoded = decodeJpegImage(jpeg({ progressive, width: 9, restart: true, entropy: [sample, 255, 208, sample] }));
    expect(decoded.width).toBe(9);
    expect(decoded.data).toEqual(Uint8Array.from(Array.from({ length: 9 }, () => [128, 128, 128, 255]).flat()));
  });
}

it("rejects exhausted entropy at EOF and an incomplete byte-stuffing escape", () => {
  for (const entropy of [[], [255]]) {
    expect(() => decodeJpegImage(jpeg({ entropy }).slice(0, -2))).toThrow(/JPEG/);
  }
});

it("rejects an unassigned Huffman code without inventing a zero symbol", () => {
  expect(() => decodeJpegImage(jpeg({ entropy: [0x80, 0, 0] }))).toThrow(/JPEG/);
});

it("rejects a restart marker inside a scan unit", () => {
  expect(() => decodeJpegImage(jpeg({ entropy: [255, 208, 0x3f] }))).toThrow(/JPEG/);
});

it("requires the declared restart marker and its sequence", () => {
  for (const entropy of [[0x3f, 0x3f], [0x3f, 255, 209, 0x3f]]) {
    expect(() => decodeJpegImage(jpeg({ width: 9, restart: true, entropy }))).toThrow(/JPEG/);
  }
});

it("decodes a stuffed FF amplitude byte", () => {
  // Three zero blocks align category-eight amplitude bits at a byte boundary.
  const decoded = decodeJpegImage(jpeg({ width: 25, dc8: true, entropy: [2, 255, 0, 0x7f] }));
  expect(decoded.data.slice(0, 4)).toEqual(Uint8Array.of(128, 128, 128, 255));
  expect(decoded.data.slice(-4)).toEqual(Uint8Array.of(160, 160, 160, 255));
});
