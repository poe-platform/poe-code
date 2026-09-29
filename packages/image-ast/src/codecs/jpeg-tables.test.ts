import { expect, it } from "vitest";
import { decodeJpegImage } from "./jpeg.js";

const segment = (marker: number, data: readonly number[]) =>
  [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];

function jpeg({ quantization = true, huffman = true, qId = 0, frameQId = 0, hId = 0, scanId = 1, scanTables = 0, entropy = 0x3f } = {}): Uint8Array {
  return Uint8Array.from([255, 216,
    ...(quantization ? segment(219, [qId, ...Array<number>(64).fill(1)]) : []),
    ...segment(192, [8, 0, 1, 0, 1, 1, 1, 0x11, frameQId]),
    ...(huffman ? segment(196, [hId, 1, ...Array<number>(15).fill(0), 0, 16 + hId, 1, ...Array<number>(15).fill(0), 0]) : []),
    ...segment(218, [1, scanId, scanTables, 0, 63, 0]), entropy, 255, 217]);
}

it.each([
  ["missing quantization table", { quantization: false }],
  ["undefined quantization selector", { frameQId: 3 }],
  ["undefined scan component", { scanId: 9 }],
  // The former implicit standard tables decode DC zero + EOB from 001010.
  ["missing Huffman tables", { huffman: false, entropy: 0x2b }],
  ["undefined DC selector", { scanTables: 0x10, entropy: 0x1f }],
  ["undefined AC selector", { scanTables: 0x01, entropy: 0x1f }],
  ["out-of-range selectors", { scanTables: 0xff }],
])("rejects a JPEG with %s", (_label, options) => {
  expect(() => decodeJpegImage(jpeg(options))).toThrow(/JPEG/);
});

it.each([
  {},
  { qId: 3, frameQId: 3 },
  { hId: 2, scanTables: 0x22 },
])("decodes explicitly defined nondefault tables %j", options => {
  expect(decodeJpegImage(jpeg(options)).data).toEqual(Uint8Array.of(128, 128, 128, 255));
});
