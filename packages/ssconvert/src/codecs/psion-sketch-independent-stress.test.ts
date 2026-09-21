import { expect, it } from "vitest";
import { Binary } from "./biff-binary.js";
import { parsePsionSketch, parsePsionSketchFile } from "./psion-sketch.js";

function image(compression: number, data: readonly number[], width = 1, height = 1, bits = 2): Uint8Array {
  const bytes = new Uint8Array(78 + data.length), view = new DataView(bytes.buffer);
  [40 + data.length, 40, width, height, 0, 0, bits, 0, 0, compression].forEach((n, i) => view.setUint32(18 + i * 4, n, true));
  bytes.set(data, 58); return bytes;
}
function parse(bytes: Uint8Array, charge: () => void = () => {}): number {
  const b = new Binary(bytes); let at = 0;
  const cursor = (start: number) => { let position = start; return {
    u8() { const n = b.u8(position++); at = position; return n; },
    u16() { const n = b.u16(position); position += 2; at = position; return n; },
    u32() { const n = b.u32(position); position += 4; at = position; return n; }
  }; };
  parsePsionSketch(cursor, 0, charge);
  return at;
}

it.each([1, 3, 4])("Psion RLE%i consumes mixed repeated and literal runs", compression => {
  const unit = compression === 1 ? 1 : compression === 3 ? 2 : 3;
  const data = [1, ...Array<number>(unit).fill(85), 254, ...Array<number>(2 * unit).fill(170)];
  const bytes = image(compression, data, 16, 1, 2);
  expect(parse(bytes)).toBe(bytes.length);
  expect(() => parse(image(compression, data, 17, 1, 2))).toThrow("Error while parsing Psion file.");
});

it("Psion RLE12 preserves one decoded byte per repeated word", () => {
  const bytes = image(2, [85, 0xf7], 64, 1, 2);
  expect(parse(bytes)).toBe(bytes.length);
  expect(() => parse(image(2, [85, 0xf7], 65, 1, 2))).toThrow("Error while parsing Psion file.");
});

it("Psion literal marker 128 requires all 128 source units", () => {
  const bytes = image(4, [128, ...Array<number>(384).fill(0)]);
  expect(parse(bytes)).toBe(bytes.length);
  expect(() => parse(image(4, [128, ...Array<number>(383).fill(0)]))).toThrow("Error while parsing Psion file.");
});

it("Psion Sketch ignores extra decoded bytes but consumes every declared encoded token", () => {
  const valid = image(1, [0, 85, 0, 170]);
  expect(parse(valid)).toBe(valid.length);
  expect(() => parse(image(1, [0, 85, 0]))).toThrow("Error while parsing Psion file.");
});

it("Psion multi-byte pixel rows require aligned earlier rows and only final used bytes", () => {
  const valid = image(0, Array<number>(7).fill(0), 3, 2, 8);
  expect(parse(valid)).toBe(valid.length);
  expect(() => parse(image(0, Array<number>(6).fill(0), 3, 2, 8))).toThrow("Error while parsing Psion file.");
});

it("Psion Sketch work callbacks preserve cancellation during decoding", () => {
  const reason = new Error("stop Sketch output"), controller = new AbortController(); let work = 0;
  expect(() => parse(image(1, [127, 85]), () => {
    if (++work === 7) controller.abort(reason); controller.signal.throwIfAborted();
  })).toThrow(reason);
  expect(work).toBe(7);
});

it("Psion Sketch unsafe dimensions are rejected without traversing the pixel plane", () => {
  expect(() => parse(image(0, [], 0xffffffff, 0xffffffff, 31))).toThrow("dimensions limit exceeded");
});

it("Psion Sketch unavailable bit depths remain an explicit qualification gap", () => {
  expect(() => parse(image(0, [0, 0, 0, 0, 0], 1, 1, 33))).toThrow("bit depth is not qualified");
});

it("Psion Sketch wrapper application offsets remain within injected bytes", () => {
  const bytes = new Uint8Array(24), v = new DataView(bytes.buffer);
  v.setUint32(0, 4, true); bytes[4] = 2; v.setUint32(5, 0x10000089, true); v.setUint32(9, 0xffffffff, true);
  const b = new Binary(bytes), cursor = (start: number) => { let at = start; return {
    u8() { return b.u8(at++); }, u16() { const n = b.u16(at); at += 2; return n; },
    u32() { const n = b.u32(at); at += 4; return n; }, text() { return "Paint.app"; }
  }; };
  expect(() => parsePsionSketchFile(cursor, () => {})).toThrow();
});

it("Psion nonstandard paint offset 39 reads admitted data from its actual declared offset", () => {
  const bytes = image(0, [85], 8, 1, 2);
  new DataView(bytes.buffer).setUint32(22, 39, true);
  expect(parse(bytes)).toBe(bytes.length);
});

it("Psion 32-bit color Sketch pixels remain source-supported", () => {
  const bytes = image(0, [0, 0, 0, 0], 1, 1, 32);
  new DataView(bytes.buffer).setUint32(46, 1, true);
  expect(parse(bytes)).toBe(bytes.length);
});

it("Psion paint offset 41 skips an admitted header-to-pixel gap", () => {
  const bytes = image(0, [123, 85]);
  new DataView(bytes.buffer).setUint32(22, 41, true);
  expect(parse(bytes)).toBe(bytes.length);
});

it("Psion paint offset zero uses header bytes as source-admitted pixel bytes", () => {
  const bytes = image(0, [85]); new DataView(bytes.buffer).setUint32(22, 0, true);
  expect(parse(bytes)).toBe(bytes.length);
});

it("Psion nonstandard paint offsets cannot underflow their declared size", () => {
  const bytes = image(0, [85]); new DataView(bytes.buffer).setUint32(22, 0xffffffff, true);
  expect(() => parse(bytes)).toThrow("Error while parsing Psion file.");
});

it("Psion nonstandard paint offset still validates decoded bytes and trailer bounds", () => {
  const bytes = image(0, [85], 8, 1, 2); new DataView(bytes.buffer).setUint32(22, 41, true);
  expect(() => parse(bytes)).toThrow("Error while parsing Psion file.");
  new DataView(bytes.buffer).setUint32(22, 39, true);
  expect(() => parse(bytes.subarray(0, bytes.length - 1))).toThrow();
});
