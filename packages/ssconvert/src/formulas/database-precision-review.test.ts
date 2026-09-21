import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const s = (value: string): CellValue => ({ kind: "string", value });
function calculate(name: string, values: readonly number[]): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: s("Amount") }, { row: 0, column: 3, value: s("Amount") },
    ...values.map((value, index) => ({ row: index + 1, column: 0, value: n(value) })),
    { row: 10, column: 10, formula: `=${name}(A1:A${values.length + 1},1,D1:D2)`, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells.find(cell => cell.row === 10 && cell.column === 10)!.value;
}

// go-rangefunc.c go_range_devsq retains both components of its GOQuad mean.
it.each<[string, number]>([["DVARP", 1], ["DVAR", 2], ["DSTDEVP", 1], ["DSTDEV", Math.sqrt(2)]])(
  "%s retains a mean below a large input's binary64 spacing", (name, expected) => {
    expect(calculate(name, [1e16, 1e16 + 2])).toEqual(n(expected));
    expect(calculate(name, [-1e16, -1e16 - 2])).toEqual(n(expected));
  }
);
it("preserves variance under exactly representable translation and input ordering", () => {
  expect(calculate("DVARP", [0, 2, 4])).toEqual(n(8 / 3));
  expect(calculate("DVARP", [1e16 + 4, 1e16, 1e16 + 2])).toEqual(n(8 / 3));
});
it("retains the release's ordinary binary64 average result", () => {
  expect(calculate("DAVERAGE", [1e16, 1e16 + 2])).toEqual(n(1e16));
});
it("retains a nonterminating mean's low component when summing its squared deviations", () => {
  expect(calculate("DVARP", [0, 0, 2])).toEqual(n(8 / 9));
  expect(calculate("DVARP", [1e16, 1e16 + 2, 1e16])).toEqual(n(8 / 9));
});
it("retains exact constant and small-domain handling", () => {
  expect(calculate("DVARP", [1e308, 1e308])).toEqual(n(0));
  expect(calculate("DSTDEV", [1e308, 1e308])).toEqual(n(0));
  expect(calculate("DVARP", [2])).toEqual(n(0));
  expect(calculate("DVAR", [2])).toEqual({ kind: "error", value: "#NUM!" });
});
