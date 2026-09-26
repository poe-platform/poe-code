import { expect, it } from "vitest";
import { recalculateWorkbook } from "../workbook/updates/recalculation.js";
import type { CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";

export const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 },
  own() {}
};
const n = (value: number): CellValue => ({ kind: "number", value });
function calculate(formula: string, cells: readonly Cell[] = [], row = 0): CellValue {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    ...cells, { row, column: 2, formula, value: n(0), formulaDirty: true }
  ] }] };
  return recalculateWorkbook(book, context).sheets[0]!.cells.at(-1)!.value;
}

it("evaluates only the selected IF branch and distinguishes absent and omitted branches", () => {
  expect(calculate("=IF(TRUE,7,1/0)")).toEqual(n(7));
  expect(calculate("=IF(FALSE,1/0)")).toEqual({ kind: "boolean", value: false });
  expect(calculate("=IF(FALSE,1/0,)")).toEqual(n(0));
});
it("intersects vertical references at the formula row", () => {
  expect(calculate("=A1:A3+1", [0, 1, 2].map(row => ({ row, column: 0, value: n(row + 10) })), 1)).toEqual(n(12));
});
it("implements numeric text coercion, comparison type ordering and power domain errors", () => {
  expect(calculate('="2"+3')).toEqual(n(5));
  expect(calculate('="a"="A"')).toEqual({ kind: "boolean", value: true });
  expect(calculate('=1<"0"')).toEqual({ kind: "boolean", value: true });
  expect(calculate("=0^0")).toEqual({ kind: "error", value: "#NUM!" });
  expect(calculate("=PRODUCT(2,3,4)")).toEqual(n(24));
  expect(calculate("=GNUMERIC_VERSION()")).toEqual({ kind: "string", value: "1.12.61" });
});

it("preserves finite PRODUCT results across intermediate overflow and underflow", () => {
  expect(calculate("=PRODUCT(1e308,1e308,1e-308,1e-308)")).toEqual(n(.9999999999999999));
  expect(calculate("=PRODUCT(1e-300,1e-300,1e300,1e300)")).toEqual(n(1));
});
it("uses the reference SUM accumulation order when cancellation prevents overflow", () => {
  expect(calculate("=SUM(1e308,1e308,-1e308)")).toEqual(n(1e308));
});
it("uses cached values for noniterative cycles and bounded iterations for self references", () => {
  const book: Workbook = { iteration: { enabled: true, maximum: 3, tolerance: 0 }, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=A1+1", formulaDirty: true, value: n(0) }
  ] }] };
  expect(recalculateWorkbook({ ...book, iteration: { ...book.iteration!, enabled: false } }, context).sheets[0]!.cells[0]!.value).toEqual(n(1));
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(n(2));
});
it("reads the current value after recursive evaluation clears the dirty flag", () => {
  const book: Workbook = { iteration: { enabled: true, maximum: 100, tolerance: 1 }, sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=A1/2", formulaDirty: true, value: n(100) }
  ] }] };
  expect(recalculateWorkbook(book, context).sheets[0]!.cells[0]!.value).toEqual(n(25));
});
it("materializes shared formulas and projects array results without flattening dimensions", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, value: n(3) }, { row: 1, column: 0, value: n(7) }
  ], formulaGroups: [
    { id: "shared", kind: "shared", expression: "=A1+1", range: { startRow: 0, endRow: 1, startColumn: 1, endColumn: 1 } },
    { id: "array", kind: "array", expression: "=A1:A2*{2,3}", range: { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 } }
  ] }] };
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells.map(c => c.value)).toEqual([3, 7, 4, 8, 6, 9, 14, 21].map(n));
});
it("recalculates volatile dependents using one draw per cell per run", () => {
  let draws = 0;
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 1, formula: "=A1+A1", value: n(10), cachedResult: n(10), formulaDirty: false },
    { row: 0, column: 0, formula: "=RAND()", value: n(5), cachedResult: n(5), formulaDirty: false }
  ] }] };
  expect(recalculateWorkbook(book, { ...context, random: { next() { draws++; return .25; } } }).sheets[0]!.cells[0]!.value).toEqual(n(.5));
  expect(draws).toBe(1);
});
it("rejects workbook accessors before direct SDK evaluation can invoke them", () => {
  let reads = 0;
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [{ row: 0, column: 0, value: n(0),
    get formula() { reads++; return "=1"; }, formulaDirty: true }] }] };
  expect(() => recalculateWorkbook(book, context)).toThrow("Unsupported workbook accessor");
  expect(reads).toBe(0);
});
it("admits authorized external arrays wider than the default sheet width", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet1", cells: [
    { row: 0, column: 0, formula: "=SUM('[authorized.xls]Sheet1'!A1:IW1)", formulaDirty: true, value: n(0) }
  ] }] };
  expect(recalculateWorkbook(book, { ...context, externalReferences: { resolve() {
    return { kind: "array", rows: [Array.from({ length: 257 }, (_, i) => n(i))] };
  } } }).sheets[0]!.cells[0]!.value).toEqual(n(32896));
});
