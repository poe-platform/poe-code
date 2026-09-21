import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const s = (value: string): CellValue => ({ kind: "string", value });
const e = (value: string): CellValue => ({ kind: "error", value });
function calculate(formula: string, supplied = context, dateSystem: "1900" | "1904" = "1900"): CellValue {
  const book: Workbook = { dateSystem, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, value: { kind: "number", value: 999 }, formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells[0]!.value;
}

// Independently derived from GOffice OP_DATE_ROUND/SPLIT and fraction opcodes.
it.each<[string, CellValue]>([
  ['=TEXT(1,"yyyy-mm-dd")', s("1900-01-01")], ['=TEXT(61,"yyyy-mm-dd")', s("1900-03-01")],
  ['=TEXT(60,"yyyy-mm-dd")', e("#VALUE!")], ['=TEXT(0,"yyyy-mm-dd")', s("1899-12-31")],
  ['=TEXT(-1,"yyyy-mm-dd")', s("1899-12-30")], ['=TEXT(-0.25,"hh:mm:ss")', s("18:00:00")],
  ['=TEXT(1.125,"[h]:mm:ss")', s("27:00:00")], ['=TEXT(-1.125,"[h]:mm:ss")', s("-27:00:00")],
  ['=TEXT(1.125,"[m]:ss")', s("1620:00")], ['=TEXT(0.25,"[s]")', s("21600")],
  ['=TEXT(0.75,"hh:mm AM/PM")', s("06:00 PM")], ['=TEXT(0.25,"h:mm a/p")', s("6:00 a")],
  ['=TEXT(0.000001,"ss.000")', s("00.086")], ['=TEXT(1,"ss.0000")', e("#VALUE!")],
  ['=TEXT(1,"[h]:[m]")', e("#VALUE!")], ['=TEXT(1,"[h] AM/PM")', e("#VALUE!")],
  ['=TEXT(2.5,"# ?/?")', s("2 1/2")], ['=TEXT(-2.5,"# ?/?")', s("-2 1/2")],
  ['=TEXT(0.125,"?/8")', s("1/8")], ['=TEXT(2.125,"?/8")', s("17/8")],
  ['=TEXT(1.5,"# ??/??")', s("1  1/ 2")], ['=TEXT(2,"# ?/?")', s("2    ")],
  ['=TEXT(0.5,"00/00")', s("01/02")], ['=TEXT(1/0,"yyyy-mm-dd")', e("#DIV/0!")],
  ['=TEXT(1,"yyyy-mm-dd",2)', e("#N/A")]
])("independently reviews %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it("prints full years below 1000 without forced four-digit padding", () => {
  // OP_DATE_YEAR calls append_i, while only OP_DATE_YEAR_2 calls append_i2.
  expect(calculate('=TEXT(-693594,"yyyy")')).toEqual(s("1"));
});

it("applies the next-representable epsilon before clock rounding", () => {
  // go-format.c OP_DATE_ROUND calls go_add_epsilon(abs(val)) before seconds.
  const value = 0.000005787037037037036;
  expect(calculate(`=TEXT(${value},"ss")`)).toEqual(s("01"));
});
it("uses the explicit 1904 epoch", () => {
  expect(calculate('=TEXT(0,"yyyy-mm-dd")', context, "1904")).toEqual(s("1904-01-01"));
  expect(calculate('=TEXT(60,"yyyy-mm-dd")', context, "1904")).toEqual(s("1904-03-01"));
});
it("formats each array element with its corresponding format", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "format", kind: "array", expression: '=TEXT({1,0.5;61,2.25},{"yyyy-mm-dd","h:mm";"yyyy-mm-dd","# ?/?"})',
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }
  ] }] };
  const cells = recalculateWorkbook(book, context, true).sheets[0]!.cells;
  const at = (row: number, column: number) => cells.find(cell => cell.row === row && cell.column === column)?.value;
  expect([at(0, 0), at(0, 1), at(1, 0), at(1, 1)]).toEqual([s("1900-01-01"), s("12:00"), s("1900-03-01"), s("2 1/4")]);
});
it("rejects date output beyond the injected byte budget", () => {
  expect(() => calculate('=TEXT(1,"yyyy-mm-dd")', { ...context, limits: { ...context.limits, outputBytes: 9 } })).toThrow("text limit exceeded");
});
it("does not infer an unsupported locale profile", () => {
  expect(() => calculate('=TEXT(1,"mmmm")', { ...context, environment: { ...context.environment, locale: "pl_PL.UTF-8" } })).toThrow("uncaptured format locale");
});
