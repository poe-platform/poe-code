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
  const number = new Uint8Array(8); new DataView(number.buffer).setFloat64(0, 42, true);
  return Uint8Array.from([...record(255, word(0x404)),
    ...record(14, [0, 0, 0, 0, 0, 0, ...number]),
    ...record(16, [...word(column), ...word(row), 0, 0, ...Array<number>(8).fill(0), ...word(tokens.length + 1), ...tokens, 3]),
    ...record(1)]);
}

// libwps 0.4.14 WKS4Parser::checkHeader selects version 3 for 0xff BOF;
// WKS4Spreadsheet::readCell sign-extends 15-bit columns and 14-bit rows.
it.each([
  [0xffff, 0xbfff, "=A1"],
  [0xffff, 0, "=A$1"],
  [0, 0xbfff, "=$A1"],
  [0x8000, 0x8001, "=B3"],
  [1, 8192, "=$B$8193"],
])("imports Windows Works reference %i/%i", async (column, row, expected) => {
  const book = await readLotus(input([1, ...word(column), ...word(row)]), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe(expected);
  if (expected === "=A1") expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value: 42 });
});

it("retains each Windows Works range endpoint's absolute and relative axes", async () => {
  const book = await readLotus(input([2, ...word(0xffff), ...word(0), ...word(1), ...word(0xbfff)]), context);
  expect(book.sheets[0]!.cells[1]!.formula).toBe("=A$1:$B1");
});

it("applies the source-defined relative row wrap and rejects negative targets", async () => {
  const wrapped = await readLotus(input([1, ...word(0), ...word(0x8002)], 8191), context);
  expect(wrapped.sheets[0]!.cells[1]!.formula).toBe("=$A2");
  for (const [row, column] of [[0, 1], [1, 0]] as const) {
    const negative = await readLotus(input([1, ...word(0xffff), ...word(0xbfff)], row, column), context);
    expect(negative.sheets[0]!.cells[1]!.formula).toBe("=#REF!");
  }
});
