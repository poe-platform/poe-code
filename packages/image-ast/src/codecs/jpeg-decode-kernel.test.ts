import { expect, it } from "vitest";
import { buildHuffmanTable, createJpegScan } from "./jpeg-decode-kernel.js";

const table = (symbol: number) =>
  buildHuffmanTable(Uint8Array.of(1, ...new Array<number>(15).fill(0)), Uint8Array.of(symbol));
it("decodes independent baseline bit vectors through an injected synchronous byte reader", () => {
  for (const [byte, expected] of [
    [0x60, 3],
    [0x40, 2],
    [0x20, -2],
    [0x00, -3]
  ] as const) {
    const bytes = Uint8Array.of(byte, 0, 0),
      reads: number[] = [];
    const scan = createJpegScan(
      (position) => {
        reads.push(position);
        return bytes[position];
      },
      bytes.length,
      0,
      [table(2)],
      [table(0)],
      0,
      63,
      0,
      0
    );
    const comp = { dcId: 0, acId: 0, dcPred: 0 },
      block = new Int32Array(64);
    expect(scan.decodeBaseline(comp, block)).toBe(0);
    expect([...block]).toEqual([expected, ...new Array<number>(63).fill(0)]);
    expect(comp.dcPred).toBe(expected);
    expect(scan.position).toBe(3);
    expect(reads.every((position) => position < bytes.length)).toBe(true);
  }
});
it("keeps interleaved decoder reservoirs isolated and resets only its own restart state", () => {
  const bytes = Uint8Array.of(0x60, 0, 0, 0x40, 0, 0);
  const first = createJpegScan(
    (position) => bytes[position],
    bytes.length,
    0,
    [table(2)],
    [table(0)],
    0,
    63,
    0,
    0
  );
  const second = createJpegScan(
    (position) => bytes[position],
    bytes.length,
    3,
    [table(2)],
    [table(0)],
    0,
    63,
    0,
    0
  );
  const a = { dcId: 0, acId: 0, dcPred: 0 },
    b = { dcId: 0, acId: 0, dcPred: 0 },
    block = new Int32Array(64);
  first.decodeBaseline(a, block);
  expect(block[0]).toBe(3);
  second.decodeBaseline(b, block);
  expect(block[0]).toBe(2);
  a.dcPred = 0;
  first.restart(3);
  first.decodeBaseline(a, block);
  expect(block[0]).toBe(2);
});
it.each([
  [[], "Truncated JPEG entropy data"],
  [[255], "Truncated JPEG entropy escape"],
  [[255, 217], "Unexpected JPEG marker in entropy data"]
] as const)("retains source-end diagnostics for %j", (input, error) => {
  const bytes = Uint8Array.from(input);
  const scan = createJpegScan(
    (position) => bytes[position],
    bytes.length,
    0,
    [table(2)],
    [table(0)],
    0,
    63,
    0,
    0
  );
  expect(() => scan.decodeBaseline({ dcId: 0, acId: 0, dcPred: 0 }, new Int32Array(64))).toThrow(
    error
  );
});
