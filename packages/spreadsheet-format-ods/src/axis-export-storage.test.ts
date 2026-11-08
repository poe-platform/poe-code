import { expect, it } from 'vitest';
import type { AxisMetadata, Workbook } from '@poe-code/spreadsheet-ast';
import { defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createOdfStreamWriter } from './odf.js';

it.each(['strict', 'extended'] as const)('exports %s source axes without resident collections', async edition => {
  const axes: AxisMetadata[] = Array.from({ length: 300 }, (_, i) => ({ index: 299 - i, sizePoints: 17 + i % 3,
    hidden: i % 7 === 0, collapsed: i % 11 === 0, outlineLevel: i % 4 }));
  axes[0] = { ...axes[0]!, style: { unused: 'unused axis style'.repeat(4096) } };
  const book: Workbook = { sheets: [{ id: 's', name: 'Data', size: { rows: 512, columns: 512 }, rows: axes, columns: axes,
    merges: [{ startRow: 310, endRow: 312, startColumn: 0, endColumn: 1 }],
    cells: [{ row: 0, column: 0, value: { kind: 'number', value: 42 } }, { row: 311, column: 2, value: { kind: 'string', value: 'hello' } }] },
    { id: 't', name: 'Second', size: { rows: 128, columns: 128 }, cells: [], rows: [{ index: 7, sizePoints: 22 }, { index: 0, hidden: true }], columns: [{ index: 5, sizePoints: 44 }] }] };
  const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, rows: [], columns: [], cells: [] })) },
    async *cells(id: string) { yield* book.sheets.find(sheet => sheet.id === id)!.cells; }, async *axes(id: string, kind: 'rows' | 'columns') { yield* book.sheets.find(sheet => sheet.id === id)![kind]!; } };
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const writer = createOdfStreamWriter(edition);
  async function collect(input: Workbook | typeof source, ctx: CapabilityContext) {
    const stream = "metadata" in input ? writer(input, [], ctx) : writer(input, [], ctx);
    const chunks = []; for await (const chunk of stream) chunks.push(chunk.slice()); return Buffer.concat(chunks);
  }
  const expected = await collect(book, context);
  const backing = new Uint8Array(4 * 1024 * 1024), borrowed = new Uint8Array(16384);
  let end = 8, closed = 0, reads = 0;
  const push = Array.prototype.push, set = Map.prototype.set;
  const isAxis = (value: unknown) => value !== null && typeof value === 'object' && 'index' in value && 'sizePoints' in value;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(isAxis)) throw new Error('resident export axes'); return push.apply(this, items);
  };
  Map.prototype.set = function(key: unknown, value: unknown) {
    if (isAxis(value)) throw new Error('resident axis map'); return set.call(this, key, value);
  };
  try {
    const actual = await collect(source, { ...context, createWorkingStorage() { return {
      // XML tape allocations include a 16-byte chain header.
      allocate(length) { expect(length).toBeLessThanOrEqual(16384 + 16); const position = end; end += length; expect(end).toBeLessThanOrEqual(backing.length); return position; },
      async read(position, length) { reads++; expect(length).toBeLessThanOrEqual(16384); borrowed.set(backing.subarray(position, position + length)); return borrowed.subarray(0, length); },
      async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); backing.set(bytes, position); },
      async close() { closed++; }
    }; } });
    expect(actual).toEqual(expected); expect(reads).toBeGreaterThan(0); expect(closed).toBeGreaterThan(0);
  } finally { Array.prototype.push = push; Map.prototype.set = set; }
});

it.each([false, true])('preserves direct workbook first-row metadata and duplicate-column rejection (backed: %s)', async backed => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  if (backed) Object.assign(context, { createWorkingStorage() {
    const bytes = new Uint8Array(1024 * 1024); let end = 8;
    return { allocate(length: number) { const start = end; end += length; expect(end).toBeLessThanOrEqual(bytes.length); return start; },
      async read(position: number, count: number) { return bytes.subarray(position, position + count); },
      async write(position: number, chunk: Uint8Array) { bytes.set(chunk, position); }, async close() {} };
  } });
  const first = { index: 3, sizePoints: 17, hidden: true }, second = { index: 3, sizePoints: 42 };
  const writer = createOdfStreamWriter('strict');
  async function bytes(rows: AxisMetadata[], columns: AxisMetadata[] = []) {
    const chunks = []; for await (const chunk of writer({ sheets: [{ id: 's', name: 'Data', rows, columns, cells: [] }] }, [], context)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  expect(await bytes([first, second])).toEqual(await bytes([first]));
  await expect(bytes([], [first, second])).rejects.toThrow('Duplicate OpenDocument column metadata');
});
