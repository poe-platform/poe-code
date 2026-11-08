import { expect, it } from 'vitest';
import type { AxisMetadata, Workbook } from '@poe-code/spreadsheet-ast';
import { defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createXlsxStreamWriter } from './xlsx.js';

it.each(['2006', '2008'] as const)('exports %s source axes without resident collections', async edition => {
  const axes: AxisMetadata[] = Array.from({ length: 300 }, (_, i) => ({ index: 299 - i, sizePoints: 17 + i % 3,
    hidden: i % 7 === 0, collapsed: i % 11 === 0, outlineLevel: i % 4 }));
  const book: Workbook = { sheets: [{ id: 's', name: 'Data', size: { rows: 512, columns: 512 }, rows: axes, columns: axes,
    cells: [{ row: 0, column: 0, value: { kind: 'number', value: 42 } }, { row: 311, column: 2, value: { kind: 'string', value: 'hello' } }] }] };
  const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, rows: [], columns: [], cells: [] })) },
    async *cells() { yield* book.sheets[0]!.cells; }, async *axes(_id: string, kind: 'rows' | 'columns') { yield* book.sheets[0]![kind]!; } };
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const writer = createXlsxStreamWriter(edition);
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
      allocate(length) { const position = end; end += length; expect(end).toBeLessThanOrEqual(backing.length); return position; },
      async read(position, length) { reads++; expect(length).toBeLessThanOrEqual(16384); borrowed.set(backing.subarray(position, position + length)); return borrowed.subarray(0, length); },
      async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); backing.set(bytes, position); },
      async close() { closed++; }
    }; } });
    expect(actual).toEqual(expected); expect(reads).toBeGreaterThan(0); expect(closed).toBeGreaterThan(0);
  } finally { Array.prototype.push = push; Map.prototype.set = set; }
});
