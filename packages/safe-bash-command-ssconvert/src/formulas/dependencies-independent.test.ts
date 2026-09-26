import { expect, it } from "vitest";
import { dirtyWorkbook, recalculateWorkbook } from "../workbook/updates/recalculation.js";
import type { CapabilityContext } from "../contracts.js";
import type { CellValue, Workbook } from "../workbook.js";
const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 3, operations: 100, workbookWork: 10000 }, own() {} };
const n = (value: number): CellValue => ({ kind: "number", value });
const s = (value: string): CellValue => ({ kind: "string", value });
function fixture(formula: string): Workbook {
  return { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 2, column: 4, formula, formulaDirty: false, value: n(4), cachedResult: n(4) },
    { row: 0, column: 0, value: n(1) }, { row: 0, column: 1, value: n(8) }, { row: 0, column: 2, value: n(3) },
    { row: 0, column: 3, value: s("A1:C1") }, { row: 1, column: 3, value: n(0) }
  ] }] };
}
const changes = [{ sheet: "s", startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }];
// Changes describe already-updated input cells, matching dirtyWorkbook's public contract.
it.each([
  '=SUM(INDIRECT("A1:C1"))', '=SUM(INDIRECT("R1C1:R1C3",FALSE))',
  '=SUM(INDIRECT("R[-2]C[-4]:R[-2]C[-2]",FALSE))',
  '=SUM(OFFSET(A2,-1,+0,1,3))', '=SUM(OFFSET(C1,0,-2,1,3))',
  '=SUM(OFFSET(A1,0,0):C1)', '=SUM(INDIRECT("A1"):C1)',
  '=SUM(OFFSET(A1,D2,D2,1,3))', '=SUM(INDIRECT(D1))',
  '=SUM(OFFSET(A1,(0),0,1,3))', '=SUM(OFFSET(A1,1-1,0,1,3))',
  '=SUM(INDIRECT("A1:"&"C1"))'
])("independently invalidates cached dynamic range interiors for %s", formula => {
  const book = fixture(formula);
  expect(recalculateWorkbook(book, context, true).sheets[0]!.cells[0]!.cachedResult).toEqual(n(12));
  const dirty = dirtyWorkbook(book, changes, context);
  expect(dirty.sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  expect(recalculateWorkbook(dirty, context).sheets[0]!.cells[0]!.cachedResult).toEqual(n(12));
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual(n(4));
});

it.each(['=SUM(OFFSET(A1,-1,0))', '=SUM(OFFSET(A1,0,0,0,1))', '=SUM(OFFSET(A1,65536,0))'])
("keeps unrelated cached errors for invalid OFFSET bounds: %s", formula => {
  const book = fixture(formula);
  expect(dirtyWorkbook(book, changes, context).sheets[0]!.cells[0]!.formulaDirty).toBe(false);
});

it("dependency scans preserve cancellation and bounded work without mutating input caches", () => {
  const book = fixture('=SUM(INDIRECT("A1"):C1)'), controller = new AbortController(), reason = new Error("cancel dependency scan");
  controller.abort(reason);
  expect(() => dirtyWorkbook(book, changes, { ...context, signal: controller.signal })).toThrow(reason);
  expect(() => dirtyWorkbook(book, changes, { ...context, limits: { ...context.limits, workbookWork: 1 } })).toThrow("ssconvert workbook work limit exceeded");
  expect(book.sheets[0]!.cells[0]!.formulaDirty).toBe(false);
});

const coordinate = (row: number, column: number) => ({ sheet: "s", startRow: row, endRow: row, startColumn: column, endColumn: column });
function replaceInput(book: Workbook, row: number, column: number, value: CellValue): Workbook {
  return { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => cell.row === row && cell.column === column ? { ...cell, value } : cell) })) };
}
it("replays persisted computed links, switches targets, and removes obsolete target metadata", () => {
  const first = recalculateWorkbook({ ...fixture('=INDIRECT(LEFT(D1,2))'), sheets: fixture('=INDIRECT(LEFT(D1,2))').sheets.map(sheet => ({ ...sheet,
    cells: sheet.cells.map(cell => cell.formula ? { ...cell, formulaDirty: true } : cell) })) }, context);
  const replay: Workbook = JSON.parse(JSON.stringify(first));
  expect(recalculateWorkbook(replay, context)).toEqual(first);
  expect(dirtyWorkbook(replay, [coordinate(0, 0)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(true);
  const switched = recalculateWorkbook(dirtyWorkbook(replaceInput(replay, 0, 3, s("B1suffix")), [coordinate(0, 3)], context), context);
  expect(switched.sheets[0]!.cells[0]!.cachedResult).toEqual(n(8));
  expect(switched.dependencies?.filter(dependency => dependency.dynamic).map(dependency => dependency.precedent)).toContainEqual(coordinate(0, 1));
  expect(switched.dependencies?.filter(dependency => dependency.dynamic).map(dependency => dependency.precedent)).not.toContainEqual(coordinate(0, 0));
  expect(dirtyWorkbook(switched, [coordinate(0, 0)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(false);
  expect(dirtyWorkbook(switched, [coordinate(0, 1)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(true);
});

it("links every array-group output to the evaluated INDIRECT range", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: n(1) }, { row: 1, column: 0, value: n(2) },
    { row: 0, column: 3, value: s("A1:A2") }
  ], formulaGroups: [{ id: "g", kind: "array", expression: '=INDIRECT("A1:A2")', range: { startRow: 0, endRow: 1, startColumn: 5, endColumn: 5 } }] }] };
  const first = recalculateWorkbook(book, context, true);
  expect(first.sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.cachedResult)).toEqual([n(1), n(2)]);
  const dirty = dirtyWorkbook(replaceInput(first, 1, 0, n(9)), [coordinate(1, 0)], context);
  expect(dirty.sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.formulaDirty)).toEqual([true, true]);
  const second = recalculateWorkbook(dirty, context);
  expect(second.sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.cachedResult)).toEqual([n(1), n(9)]);
  expect(recalculateWorkbook(second, context)).toEqual(second);
});

it("records only the selected computed CHOOSE target and never evaluates the other branch", () => {
  const book = fixture('=CHOOSE(1,INDIRECT(LEFT(D1,2)),INDIRECT(LEFT("C1suffix",2)))');
  const first = recalculateWorkbook(book, context, true);
  expect(first.sheets[0]!.cells[0]!.cachedResult).toEqual(n(1));
  expect(first.dependencies?.filter(dependency => dependency.dynamic).map(dependency => dependency.precedent)).toContainEqual(coordinate(0, 0));
  expect(first.dependencies?.filter(dependency => dependency.dynamic).map(dependency => dependency.precedent)).not.toContainEqual(coordinate(0, 2));
  expect(dirtyWorkbook(first, [coordinate(0, 2)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(false);
});

it("preserves a runtime-valued INDIRECT reference in an array group", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, value: n(1) }, { row: 1, column: 0, value: n(2) },
    { row: 0, column: 3, value: s("A1:A2") }
  ], formulaGroups: [{ id: "g", kind: "array", expression: '=INDIRECT(D1)', range: { startRow: 0, endRow: 1, startColumn: 5, endColumn: 5 } }] }] };
  const first = recalculateWorkbook(book, context, true);
  expect(first.sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.cachedResult)).toEqual([n(1), n(2)]);
  expect(dirtyWorkbook(first, [coordinate(1, 0)], context).sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.formulaDirty)).toEqual([true, true]);
});

it("removes the old computed target after switching to an invalid reference", () => {
  const first = recalculateWorkbook(fixture('=INDIRECT(LEFT(D1,2))'), context, true);
  const second = recalculateWorkbook(dirtyWorkbook(replaceInput(first, 0, 3, s("invalid")), [coordinate(0, 3)], context), context);
  expect(second.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "error", value: "#REF!" });
  expect(second.dependencies?.some(dependency => dependency.dynamic && dependency.precedent.startColumn === 0)).toBe(false);
  expect(dirtyWorkbook(second, [coordinate(0, 0)], context).sheets[0]!.cells[0]!.formulaDirty).toBe(false);
  expect(recalculateWorkbook(second, context)).toEqual(second);
});

it("keeps a named expression for a direct cell scalar while INDIRECT returns its array reference", () => {
  const book: Workbook = { names: [{ name: "target_text", expression: "=Sheet!$D$1" }, { name: "target_alias", expression: "=target_text" }],
    sheets: [{ id: "s", name: "Sheet", cells: [
      { row: 0, column: 0, value: n(1) }, { row: 1, column: 0, value: n(2) },
      { row: 0, column: 3, value: s("A1:A2") }
    ], formulaGroups: [{ id: "g", kind: "array", expression: '=INDIRECT(target_alias)', range: { startRow: 0, endRow: 1, startColumn: 5, endColumn: 5 } }] }] };
  const first = recalculateWorkbook(book, context, true);
  expect(first.sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.cachedResult)).toEqual([n(1), n(2)]);
  expect(dirtyWorkbook(first, [coordinate(1, 0)], context).sheets[0]!.cells.filter(cell => cell.column === 5).map(cell => cell.formulaDirty)).toEqual([true, true]);
});

it("tracks circular INDIRECT targets while preserving current-cache recursion and replay", () => {
  const book: Workbook = { sheets: [{ id: "s", name: "Sheet", cells: [
    { row: 0, column: 0, formula: '=INDIRECT("B1")', value: n(5), cachedResult: n(5), formulaDirty: true },
    { row: 0, column: 1, formula: '=INDIRECT("A1")', value: n(7), cachedResult: n(7), formulaDirty: true }
  ] }] };
  const first = recalculateWorkbook(book, context);
  expect(first.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([n(5), n(5)]);
  expect(first.dependencies?.filter(dependency => dependency.dynamic)).toHaveLength(2);
  expect(recalculateWorkbook(first, context)).toEqual(first);
  expect(dirtyWorkbook(first, [coordinate(0, 0)], context).sheets[0]!.cells.map(cell => cell.formulaDirty)).toEqual([true, true]);
  expect(book.sheets[0]!.cells.map(cell => cell.cachedResult)).toEqual([n(5), n(7)]);
});
