import { expect, it } from 'vitest';
import { createEngine, defaultSsconvertLimits } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { Binary } from './biff-binary.js';
import { biffNode } from './biff-metadata.js';
import { createBiffWriter, readBiff } from './biff.js';

it.each([7, 8] as const)('reads BIFF%i catalogs without resident font/XF/format collections', async revision => {
  const context = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const cells = Array.from({ length: 180 }, (_, row) => ({ row, column: 0,
    value: { kind: 'string' as const, value: `row ${row}` }, format: `0.00"catalog${row}"`,
    style: { gnumeric: biffNode('Style', {}, '', [biffNode('Font', { Unit: 10 + row / 20 }, `Font ${row}`)]) }
  }));
  const bytes = await createBiffWriter(revision)({ sheets: [{ id: 's', name: 'Data', cells,
    columns: [{ index: 1, sizePoints: 40 }] }] }, [], context);
  const expected = await readBiff(bytes, context), fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{
    id: 'fixture', description: 'fixture', extensions: [], async readSource(input, context) { return readBiff(input, context); }
  }] });
  const push = Array.prototype.push, set = Map.prototype.set;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item && typeof item === 'object' && (
      'data' in item && item.data instanceof Binary && 'revision' in item ||
      'name' in item && 'color' in item && 'codepage' in item && 'attributes' in item))) throw new Error('resident BIFF catalog array');
    return push.apply(this, items);
  };
  Map.prototype.set = function(key: unknown, value: unknown) {
    if (typeof key === 'number' && typeof value === 'string' && value.includes('catalog')) throw new Error('resident BIFF format map');
    return set.call(this, key, value);
  };
  try {
    const actual = await engine.readWorkbook({ kind: 'range', source: { size: bytes.length,
      async read(at, count) { return bytes.subarray(at, at + Math.min(count, 257)); }
    } }, { importType: 'fixture' }, { signal: context.signal });
    expect(actual).toEqual(expected);
  } finally { Array.prototype.push = push; Map.prototype.set = set; await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});
