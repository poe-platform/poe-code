import { expect, it } from "vitest";
import { decodeCcittFax } from "./filters.js";

it("decodes all fax rows without an explicit positive Rows value", () => {
  // Group 4 vertical-zero codes: each one bit produces a white row.
  const bytes = new Uint8Array(300).fill(255);
  for (const Rows of [undefined, 0]) {
    const decoded = decodeCcittFax(bytes, { K: -1, Columns: 8, Rows });
    expect(decoded).toEqual(new Uint8Array(2400).fill(255));
  }
  expect(decodeCcittFax(bytes, { K: -1, Columns: 8, Rows: 10 })).toHaveLength(10);
});

it("decodes Group 4 makeup runs from a libtiff strip", () => {
  const strip = Uint8Array.of(0x2d, 0x33, 0x50, 0x1a, 0x1b, 0x96, 0xd1, 0xa8, 0x0f, 0x86, 0xe0, 0x02, 0x00, 0x20);
  const result = decodeCcittFax(strip, { K: -1, Columns: 6720, Rows: 1, BlackIs1: true });
  const expected = new Uint8Array(840);
  expected.fill(255, 112, 352);
  expected.fill(255, 520);
  expect(result).toEqual(expected);
});
