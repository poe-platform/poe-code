import { expect, it } from "vitest";
import { Binary } from "./biff-binary.js";
import { parsePsionSketch, parsePsionSketchFile } from "./psion-sketch.js";

function fixture(compression: number, data: number[], width = 1, height = 1, bits = 2) {
  const bytes = new Uint8Array(18 + 40 + data.length + 20), view = new DataView(bytes.buffer);
  [40 + data.length, 40, width, height, 0, 0, bits, 0, 0, compression].forEach((v, i) => view.setUint32(18 + i * 4, v, true));
  bytes.set(data, 58); return bytes;
}
function parse(bytes: Uint8Array, budget = 1000) {
  const b = new Binary(bytes); let at = 0, work = 0;
  const cursor = (start: number) => { let position = start; return {
    u8() { const n = b.u8(position++); at = position; return n; },
    u16() { const n = b.u16(position); position += 2; at = position; return n; },
    u32() { const n = b.u32(position); position += 4; at = position; return n; }
  }; };
  parsePsionSketch(cursor, 0, () => { if (++work > budget) throw new Error("work limit"); });
  return { at, work };
}

it.each([[0, [85]], [1, [0, 85]], [2, [85, 0]], [3, [0, 85, 1]], [4, [0, 85, 1, 2]]])(
  "parses source Sketch compression %i without importing ignored pixels", (type, data) => {
    const bytes = fixture(type as number, data as number[]);
    expect(parse(bytes).at).toBe(bytes.length);
  });
it.each([[1, [255, 85]], [3, [255, 85, 1]], [4, [255, 85, 1, 2]]])(
  "parses source RLE%i literal units", (type, data) => expect(parse(fixture(type as number, data as number[])).work).toBeGreaterThan(0));
it("retains source one-byte-per-unit RLE16 truncation and rejects insufficient pixels", () => {
  expect(() => parse(fixture(3, [0, 85, 1], 8, 1, 2))).toThrow("Error while parsing Psion file.");
});
it("requires row alignment before each later row but no unused final padding", () => {
  expect(() => parse(fixture(0, [0, 0, 0, 0], 1, 2))).toThrow("Error while parsing Psion file.");
  expect(parse(fixture(0, [0, 0, 0, 0, 0], 1, 2)).work).toBeGreaterThan(0);
});
it.each([[1, [0]], [2, [0]], [3, [255, 0]], [4, [255, 0, 0]]])(
  "rejects truncated RLE%i units", (type, data) => expect(() => parse(fixture(type as number, data as number[]))).toThrow());
it("bounds repeated decoded output and pixel traversal with the shared work callback", () => {
  expect(() => parse(fixture(1, [127, 0]), 10)).toThrow("work limit");
});
it("bounds zero-width row traversal without relying on pixel work", () => {
  expect(() => parse(fixture(0, [], 0, 2), 1)).toThrow("work limit");
});
it("follows source unknown-compression fallback to raw bytes", () => {
  expect(parse(fixture(99, [0])).at).toBe(79);
});
it("follows native nonstandard paint offset behavior and rejects an unavailable sketch trailer", () => {
  const bytes = fixture(0, [0]); new DataView(bytes.buffer).setUint32(22, 39, true);
  expect(parse(bytes).at).toBe(bytes.length);
  expect(() => parse(fixture(0, [0]).subarray(0, 78))).toThrow();
});

it.each([true, false])("parses Sketch file application and optional paint section (%s)", content => {
  const image = fixture(0, [0]), bytes = new Uint8Array(48 + image.length), v = new DataView(bytes.buffer);
  v.setUint32(0, 4, true); bytes[4] = content ? 4 : 2;
  v.setUint32(5, 0x10000089, true); v.setUint32(9, 24, true);
  v.setUint32(13, 0x1000007d, true); v.setUint32(17, 48, true);
  v.setUint32(24, 0x1000007d, true); bytes[28] = 9 << 2 | 2;
  bytes.set(Array.from("Paint.app", c => c.charCodeAt(0)), 29); bytes.set(image, 48);
  const b = new Binary(bytes), cursor = (start: number) => { let at = start; return {
    u8() { return b.u8(at++); }, u16() { const n = b.u16(at); at += 2; return n; },
    u32() { const n = b.u32(at); at += 4; return n; },
    text() { const size = b.u8(at++) >> 2, data = b.slice(at, size); at += size; return String.fromCharCode(...data); }
  }; };
  expect(() => parsePsionSketchFile(cursor, () => {})).not.toThrow();
  bytes[29] = 88;
  expect(() => parsePsionSketchFile(cursor, () => {})).toThrow("Error while parsing Psion file.");
});
