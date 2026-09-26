import { expect, it } from "vitest";
import { Binary } from "./biff-binary.js";
import { SsconvertError } from "../contracts.js";
import { parsePsionSketch } from "./psion-sketch.js";

// Independently specified paint headers and payloads; no host files or oracle.
function paint(bits: number, color: number, compression: number, data: number[], width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(78 + data.length), view = new DataView(bytes.buffer);
  const fields = [40 + data.length, 40, width, height, 0, 0, bits, color, 0, compression];
  for (let i = 0; i < fields.length; i++) view.setUint32(18 + i * 4, fields[i]!, true);
  bytes.set(data, 58);
  return bytes;
}

function read(bytes: Uint8Array, work: () => void = () => {}): number[] {
  const binary = new Binary(bytes), positions: number[] = [];
  parsePsionSketch(start => {
    let at = start;
    return {
      u8() { positions.push(at); return binary.u8(at++); },
      u16() { positions.push(at); const value = binary.u16(at); at += 2; return value; },
      u32() { positions.push(at); const value = binary.u32(at); at += 4; return value; }
    };
  }, 0, work);
  return positions;
}

it.each(Array.from({ length: 15 }, (_, i) => i + 33))("independently admits all source-defined color depths %i with exact one-pixel storage", bits => {
  const count = bits <= 40 ? 5 : 6;
  for (const color of [1, 2, 0xffffffff]) {
    const bytes = paint(bits, color, 0, Array<number>(count).fill(0xa5));
    expect(read(bytes).at(-1)).toBe(bytes.length - 4);
    expect(() => read(paint(bits, color, 0, Array<number>(count - 1).fill(0xa5)))).toThrow("Error while parsing Psion file.");
  }
});

it.each([
  [1, [4, 0xa5]], // RLE8: five decoded bytes.
  [2, [0xa5, 0x40]], // RLE12: five decoded list entries.
  [3, [4, 0xa5, 0x5a]], // RLE16: one byte survives per source list entry.
  [4, [4, 0xa5, 0x5a, 0xff]] // RLE24: same source list semantics.
])("color depth 40 reaches the trailer through compression %i", (compression, data) => {
  const bytes = paint(40, 1, compression as number, data as number[]);
  expect(read(bytes).at(-1)).toBe(bytes.length - 4);
});

it("requires later-row alignment but does not require unused final row padding at depth 47", () => {
  expect(() => read(paint(47, 1, 0, Array<number>(14).fill(0), 1, 2))).not.toThrow();
  expect(() => read(paint(47, 1, 0, Array<number>(13).fill(0), 1, 2))).toThrow("Error while parsing Psion file.");
});

it.each([[33, 0], [48, 1], [48, 7]])("keeps unqualified depth/color %i/%i explicit after byte validation", (bits, color) => {
  const bytes = paint(bits, color, 0, Array<number>(6).fill(0));
  expect(() => read(bytes)).toThrow("bit depth is not qualified");
  expect(() => read(paint(bits, color, 0, []))).toThrow("Error while parsing Psion file.");
});

it("propagates exact cancellation identity before reaching a damaged color-image trailer", () => {
  const reason = new DOMException("independent cancellation", "AbortError");
  const bytes = paint(47, 1, 1, [127, 0]).subarray(0, 60);
  let ticks = 0;
  try {
    read(bytes, () => { if (++ticks === 7) throw reason; });
    throw new Error("expected cancellation");
  } catch (error) { expect(error).toBe(reason); }
  expect(ticks).toBe(7);
});

it("enforces injected pixel-work budgets after compressed color decoding", () => {
  const reason = new SsconvertError("resource-limit", "independent pixel budget");
  let ticks = 0;
  // Six decoded bytes, one row tick, then one pixel tick.
  const bytes = paint(47, 1, 1, [5, 0]);
  try {
    read(bytes, () => { if (++ticks === 8) throw reason; });
    throw new Error("expected budget exhaustion");
  } catch (error) { expect(error).toBe(reason); }
  expect(ticks).toBe(8);
  expect(() => read(bytes)).not.toThrow();
});

it("rejects every incomplete color-image trailer prefix", () => {
  const bytes = paint(47, 1, 0, [0, 1, 2, 3, 4, 5]);
  for (let length = 64; length < bytes.length; length++) {
    expect(() => read(bytes.subarray(0, length))).toThrow("truncated binary data");
  }
  expect(() => read(bytes)).not.toThrow();
});
