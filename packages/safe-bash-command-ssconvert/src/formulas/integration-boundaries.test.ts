import { expect, it } from "vitest";
import { parseExpression } from "./parser.js";
import { parseFormula } from "../workbook/updates/formula.js";
import { setCellText } from "../workbook/updates/index.js";
import { renameWorkbookSheet, moveWorkbookSheet, resizeWorkbookReferences } from "./workbook.js";
import type { Workbook } from "../workbook.js";

const book: Workbook = { sheets: [{ id: 's', name: 'Small', size: { rows: 128, columns: 128 }, cells: [] }] };
const context = { signal: new AbortController().signal, limits: { cells: 10, sheets: 3, inputBytes: 1000, outputBytes: 1000, operations: 10 }, environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
it('validates public workbook data before any accessor can execute', () => {
  let calls = 0;
  const hostile = Object.defineProperty({}, 'sheets', { get() { calls++; return book.sheets; } }) as Workbook;
  for (const run of [() => renameWorkbookSheet(hostile, 's', 'Next', context), () => moveWorkbookSheet(hostile, 's', 0, context),
    () => resizeWorkbookReferences(hostile, 's', { rows: 128, columns: 128 }, context)]) {
    expect(run).toThrow('accessor');
    expect(calls).toBe(0);
  }
});
it('rewrites references in retained detached sheets during a rename', () => {
  const original: Workbook = { ...book, detachedSheets: [{ id: 'd', name: 'Detached', cells: [
    { row: 0, column: 0, value: { kind: 'blank' }, formula: '=Small!A1' }
  ] }] };
  expect(renameWorkbookSheet(original, 's', 'Next', context).detachedSheets![0]!.cells[0]!.formula).toBe("='Next'!A1");
});
it('keeps qualified names in their own native sheet namespace', () => {
  const original: Workbook = { sheets: [{ ...book.sheets[0]!, cells: [] }, { id: 'other', name: 'Other', cells: [] }] };
  const range = { sheet: 's', startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
  const updated = setCellText(original, range, '=Other!Unknown', context);
  expect(updated.names).toEqual([{ name: 'Unknown', sheet: 'other', expression: '#NAME?' }]);
  const invalid = setCellText(original, range, '=Missing!Unreached', context);
  expect(invalid.names).toBeUndefined();
  expect(invalid.sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value: '=Missing!Unreached' });
});
it.each(['=SUM(1', '=SUM(', '="x', '=1+'])('keeps error spans inside the original formula: %s', source => {
  const result = parseExpression(source, { position: { sheet: 's', row: 0, column: 0 } });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostic.start).toBeLessThanOrEqual(result.diagnostic.end);
    expect(result.diagnostic.end).toBeLessThanOrEqual(source.length);
  }
});
it.each(['=A129', '=$A$129', '=DY1'])('rejects coordinates beyond the native sheet parse bounds: %s', formula => {
  expect(parseFormula(formula, book, 's')).toBeUndefined();
});
it('retains removed-row caches while clipping reversed and qualified ranges independently', () => {
  const cache = { kind: 'number' as const, value: 9 };
  const original: Workbook = { sheets: [{ ...book.sheets[0]!, size: { rows: 256, columns: 128 }, cells: [
    { row: 0, column: 0, value: cache, cachedResult: cache, formula: '=F(Small!A140:A120,Small!A140)' }
  ] }] };
  expect(resizeWorkbookReferences(original, 's', { rows: 128, columns: 128 }, context).sheets[0]!.cells[0])
    .toMatchObject({ formula: "=F('Small'!A128:A120,#REF!)", cachedResult: cache });
});
