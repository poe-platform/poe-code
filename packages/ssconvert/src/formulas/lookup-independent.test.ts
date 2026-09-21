import { expect, it } from "vitest";
import { lookupFunctions } from "./functions/lookup.js";
import type { FunctionHost, Value } from "./functions/types.js";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";
const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const s = (value: string): CellValue => ({ kind: "string", value });
const e = (value: string): CellValue => ({ kind: "error", value });
function calculate(formula: string): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: n(4) }, { row: 1, column: 0, value: n(8) },
    { row: 4, column: 4, formula, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells.find(cell => cell.row === 4 && cell.column === 4)!.value;
}
// Source-backed expectations; native differential QA is separate and unmeasured.
it.each<[string, CellValue]>([
  ['=ADDRESS(1,1,1,TRUE,"A1B")', s("A1B!$A$1")],
  ['=ADDRESS(1,1,1,TRUE,"A1")', s("'A1'!$A$1")],
  ['=ADDRESS(1,1,1,TRUE,"A\\\\B")', s("'A\\\\B'!$A$1")],
  ['=ADDRESS(1,1,1,TRUE,"A١")', s("'A١'!$A$1")],
  ["=ADDRESS(-1,0,4,FALSE)", s("R[-1]C")], ["=ADDRESS(-6,0,4,FALSE)", e("#VALUE!")],
  ["=AREAS(A1:A2)", n(1)], ["=AREAS(3)", e("#VALUE!")],
  ["=CHOOSE(2,1/0,8)", n(8)],
  ["=ROW(CHOOSE(1,A1))", e("#VALUE!")], ["=ROW(CHOOSE(1,A1:A1))", n(1)], ['=CHOOSE("2",7,8)', e("#VALUE!")],
  ["=COLUMN(A1:A2)", n(1)], ["=COLUMN(2)", e("#VALUE!")],
  ['=COLUMNNUMBER("$IV")', n(256)], ['=COLUMNNUMBER("IW")', e("#VALUE!")],
  ["=COLUMNS({1,2;3,4})", n(2)], ["=COLUMNS()", e("#N/A")],
  ["=HLOOKUP(2,{1,2;7,8},2,FALSE)", n(8)], ["=HLOOKUP(2,{1,2;7,8},3)", e("#REF!")],
  ['=HYPERLINK("url","label")', s("label")], ["=HYPERLINK()", e("#N/A")],
  ['=INDIRECT("A2")', n(8)], ['=INDIRECT("bogus")', e("#REF!")],
  ["=INDEX(A1:A2,2)", n(8)], ["=ROW(INDEX(A1:A2,2))", n(2)],
  ["=INDEX((A1,A2),1,1,2)", e("#REF!")],
  ["=INDEX(A1)", e("#REF!")], ["=INDEX(A1:A1)", n(4)],
  ["=INDEX((A1:A1,A2:A2),1,1,2)", e("#REF!")],
  ['=XMATCH("STRASSE",{"Straße"},0)', n(1)], ["=INDEX({7,8})", n(7)], ["=INDEX({7},0)", e("#REF!")],
  ["=LOOKUP(2,{1,2;7,8})", n(8)], ["=LOOKUP(0,{1,2})", e("#N/A")],
  ["=MATCH(2,{1;2;2},1)", n(3)], ["=MATCH(2,{2;2;2},-1)", n(2)],
  ["=MATCH(1,{1,2;3,4},0)", e("#N/A")],
  ["=OFFSET(A1,1,0)", n(8)], ["=OFFSET(A1,-1,0)", e("#REF!")],
  ["=ROW(A1:A2)", n(1)], ["=ROW({1;2})", e("#VALUE!")],
  ["=ROWS({1;2})", n(2)], ["=ROWS(1,2)", e("#N/A")],
  ["=SHEETS(A1)", n(1)], ["=SHEETS(1,2)", e("#N/A")],
  ['=SHEET("sheet1")', n(1)], ['=SHEET("absent")', e("#NUM!")],
  ["=SORT({1;3;2})", n(3)], ["=SORT({1;3},2)", e("#VALUE!")],
  ["=TRANSPOSE({1,2;3,4})", n(1)], ["=TRANSPOSE()", e("#N/A")],
  ["=UNIQUE({1;1;2},FALSE,TRUE)", n(2)], ["=UNIQUE({1;1},FALSE,TRUE)", e("#VALUE!")],
  ["=VLOOKUP(2,{1,7;2,8},2,FALSE)", n(8)], ["=VLOOKUP(2,{1,7;2,8},0)", e("#VALUE!")],
  ["=XLOOKUP(2,{1;2},{7;8})", n(8)], ["=XLOOKUP(2,{1;2},{7})", e("#REF!")],
  ["=XMATCH(2,{2;2;2},0,2)", n(2)], ["=XMATCH(3,{1;2},0,2)", e("#N/A")],
  ["=XMATCH(2,{1;2;2},0,-1)", n(3)], ["=XMATCH(4,{5;3;1},-1,-2)", n(1)],
  ["=ARRAY(7,8)", n(7)], ["=ARRAY()", e("#VALUE!")],
  ["=FLIP({1;2;3})", n(3)], ["=FLIP()", e("#N/A")]
])("independently stresses %s", (formula, expected) => { expect(calculate(formula)).toEqual(expected); });

it("UNIQUE keeps empty and numeric zero rows distinct", () => {
  const matrix: Value = { kind: "matrix", rows: [[{ kind: "blank" }], [n(0)]] };
  const host: FunctionHost = {
    book: { sheets: [] }, context, position: { sheet: "s", row: 0, column: 0 }, array: false,
    matrix: () => matrix, scalar(value) {
      if (value.kind === "matrix") return value.rows[0]![0]!;
      if (value.kind === "range" || value.kind === "set") throw new Error("Unexpected reference");
      return value;
    },
    evaluate() { throw new Error("Unexpected evaluation"); },
    cell: () => undefined, fetchCell() { throw new Error("Unexpected fetch"); }, read: () => ({ kind: "blank" }), indirect: () => e("#REF!"), tick() {}
  };
  expect(lookupFunctions.UNIQUE!([matrix], host)).toEqual(matrix);
});

it("preserves formula caches until forced lookup recalculation", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=XMATCH(2,{1;2})", value: n(99), cachedResult: n(99), formulaDirty: false }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(n(99));
  const recalculated = recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!;
  expect(recalculated.formula).toBe("=XMATCH(2,{1;2})");
  expect(recalculated.cachedResult).toEqual(n(2));
  expect(book.sheets[0]!.cells[0]!.value).toEqual(n(99));
});

it("XLOOKUP returns the complete selected row in an array context", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "lookup", kind: "array", expression: "=XLOOKUP(2,{1;2},{3,4;7,8})",
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } }
  ] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(cell => cell.value)).toEqual([n(7), n(8)]);
});

it("lookup recalculation enforces cancellation and the workbook work budget", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=XMATCH(3,{1;2;3})", value: n(99), formulaDirty: true }
  ] }] };
  const controller = new AbortController(), reason = new Error("lookup cancelled"); controller.abort(reason);
  expect(() => recalculateWorkbook(book, { ...context, signal: controller.signal })).toThrow(reason);
  expect(() => recalculateWorkbook(book, { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow("ssconvert workbook work limit exceeded");
  expect(book.sheets[0]!.cells[0]!.value).toEqual(n(99));
});

it("INDEX evaluates a named direct-cell source without requesting a reference", () => {
  const book: Workbook = { names: [{ name: "source_cell", expression: "=Sheet1!$A$1" }], sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: n(4) },
    { row: 0, column: 1, formula: "=INDEX(source_cell)", value: n(99), formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[1]!.value).toEqual(e("#REF!"));
});

it.each<[string, CellValue]>([
  ["=INDEX(source_union,2)", n(8)], ["=INDEX(source_union,1,1,2)", e("#REF!")],
  ["=ROW(CHOOSE(1,source_cell))", e("#VALUE!")]
])("uses source flags and syntax for %s", (formula, expected) => {
  const book: Workbook = { names: [
    { name: "source_cell", expression: "=Sheet1!$A$1" },
    { name: "source_union", expression: "=(Sheet1!$A$1,Sheet1!$A$2)" }
  ], sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: n(4) }, { row: 1, column: 0, value: n(8) },
    { row: 4, column: 4, formula, value: n(99), formulaDirty: true }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[2]!.value).toEqual(expected);
});
