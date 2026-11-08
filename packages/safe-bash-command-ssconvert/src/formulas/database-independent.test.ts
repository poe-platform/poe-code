import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
const e = (value: string): CellValue => ({ kind: "error", value });
const s = (value: string): CellValue => ({ kind: "string", value });
const cell = (row: number, column: number, value: CellValue): Cell => ({ row, column, value });
function fixture(condition: CellValue = s(">=1"), data: readonly CellValue[] = [n(2), n(4)]): Cell[] {
  return [cell(0, 0, s("Name")), cell(0, 1, s("Value")), cell(0, 3, s("Name")), cell(1, 3, condition),
    ...data.flatMap((value, index) => [cell(index + 1, 0, n(index + 1)), cell(index + 1, 1, value)])];
}
function calculate(formula: string, cells = fixture(), supplied = context): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...cells, { row: 20, column: 20, formula, value: n(999), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, supplied).sheets[0]!.cells.find(cell => cell.row === 20 && cell.column === 20)!.value;
}
const aggregates: [string, number, CellValue][] = [
  ["DAVERAGE", 3, e("#NUM!")], ["DCOUNT", 2, n(0)], ["DCOUNTA", 2, n(0)],
  ["DGET", 2, e("#VALUE!")], ["DMAX", 4, e("#NUM!")], ["DMIN", 2, e("#NUM!")],
  ["DPRODUCT", 8, n(1)], ["DSTDEV", Math.sqrt(2), e("#NUM!")], ["DSTDEVP", 1, e("#NUM!")],
  ["DSUM", 6, n(0)], ["DVAR", 2, e("#NUM!")], ["DVARP", 1, e("#NUM!")]
];
it.each(aggregates)("independently checks normal and no-match %s", (name, expected, noMatch) => {
  expect(calculate(`=${name}(A1:B3,"Value",D1:D2)`)).toEqual(n(expected));
  expect(calculate(`=${name}(A1:B3,"Value",D1:D2)`, fixture(s(">99")))).toEqual(noMatch);
});
it.each(aggregates)("checks argument and header-only contracts for %s", name => {
  expect(calculate(`=${name}(A1:B3,"Value")`)).toEqual(e("#N/A"));
  expect(calculate(`=${name}(A1:B3,"Value",D1:D2,0)`)).toEqual(e("#N/A"));
  expect(calculate(`=${name}(A1:B3,"Value",D1:D1)`)).toEqual(e("#NUM!"));
  expect(calculate(`=${name}({1,2;3,4},2,D1:D2)`)).toEqual(e("#NUM!"));
  expect(calculate(`=${name}(A1:B3,"Value",{1;2})`)).toEqual(e("#NUM!"));
});
it("counts errors in DCOUNTA but ignores them in DCOUNT and does not poison an earlier DGET", () => {
  const data = fixture(s(">=1"), [n(2), e("#DIV/0!")]);
  expect(calculate('=DCOUNTA(A1:B3,"Value",D1:D2)', data)).toEqual(n(2));
  expect(calculate('=DCOUNT(A1:B3,"Value",D1:D2)', data)).toEqual(n(1));
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', data)).toEqual(e("#DIV/0!"));
});
it("does not let a later matching error replace the first DGET value", () => {
  expect(calculate('=DGET(A1:B3,"Value",D1:D2)', fixture(s(">=1"), [n(2), e("#DIV/0!")]))).toEqual(n(2));
});
it("matches numeric columns beyond the database range", () => {
  const data = [...fixture(), cell(1, 2, n(7)), cell(2, 2, n(11))];
  expect(calculate("=DSUM(A1:B3,3,D1:D2)", data)).toEqual(n(18));
  expect(calculate("=DSUM(A1:B3,0,D1:D2)", data)).toEqual(e("#NUM!"));
});
it("skips a criterion against an absent sparse database cell", () => {
  const data = fixture(s(">99")).filter(value => !(value.row === 1 && value.column === 0));
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', data)).toEqual(n(2));
  // Released fn-database/functions.c fetches the first-column cell before
  // checking criteria with a missing field; the new blank fails >99.
  expect(calculate("=DCOUNT(A1:B3,,D1:D2)", data)).toEqual(n(0));
  expect(calculate("=DCOUNTA(A1:B3,,D1:D2)", data)).toEqual(n(0));
});
it("uses AND conditions within rows and OR between criteria rows", () => {
  const data = [...fixture(s(">=1")), cell(0, 4, s("Value")), cell(1, 4, s(">3")), cell(2, 3, n(1)), cell(2, 4, n(2))];
  expect(calculate('=DSUM(A1:B3,"Value",D1:E3)', data)).toEqual(n(6));
});
it("keeps GETPIVOTDATA argument and field failures distinct", () => {
  expect(calculate('=GETPIVOTDATA(A1:B3,"Value")')).toEqual(n(4));
  expect(calculate('=GETPIVOTDATA(A1:B3,"missing")')).toEqual(e("#REF!"));
  expect(calculate('=GETPIVOTDATA(A1:B3)')).toEqual(e("#N/A"));
  expect(calculate('=GETPIVOTDATA(A1:B3,"Value",0)')).toEqual(e("#N/A"));
  expect(calculate('=GETPIVOTDATA({1,2;3,4},2)')).toEqual(e("#REF!"));
});

it("preserves selected aggregate precision across cancellation and scaled products", () => {
  expect(calculate('=DSUM(A1:B4,"Value",D1:D2)', fixture(s(">=1"), [n(1e308), n(1e308), n(-1e308)]))).toEqual(n(1e308));
  const values = [n(1e308), n(1e308), n(1e-308), n(1e-308)];
  expect(calculate('=DPRODUCT(A1:B5,"Value",D1:D2)', fixture(s(">=1"), values))).toEqual(n(.9999999999999999));
});
it("rejects work-budget exhaustion without increasing the caller's limit", () => {
  expect(() => calculate('=DSUM(A1:B1000,"Value",D1:D2)', fixture(), {
    ...context, limits: { ...context.limits, workbookWork: 30 }
  })).toThrow("limit exceeded");
});
it("uses empty criteria rows as unconditional branches", () => {
  const data = fixture(s(">99")).filter(value => !(value.row === 1 && value.column === 3));
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', data)).toEqual(n(6));
});
it("distinguishes boolean criteria from numeric values", () => {
  const data = fixture({ kind: "boolean", value: true });
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', data)).toEqual(n(0));
  const booleanData = data.map(value => value.column === 0 && value.row === 1 ? cell(1, 0, { kind: "boolean", value: true }) : value);
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', booleanData)).toEqual(n(2));
});
it("matches prefix wildcards and numeric text only under equality", () => {
  const data = fixture(s("ap")).map(value => value.column === 0 && value.row > 0 ? cell(value.row, 0, s(value.row === 1 ? "APPLE" : "pear")) : value);
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', data)).toEqual(n(2));
  const numericData = fixture(s("=2")).map(value => value.column === 0 && value.row === 2 ? cell(2, 0, s("2")) : value);
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', numericData)).toEqual(n(4));
  const ordered = numericData.map(value => value.row === 1 && value.column === 3 ? cell(1, 3, s(">1")) : value);
  expect(calculate('=DSUM(A1:B3,"Value",D1:D2)', ordered)).toEqual(n(0));
});

it.each(["DCOUNT", "DCOUNTA"])("persists %s fetched blank cells without modifying its input", name => {
  const data = fixture(s(">99")).filter(value => !(value.row === 1 && value.column === 0));
  const formula = `=${name}(A1:B3,,D1:D2)`;
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    cell(20, 20, n(999)), ...data
  ].map(value => value.row === 20 ? { ...value, formula, formulaDirty: true } : value) }] };
  const calculated = recalculateWorkbook(book, context);
  expect(calculated.sheets[0]!.cells[0]!.cachedResult).toEqual(n(0));
  expect(calculated.sheets[0]!.cells.at(-1)).toEqual(cell(1, 0, { kind: "blank" }));
  expect(calculated.sheets[0]!.cells.filter(value => value.row === 1 && value.column === 0)).toHaveLength(1);
  expect(book.sheets[0]!.cells).toHaveLength(8);
  expect(book.sheets[0]!.cells.some(value => value.row === 1 && value.column === 0)).toBe(false);
  expect(recalculateWorkbook(calculated, context)).toEqual(calculated);
  expect(recalculateWorkbook(calculated, context, true).sheets[0]!.cells).toHaveLength(9);
});

it.each<[boolean, number]>([[true, 0], [false, 2]])("preserves materialization order when count runs first: %s", (countFirst, expectedSum) => {
  const data = fixture(s(">99")).filter(value => !(value.row === 1 && value.column === 0));
  const count = { ...cell(20, 20, n(999)), formula: '=DCOUNT(A1:B3,,D1:D2)', formulaDirty: true };
  const total = { ...cell(21, 20, n(999)), formula: '=DSUM(A1:B3,"Value",D1:D2)', formulaDirty: true };
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [...(countFirst ? [count, total] : [total, count]), ...data] }] };
  const calculated = recalculateWorkbook(book, context);
  expect(calculated.sheets[0]!.cells.find(value => value.row === 21)?.value).toEqual(n(expectedSum));
  expect(calculated.sheets[0]!.cells.find(value => value.row === 20)?.value).toEqual(n(0));
  expect(book.sheets[0]!.cells.some(value => value.row === 1 && value.column === 0)).toBe(false);
});

it("admits missing-field materialization against the cell budget before returning a workbook", () => {
  const data = fixture(s(">99")).filter(value => !(value.row === 1 && value.column === 0));
  const before = structuredClone(data);
  expect(() => calculate("=DCOUNT(A1:B3,,D1:D2)", data, {
    ...context, limits: { ...context.limits, cells: 8 }
  })).toThrow("calculation cell limit exceeded");
  expect(data).toEqual(before);
});
