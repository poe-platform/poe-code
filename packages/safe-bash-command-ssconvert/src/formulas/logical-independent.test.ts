import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";
import { callFunction } from "./functions/registry.js";
import type { FunctionHost, Value } from "./functions/types.js";
import type { FormulaNode } from "./ast.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const b = (value: boolean): CellValue => ({ kind: "boolean", value });
const e = (value: string): CellValue => ({ kind: "error", value });
function calculate(formula: string): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 4, column: 4, formula, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value;
}

// Expectations audited against released fn-logical/functions.c and SCALAR_NON_EMPTY.
it.each<[string, CellValue]>([
  ["=SWITCH(9,1,8,A1)", n(0)], ["=SWITCH(A1,0,7,8)", n(7)],
  ["=SWITCH(0,A1,7,8)", n(7)], ["=SWITCH(1,TRUE,7,8)", n(8)],
  ["=SWITCH(2,1,1/0,2,7,1/0)", n(7)], ["=SWITCH(2,1/0,8,2,7)", e("#DIV/0!")],
  ["=SWITCH()", e("#VALUE!")], ["=SWITCH(1)", e("#N/A")],
  ["=IFS(FALSE,1/0,TRUE,7,TRUE,1/0)", n(7)], ["=IFS(TRUE,A1)", n(0)],
  ["=IFS(FALSE,7)", e("#N/A")], ["=IFS(1,7)", e("#VALUE!")],
  ["=IFS(1/0,7)", e("#DIV/0!")],
  ["=IFS(FALSE,7,1/0)", e("#DIV/0!")], ["=IFS(FALSE,7,1)", e("#VALUE!")],
  ['=AND("TRUE",A1)', e("#VALUE!")], ["=AND({1,0;2,3})", b(false)],
  ["=AND(FALSE,1/0)", e("#DIV/0!")], ["=AND()", e("#VALUE!")],
  ["=OR({0,2;0,0})", b(true)], ["=OR(TRUE,1/0)", e("#DIV/0!")],
  ["=OR()", e("#VALUE!")], ["=XOR(1,1,1)", b(true)],
  ["=XOR(1,1)", b(false)], ["=XOR(1,1/0)", e("#DIV/0!")],
  ["=XOR()", e("#VALUE!")], ['=NOT("FALSE")', b(true)],
  ['=NOT("1")', e("#VALUE!")], ["=NOT(A1)", b(true)],
  ["=NOT()", e("#N/A")], ["=NOT(1,2)", e("#N/A")],
  ["=IFERROR(7,1/0)", n(7)], ["=IFERROR(1/0,9)", n(9)],
  ["=IFERROR(1)", e("#N/A")], ["=IFNA(#N/A,9)", n(9)],
  ["=IFNA(1/0,9)", e("#DIV/0!")], ["=IFNA(1,2,3)", e("#N/A")],
  ["=TRUE()", b(true)], ["=TRUE(1)", e("#N/A")],
  ["=FALSE()", b(false)], ["=FALSE(1)", e("#N/A")]
])("independently stresses %s", (formula, expected) => {
  expect(calculate(formula)).toEqual(expected);
});

it.each(["IFERROR", "IFNA"])("evaluates both %s operands eagerly even when the first succeeds", name => {
  const nodes: FormulaNode[] = [
    { kind: "literal", value: n(7), start: 0, end: 1 },
    { kind: "literal", value: e("#DIV/0!"), start: 2, end: 3 }
  ];
  const visited: FormulaNode[] = [];
  const scalar = (value: Value): CellValue => {
    if (value.kind === "matrix") return value.rows[0]?.[0] ?? { kind: "blank" };
    if (value.kind === "range" || value.kind === "set") throw new Error("Unexpected reference");
    return value;
  };
  const host: FunctionHost = {
    book: { sheets: [] }, context, position: { sheet: "s", row: 0, column: 0 }, array: false,
    evaluate(node) { visited.push(node); if (node.kind !== "literal") throw new Error("Unexpected expression"); return node.value; },
    scalar, matrix: value => ({ kind: "matrix", rows: [[scalar(value)]] }),
    cell: () => undefined, fetchCell() { throw new Error("Unexpected fetch"); }, read: () => ({ kind: "blank" }), indirect: () => e("#REF!"), tick() {}
  };
  expect(callFunction(name, nodes, host)).toEqual(n(7));
  expect(visited).toEqual(nodes);
});

it("calculates conditional array elements with their own error classifications", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [], formulaGroups: [
    { id: "errors", kind: "array", expression: "=IFERROR({1,#DIV/0!;#N/A,4},9)",
      range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } },
    { id: "na", kind: "array", expression: "=IFNA({1,#DIV/0!;#N/A,4},9)",
      range: { startRow: 0, endRow: 1, startColumn: 3, endColumn: 4 } }
  ] }] };
  const values = recalculateWorkbook(book, context, true).sheets[0]!.cells;
  const at = (row: number, column: number) => values.find(cell => cell.row === row && cell.column === column)?.value;
  expect([at(0, 0), at(0, 1), at(1, 0), at(1, 1)]).toEqual([n(1), n(9), n(9), n(4)]);
  expect([at(0, 3), at(0, 4), at(1, 3), at(1, 4)]).toEqual([n(1), e("#DIV/0!"), n(9), n(4)]);
});

it("preserves formula text and replaces a stale conditional cache only on recalculation", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: n(0) },
    { row: 0, column: 1, formula: "=SWITCH(A1,0,7,8)", value: n(99), cachedResult: n(99), formulaDirty: false }
  ] }] };
  const preserved = recalculateWorkbook(book, context).sheets[0]!.cells[1]!;
  expect(preserved.value).toEqual(n(99));
  const recalculated = recalculateWorkbook(book, context, true).sheets[0]!.cells[1]!;
  expect(recalculated.formula).toBe("=SWITCH(A1,0,7,8)");
  expect(recalculated.value).toEqual(n(7));
  expect(recalculated.cachedResult).toEqual(n(7));
  expect(book.sheets[0]!.cells[1]!.value).toEqual(n(99));
});
