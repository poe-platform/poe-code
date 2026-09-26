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
const b = (value: boolean): CellValue => ({ kind: "boolean", value });
function database(criteria: CellValue): CellValue {
  const keys = [b(true), b(false), n(1), n(0), s("TRUE"), s("FALSE"), s("1")];
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: s("Key") }, { row: 0, column: 1, value: s("Amount") },
    ...keys.flatMap((value, index) => [
      { row: index + 1, column: 0, value }, { row: index + 1, column: 1, value: n(2 ** index) }
    ]),
    { row: 0, column: 3, value: s("Key") }, { row: 1, column: 3, value: criteria },
    { row: 10, column: 10, formula: '=DSUM(A1:B8,"Amount",D1:D2)', value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells.find(cell => cell.row === 10)!.value;
}
// criteria.c criteria_inspect_values explicitly matches boolean criteria only
// against boolean cells, even when a string criterion parses to a boolean.
it.each<[string, number]>([
  ["TRUE", 1], ["=TRUE", 1], ["=FALSE", 2], ["<>TRUE", 126], ["<TRUE", 2],
  [">FALSE", 1], ["<=TRUE", 3], [">=FALSE", 3], ["1", 68], ["=1", 68], ["<>1", 123]
])("retains criteria type identity for %s", (criteria, expected) => {
  expect(database(s(criteria))).toEqual(n(expected));
});
it("retains raw boolean and number criteria type identity", () => {
  expect(database(b(true))).toEqual(n(1));
  expect(database(b(false))).toEqual(n(2));
  expect(database(n(1))).toEqual(n(68));
});
it.each<[string, CellValue]>([
  ['=VALUE("TRUE")', b(true)], ['=N("FALSE")', b(false)], ['=NUMBERVALUE("  TRUE",".")', b(true)],
  ['=LEFT("abc","TRUE")', s("a")], ['=IF("FALSE",7,9)', n(9)]
])("independently checks matched boolean through %s", (formula, expected) => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula, formulaDirty: true, value: n(999) }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(expected);
});
it("coerces numeric array operands matched as booleans without changing VALUE result types", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "condition", kind: "array", expression: '=IF({"TRUE","FALSE"},7,9)',
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } },
    { id: "length", kind: "array", expression: '=LEFT("abc",{"TRUE","FALSE"})',
      range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 } },
    { id: "value", kind: "array", expression: '=VALUE({"TRUE","FALSE"})',
      range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 } }
  ] }] };
  const cells = recalculateWorkbook(book, context, true).sheets[0]!.cells;
  expect(cells.filter(cell => cell.row === 0).map(cell => cell.value)).toEqual([n(7), n(9)]);
  expect(cells.filter(cell => cell.row === 1).map(cell => cell.value)).toEqual([s("a"), s("")]);
  expect(cells.filter(cell => cell.row === 2).map(cell => cell.value)).toEqual([b(true), b(false)]);
});
