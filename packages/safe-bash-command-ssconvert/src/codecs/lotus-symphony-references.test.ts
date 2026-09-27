import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readLotus } from "./lotus.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 1000 } };
const word = (value: number) => [value & 255, value >>> 8];
const record = (id: number, data: number[] = []) => [...word(id), ...word(data.length), ...data];
function input(tokens: number[], row = 1, column = 1): Uint8Array {
  return Uint8Array.from([...record(0, word(0x405)),
    ...record(13, [0, 0, 0, 0, 0, 42, 0]),
    ...record(16, [0, ...word(column), ...word(row), ...Array<number>(8).fill(0), ...word(tokens.length + 1), ...tokens, 3]),
    ...record(1)]);
}

// libwps 0.4.14 WKS4Parser::checkHeader selects DOS Symphony for BOF 0x0405.
// WKS4Spreadsheet::readCell conditionally wraps its low-byte column offsets;
// its rows use signed 14-bit offsets and fold positive targets at 8192.
it.each([
  [0xffff, 0xbfff, "=A1"],
  [0xffff, 0, "=A$1"],
  [0, 0xbfff, "=$A1"],
  [0x8000, 0x8001, "=B3"],
  [256, 8192, "=$IW$8193"],
])("imports Symphony reference %i/%i", async (column, row, expected) => {
  const book = await readLotus(input([1, ...word(column), ...word(row)]), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe(expected);
  if (expected === "=A1") expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 42 });
});

it.each([
  [0, 0xffff, "=IV$1"],
  [127, 0xff80, "=IV$1"],
  [128, 0xff80, "=A$1"],
  [255, 0xff81, "=DY$1"],
  [255, 0x8001, "=IW$1"],
])("wraps Symphony column %i with offset %i only when the source condition holds", async (origin, encoded, expected) => {
  const book = await readLotus(input([1, ...word(encoded), ...word(0)], 1, origin), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe(expected);
});

it("preserves absolute and relative axes in both Symphony range endpoints", async () => {
  const book = await readLotus(input([2, ...word(0xffff), ...word(0), ...word(1), ...word(0xbfff)]), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe("=A$1:$B1");
});

it.each([
  [8191, 0x8002, "=$A2"],
  [8192, 0xa000, "=$A1"],
  [0, 0xbfff, "=#REF!"],
])("decodes Symphony row %i with offset %i", async (origin, encoded, expected) => {
  const book = await readLotus(input([1, ...word(0), ...word(encoded)], origin), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe(expected);
});
