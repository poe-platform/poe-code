import { expect, it } from 'vitest';
import { parseExpression } from './parser.js';
const position = { sheet: 'S', row: 0, column: 0 };
it('parses formulas beyond the former depth ceiling by default', () => {
  expect(parseExpression('='.concat('('.repeat(129), '1', ')'.repeat(129)), { position }).ok).toBe(true);
});
it('enforces explicit formula depth', () => {
  expect(() => parseExpression('=((1))', { position, maximumDepth: 1 })).toThrow('depth limit');
});

import type { CapabilityContext, RuntimeLimits } from '../contracts.js';
import type { Workbook, ImportedValue } from '../workbook.js';
import { snapshotRecords } from '../workbook/model.js';
import { defaultSsconvertLimits } from '../engine.js';
import { recalculateWorkbook } from './evaluator.js';
import { sheetObjects } from '../objects/index.js';
import { createVfsOutput } from '../io/publication.js';
const context = (limits: Partial<RuntimeLimits> = {}): CapabilityContext => ({
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' },
  limits: { ...defaultSsconvertLimits, ...limits },
});
it('calculates dependency chains above the old depth and enforces host dependency ceilings', () => {
  const cells = Array.from({ length: 130 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: 1 },
    ...(row < 129 ? { formula: `=A${row + 2}` } : {}) }));
  const book: Workbook = { sheets: [{ id: 'S', name: 'S', cells }] };
  expect(recalculateWorkbook(book, context(), true).sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 1 });
  expect(() => recalculateWorkbook(book, context({ formulaDependencyDepth: 2 }), true)).toThrow('depth limit');
});
it('projects and owns deeply nested objects with independently configured ceilings', () => {
  const node = (name: string, children: ImportedValue[] = []): ImportedValue => ({ name, namespace: 'g', text: '', attributes: [], children });
  let child = node('leaf');
  for (let depth = 0; depth < 130; depth++) child = node('nested', [child]);
  const sheet = { id: 'S', name: 'S', cells: [], unsupportedRecords: [{ source: 'Gnumeric_XmlIO:sax', kind: 'Objects', disposition: 'retained' as const,
    data: node('Objects', [node('SheetObjectFilled', [child])]) }] };
  expect(sheetObjects(sheet, context())).toHaveLength(1);
  expect(() => sheetObjects(sheet, context({ objectDepth: 128 }))).toThrow('object depth limit');
  expect(snapshotRecords(child, context().limits)).toEqual(child);
  expect(() => snapshotRecords(child, context({ workbookDepth: 128 }).limits)).toThrow('workbook depth limit');
});
it('follows more than forty output aliases and rejects configured ceilings and cycles', async () => {
  let cycle = false;
  const open = createVfsOutput({
    capabilities: { exclusiveCreate: true, atomicRename: true, permissions: true },
    async lstat(path) { return { type: path === '/41' ? 'file' : 'symlink', mode: 0o666 }; },
    async readlink(path) { return cycle ? '/0' : '/' + (Number(path.slice(1)) + 1); },
    async access() {}, async writeFile() {}, async rename() {}, async unlink() {}, async chmod() {},
  }, async () => {});
  const output = await open('/0', context());
  await output.close();
  await expect(open('/0', context({ outputSymlinks: 40 }))).rejects.toThrow('symlink limit');
  cycle = true;
  await expect(open('/0', context())).rejects.toThrow('Symlink cycle');
});
