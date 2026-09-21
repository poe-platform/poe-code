import { expect, it } from "vitest";
import { renameWorkbookSheet, moveWorkbookSheet, resizeWorkbookReferences, translateFormulaGroup } from "./workbook.js";
import { mergeWorkbookSheets } from "../workbook/merge.js";
import type { Workbook } from "../workbook.js";
import type { CapabilityContext } from "../contracts.js";

const limits = { sheets: 5, cells: 50, operations: 50, inputBytes: 10000, outputBytes: 10000 };
const context = (): CapabilityContext => ({ limits, signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
const cache = { kind: "number" as const, value: 123 };
const book: Workbook = { activeSheet: "s", calculationMode: "manual", names: [{ name: "Input", expression: "=First!A1", position: { sheet: "s", row: 0, column: 0 } }], sheets: [
  { id: "s", name: "First", size: { rows: 128, columns: 128 }, cells: [{ row: 0, column: 0, formula: '=Unknown(First!B2,"First!B2")', value: cache, cachedResult: cache }],
    formulaGroups: [{ id: "shared", kind: "shared", range: { startRow: 2, startColumn: 2, endRow: 3, endColumn: 3 }, expression: "=First!A1" }] },
  { id: "t", name: "Last", size: { rows: 128, columns: 128 }, cells: [] }
] };

it("renames cells, names and formula groups while retaining original caches", () => {
  const result = renameWorkbookSheet(book, 's', 'New name', context());
  expect(result.sheets[0]!.name).toBe('New name');
  expect(result.sheets[0]!.cells[0]).toMatchObject({ formula: '=Unknown(\'New name\'!B2,"First!B2")', cachedResult: cache, value: cache });
  expect(result.names![0]!.expression).toBe("='New name'!A1");
  expect(result.sheets[0]!.formulaGroups![0]!.expression).toBe("='New name'!A1");
  expect(book.sheets[0]!.name).toBe('First');
});

it("moves sheets by stable identity, preserving span endpoints and caches", () => {
  const result = moveWorkbookSheet(book, 's', 1, context());
  expect(result.sheets.map(s => s.id)).toEqual(['t', 's']);
  expect(result.activeSheet).toBe('s');
  expect(result.sheets[1]!.cells).toEqual(book.sheets[0]!.cells);
});

it("shrinks references, clips ranges and retains whole-axis notation", () => {
  const original: Workbook = { sheets: [{ id: 's', name: 'First', size: { rows: 256, columns: 256 }, cells: [
    { row: 0, column: 0, value: cache, cachedResult: cache, formula: '=SUM(A120:A140,A140,A:A)' }
  ] }] };
  const result = resizeWorkbookReferences(original, 's', { rows: 128, columns: 128 }, context());
  expect(result.sheets[0]!.cells[0]).toMatchObject({ formula: '=SUM(A120:A128,#REF!,A:A)', cachedResult: cache });
});

it("translates shared expressions from their anchor and keeps array expressions anchored", () => {
  const group = book.sheets[0]!.formulaGroups![0]!;
  expect(translateFormulaGroup(group, { sheet: 's', row: 3, column: 3 }, context())).toBe("='First'!B2");
  expect(translateFormulaGroup({ ...group, kind: 'array' }, { sheet: 's', row: 3, column: 3 }, context())).toBe(group.expression);
});

it("merges local formula references across sheet name and id collisions", () => {
  const incoming: Workbook = { sheets: [{ id: 's', name: 'First', cells: [{ row: 0, column: 0, value: cache, cachedResult: cache, formula: '=Future(First!A2)' }] }] };
  const result = mergeWorkbookSheets({ sheets: [book.sheets[0]!] }, incoming, limits);
  expect(result.sheets[1]).toMatchObject({ id: 's(1)', name: 'First(2)', cells: [{ formula: "=Future('First(2)'!A2)", cachedResult: cache }] });
});

it("fails explicitly on malformed formulas needing a rename without deleting input", () => {
  const original: Workbook = { sheets: [{ id: 's', name: 'First', cells: [{ row: 0, column: 0, value: cache, formula: '=First!A1+' }] }] };
  expect(() => renameWorkbookSheet(original, 's', 'Next', context())).toThrow('formula syntax');
  expect(original.sheets[0]!.cells[0]!.formula).toBe('=First!A1+');
});
