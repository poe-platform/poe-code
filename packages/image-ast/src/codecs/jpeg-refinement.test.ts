import { expect, it } from "vitest";
import { decodeJpegImage } from "./jpeg.js";

const segment = (marker: number, data: readonly number[]) =>
  [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];

function entropy(bits: string): number[] {
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, "1");
  return Array.from({ length: padded.length / 8 }, (_, i) => Number.parseInt(padded.slice(i * 8, i * 8 + 8), 2))
    .flatMap(byte => byte === 255 ? [255, 0] : [byte]);
}

// Authored Huffman codes: DC zero = 0; three-bit AC codes map to
// EOB, 0/1, 0/2, 1/1, 1/2, EOB-run-two, ZRL respectively.
// Quantization by 16 makes a one-bit coefficient correction visible in pixels.
function jpeg(progressive: boolean, scans: readonly number[][], width = 8, restart = false): Uint8Array {
  return Uint8Array.from([255, 216,
    ...segment(219, [0, ...Array<number>(64).fill(16)]),
    ...segment(progressive ? 194 : 192, [8, 0, 1, 0, width, 1, 1, 0x11, 0]),
    ...segment(196, [0, 1, ...Array<number>(15).fill(0), 0,
      16, 0, 0, 7, ...Array<number>(13).fill(0), 0, 1, 2, 0x11, 0x12, 0x10, 0xf0]),
    ...(restart ? segment(221, [0, 1]) : []), ...scans.flat(), 255, 217]);
}
const scan = (start: number, end: number, approximation: number, bits: string) =>
  [...segment(218, [1, 1, 0, start, end, approximation]), ...entropy(bits)];

it.each([true, false])("refines existing AC coefficients with positive sign %s", positive => {
  const sign = positive ? "1" : "0";
  const progressive = jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "001" + sign + "000"), scan(1, 63, 0x10, "0001")]);
  const baseline = jpeg(false, [scan(0, 63, 0, "0" + "010" + sign.repeat(2) + "000")]);
  const expected = decodeJpegImage(baseline).data;
  expect(expected[0]).toBe(positive ? 136 : 120);
  expect(decodeJpegImage(progressive).data).toEqual(expected);
});

it("inserts a negative coefficient before an existing coefficient and consumes its correction", () => {
  const progressive = jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "0111" + "000"), scan(1, 63, 0x10, "0010" + "0001")]);
  const baseline = jpeg(false, [scan(0, 63, 0, "0" + "0010" + "01011" + "000")]);
  expect(decodeJpegImage(progressive).data).toEqual(decodeJpegImage(baseline).data);
});

it("counts only zero coefficients in a refinement ZRL", () => {
  const progressive = jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "0011" + "000"), scan(1, 63, 0x10, "1101" + "0011" + "000")]);
  const baseline = jpeg(false, [scan(0, 63, 0, "0" + "01011" + "110" + "0011" + "000")]);
  expect(decodeJpegImage(progressive).data).toEqual(decodeJpegImage(baseline).data);
});

it("retains correction bits across an EOB run spanning two blocks", () => {
  const progressive = jpeg(true, [scan(0, 0, 0, "00"), scan(1, 63, 1, "0011000".repeat(2)), scan(1, 63, 0x10, "1010" + "10")], 16);
  const baseline = jpeg(false, [scan(0, 63, 0, "001011000" + "001010000")], 16);
  expect(decodeJpegImage(progressive).data).toEqual(decodeJpegImage(baseline).data);
});

it("consumes restart markers in refinement scans", () => {
  const restarted = (start: number, end: number, approximation: number, bits: string) =>
    [...scan(start, end, approximation, bits), 255, 208, ...entropy(bits)];
  const progressive = jpeg(true, [restarted(0, 0, 0, "0"), restarted(1, 63, 1, "0011000"), restarted(1, 63, 0x10, "0001")], 16, true);
  const baseline = jpeg(false, [scan(0, 63, 0, "001011000".repeat(2))], 16);
  expect(decodeJpegImage(progressive).data).toEqual(decodeJpegImage(baseline).data);
});

it("rejects a refinement scan without entropy", () => {
  expect(() => decodeJpegImage(jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "0011000"), scan(1, 63, 0x10, "")]))).toThrow(/JPEG/);
});

it("rejects a new refinement coefficient with size other than one", () => {
  expect(() => decodeJpegImage(jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "000"), scan(1, 63, 0x10, "01011")]))).toThrow(/JPEG/);
});

it("rejects exhaustion while refining existing coefficients after an EOB symbol", () => {
  const incomplete = [...segment(218, [1, 1, 0, 1, 63, 0x10]), 0x1f];
  expect(() => decodeJpegImage(jpeg(true, [scan(0, 0, 0, "0"), scan(1, 63, 1, "0011".repeat(6) + "000"), incomplete]))).toThrow(/JPEG/);
});
