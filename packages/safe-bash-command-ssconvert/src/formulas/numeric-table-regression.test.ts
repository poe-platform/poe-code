import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";
import { setCellText } from "../workbook/updates/index.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });

// Independent released-native concat controls, not numeric CSV rendering.
it.each([
  ["=(1e308)&\"\"", "1E+308"], ["=(1/3)&\"\"", "0.3333333333333333"],
  ["=1e-7&\"\"", "1E-07"], ["=1e20&\"\"", "1E+20"]
])("renders binary64 formula text using reference notation: %s", (formula, expected) => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: n(0) }] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: expected });
});

// value.c:value_new_float explicitly maps both signs of zero to positive zero.
it.each(["=-0", "=-1*0", "=0/-1", "=PRODUCT(-1,1e-300,1e-300)", "=(-1e-300)*1e-300"])("normalizes the sign of calculated zero: %s", formula => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: n(9) }] }] };
  const output = recalculateWorkbook(input, context).sheets[0]!.cells[0]!;
  expect(output.value).toEqual(n(0));
  expect(output.cachedResult).toEqual(n(0));
  expect(input.sheets[0]!.cells[0]!.value).toEqual(n(9));
});

// expr.c:bin_arith admits negative bases only when vb == (int)vb. The retained
// dependency profile uses a 32-bit C int, not JavaScript's wider integer domain.
it.each([
  ["=(-1)^2147483647", n(-1)], ["=(-1)^(-2147483648)", n(1)],
  ["=(-1)^2147483648", { kind: "error", value: "#NUM!" }],
  ["=(-1)^(-2147483649)", { kind: "error", value: "#NUM!" }],
  ["=1^2147483648", n(1)]
] as const)("uses the reference negative-base exponent domain: %s", (formula, expected) => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: n(0) }] }] };
  expect(recalculateWorkbook(input, context).sheets[0]!.cells[0]!.value).toEqual(expected);
});

it.each([
  ["=SUM({2;3;4}^{1;1})", n(5)],
  ["=IF({TRUE,FALSE},{2;3},7)", { kind: "error", value: "#VALUE!" }],
  ["=IF(TRUE,{2;3},{4,5})", { kind: "error", value: "#VALUE!" }],
  ["=IF({TRUE,FALSE},{2},7)", { kind: "error", value: "#VALUE!" }]
] as const)("uses operator/function-specific array dimensions: %s", (expression, expected) => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [], formulaGroups: [{ id: "a", kind: "array", expression,
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells[0]!.value).toEqual(expected);
});

it("refuses incompatible IF array arguments before evaluating later branches", () => {
  let draws = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [], formulaGroups: [{ id: "a", kind: "array", expression: "=IF({TRUE,FALSE},{2;3},RAND())",
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .5; } } }, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: "#VALUE!" });
  expect(draws).toBe(0);
});

it.each([
  ["=(1/0)+RAND()", "#DIV/0!"], ["=\"invalid\"+RAND()", "#VALUE!"], ["=(1/0)=RAND()", "#DIV/0!"]
] as const)("preserves scalar left refusal before later effects inside array context: %s", (expression, expected) => {
  let draws = 0;
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [], formulaGroups: [{ id: "a", kind: "array", expression,
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }] }] };
  expect(recalculateWorkbook(input, { ...context, random: { next() { draws++; return .5; } } }, true).sheets[0]!.cells[0]!.value).toEqual({ kind: "error", value: expected });
  expect(draws).toBe(0);
});

function table(headers: readonly Cell[]): Workbook {
  return { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: "=D1+E1+1", formulaDirty: true, value: n(0) },
    { row: 0, column: 3, value: n(10) }, { row: 0, column: 4, value: n(20) },
    { row: 1, column: 1, formulaGroup: "t", formulaDirty: true, value: n(0) },
    ...headers
  ], formulaGroups: [{ id: "t", kind: "array", expression: "=TABLE(D1,E1)",
    range: { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 } }] }] };
}

// func-builtin.c:gnumeric_table continues without evaluating an absent header;
// value_new_array initializes those untouched positions to numeric zero.
it("leaves TABLE positions with absent headers at zero and restores input caches", () => {
  const input = table([{ row: 0, column: 1, value: n(2) }, { row: 1, column: 0, value: n(3) }]);
  const output = recalculateWorkbook(input, context, true);
  expect(output.sheets[0]!.cells.filter(cell => cell.formulaGroup === "t").map(cell => cell.value)).toEqual([n(6), n(0), n(0), n(0)]);
  expect(output.sheets[0]!.cells.find(cell => cell.column === 3)!.value).toEqual(n(10));
  expect(output.sheets[0]!.cells.find(cell => cell.column === 4)!.value).toEqual(n(20));
});

it("distinguishes present blank TABLE headers from absent headers", () => {
  const input = table([{ row: 0, column: 1, value: { kind: "blank" } }, { row: 1, column: 0, value: { kind: "blank" } }]);
  expect(recalculateWorkbook(input, context, true).sheets[0]!.cells.filter(cell => cell.formulaGroup === "t").map(cell => cell.value)).toEqual([n(1), n(0), n(0), n(0)]);
});

it("substitutes TABLE column input before calculating its dependent row header", () => {
  const input = table([{ row: 0, column: 1, value: n(2) },
    { row: 1, column: 0, formula: "=D1*2", formulaDirty: false, value: n(20), cachedResult: n(20) }]);
  const output = recalculateWorkbook(input, context, true);
  expect(output.sheets[0]!.cells.find(cell => cell.formulaGroup === "t")!.value).toEqual(n(7));
  expect(input.sheets[0]!.cells.find(cell => cell.row === 1 && cell.column === 0)!.cachedResult).toEqual(n(20));
});

it("returns the evaluated row header directly when TABLE has no row input", () => {
  let draws = 0;
  const original = table([{ row: 0, column: 1, value: n(2) },
    { row: 1, column: 0, formula: "=RAND()+D1*0", formulaDirty: false, value: n(99), cachedResult: n(99) }]);
  const input: Workbook = { sheets: [{ ...original.sheets[0]!, formulaGroups: [{ ...original.sheets[0]!.formulaGroups![0]!, expression: "=TABLE(D1,)" }] }] };
  const output = recalculateWorkbook(input, { ...context, random: { next() { return ++draws / 10; } } });
  expect(output.sheets[0]!.cells.find(cell => cell.formulaGroup === "t")!.value).toEqual(n(.1));
  expect(draws).toBe(2);
});

it("does not call a resolver in a TABLE row skipped for an absent column header", () => {
  let calls = 0;
  const input = table([{ row: 1, column: 0, formula: "='[allowed]Sheet'!A1", formulaDirty: false, cachedResult: n(3), value: n(3) }]);
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { calls++; return n(8); } } });
  expect(calls).toBe(0);
  expect(output.sheets[0]!.cells.filter(cell => cell.formulaGroup === "t").map(cell => cell.value)).toEqual([n(0), n(0), n(0), n(0)]);
});

it.each(["=TABLE(Other!D1,Other!E1)", "=TABLE('[external]Other'!D1,'[external]Other'!E1)"])("uses TABLE input coordinates on its own sheet without resolver authority: %s", expression => {
  let calls = 0;
  const original = table([{ row: 0, column: 1, value: n(2) }, { row: 1, column: 0, value: n(3) }]);
  const input: Workbook = { sheets: [{ ...original.sheets[0]!, formulaGroups: [{ ...original.sheets[0]!.formulaGroups![0]!, expression }] },
    { id: "other", name: "Other", cells: [{ row: 0, column: 3, value: n(100) }, { row: 0, column: 4, value: n(200) }] }] };
  const output = recalculateWorkbook(input, { ...context, externalReferences: { resolve() { calls++; return n(100); } } }, true);
  expect(output.sheets[0]!.cells.find(cell => cell.formulaGroup === "t")!.value).toEqual(n(6));
  expect(calls).toBe(0);
  expect(output.sheets[1]!.cells.map(cell => cell.value)).toEqual([n(100), n(200)]);
  expect(input.sheets[0]!.cells.find(cell => cell.column === 3)!.value).toEqual(n(10));
});

it.each(["=SUM((A1):(C1))", "=SUM(IF(TRUE,A1,A2):(C1))"])("invalidates computed-range caches after a literal cell update: %s", formula => {
  const input: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 1, column: 3, formula, value: n(4), cachedResult: n(4), formulaDirty: false },
    { row: 0, column: 0, value: n(1) }, { row: 0, column: 2, value: n(3) }
  ] }] };
  const updated = setCellText(input, { sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }, "8", context);
  expect(updated.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(updated, context).sheets[0]!.cells[0]!.value).toEqual(n(12));
  expect(input.sheets[0]!.cells[0]!.cachedResult).toEqual(n(4));
});
