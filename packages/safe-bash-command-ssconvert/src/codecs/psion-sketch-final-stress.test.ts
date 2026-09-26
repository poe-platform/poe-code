import { expect, it } from "vitest";
import { Binary } from "./biff-binary.js";
import { parsePsionSketch } from "./psion-sketch.js";

function image(compression: number, data: readonly number[], width = 1, height = 1, bits = 2): Uint8Array {
  const bytes = new Uint8Array(78 + data.length), view = new DataView(bytes.buffer);
  [40 + data.length, 40, width, height, 0, 0, bits, 0, 0, compression].forEach((n, i) => view.setUint32(18 + i * 4, n, true));
  bytes.set(data, 58); return bytes;
}
function parse(bytes: Uint8Array, tick: () => void = () => {}, section = 0): number {
  const b = new Binary(bytes); let final = 0;
  parsePsionSketch(start => {
    let at = start;
    return {
      u8() { tick(); const n = b.u8(at++); final = at; return n; },
      u16() { tick(); const n = b.u16(at); at += 2; final = at; return n; },
      u32() { tick(); const n = b.u32(at); at += 4; final = at; return n; }
    };
  }, section, tick);
  return final;
}
it("Psion Sketch malformed RLE is rejected before unqualified pixel depths", () => {
  expect(() => parse(image(1, [0], 1, 1, 33))).toThrow("Error while parsing Psion file.");
});
it("Psion Sketch insufficient decoded pixels are rejected before depth qualification", () => {
  expect(() => parse(image(0, [0], 1, 1, 33))).toThrow("Error while parsing Psion file.");
});
it("Psion Sketch section relocation preserves paint and trailer offsets", () => {
  const original = image(0, [1, 2, 3, 4], 1, 1, 32), bytes = new Uint8Array(original.length + 37);
  new DataView(original.buffer).setUint32(46, 1, true); bytes.set(original, 37);
  expect(parse(bytes, () => {}, 37)).toBe(bytes.length);
});
it.each([33, 34, 35, 36, 45, 46, 47])("Psion Sketch source-defined color depth %i reaches its trailer", bits => {
  const row = Math.ceil(3 * bits / 8), count = Math.ceil(row / 4) * 4 + row;
  const bytes = image(0, Array<number>(count).fill(255), 3, 2, bits);
  new DataView(bytes.buffer).setUint32(46, 1, true);
  expect(parse(bytes)).toBe(bytes.length);
  expect(() => parse(bytes.subarray(0, bytes.length - 1))).toThrow("truncated binary data");
});
it.each([0, 1, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32])("Psion Sketch bit depth %i admits exact rounded aligned rows", bits => {
  const row = Math.ceil(3 * bits / 8), count = Math.ceil(row / 4) * 4 + row;
  const bytes = image(0, Array<number>(count).fill(0), 3, 2, bits);
  expect(parse(bytes)).toBe(bytes.length);
  if (count) expect(() => parse(image(0, Array<number>(count - 1).fill(0), 3, 2, bits))).toThrow("Error while parsing Psion file.");
});
it.each([0, 39, 41])("Psion Sketch declared offset %i does not shift the final trailer", offset => {
  const bytes = image(0, [0, 1, 2]); new DataView(bytes.buffer).setUint32(22, offset, true);
  expect(parse(bytes)).toBe(bytes.length);
  expect(() => parse(bytes.subarray(0, bytes.length - 1))).toThrow();
});
it("Psion Sketch decode cancellation precedes later corrupt trailer reads", () => {
  const bytes = image(1, [127, 0]).subarray(0, 60), reason = new DOMException("cancel decoding", "AbortError");
  let work = 0;
  expect(() => parse(bytes, () => { if (++work === 35) throw reason; })).toThrow(reason);
  expect(work).toBe(35);
});
