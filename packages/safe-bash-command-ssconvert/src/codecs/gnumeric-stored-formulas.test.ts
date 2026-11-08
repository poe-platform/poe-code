import { expect, it } from 'vitest';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { readGnumeric } from './gnumeric.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: 'C', timezone: 'UTC' } };
const name = '<g:Names><g:Name><g:name>Rate</g:name><g:value>11</g:value></g:Name></g:Names>';
const document = new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd">' + name + '<g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells>' +
  Array.from({ length: 160 }, (_, i) => `<g:Cell Row="${i * 3}" Col="0" ExprID="é-${i}">=Rate+A1</g:Cell><g:Cell Row="${i * 3 + 1}" Col="0" ExprID="é-${i}"/><g:Cell Row="${i * 3 + 2}" Col="0">=[]Missing</g:Cell>`).join('') +
  '<g:Cell Row="900" Col="0" ExprID="é-0">=999</g:Cell><g:Cell Row="901" Col="0" ExprID="é-0"/></g:Cells>' + name + '</g:Sheet><g:Sheet><g:Name>Second</g:Name><g:Cells><g:Cell Row="0" Col="0" ExprID="é-0"/></g:Cells></g:Sheet></g:Sheets></g:Workbook>');

it.each(['bindings', 'rejections', 'shared', 'axes', 'names'])('stages formula-bearing Gnumeric %s with workbook and diagnostic parity', async mode => {
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await readGnumeric(document, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } });
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
    const set = Map.prototype.set, add = Set.prototype.add;
    Set.prototype.add = function(value: unknown) { if (mode === 'names' && value === 'Rate') throw Error('resident name visibility'); return add.call(this, value); };
    Map.prototype.set = function(key: unknown, value: unknown) {
      if (typeof key === 'number' && typeof value === 'string' && (mode === 'bindings' && value.startsWith('=') || mode === 'rejections' && value.includes('does not exist'))) throw Error('resident formula binding');
      if (value && typeof value === 'object' && (mode === 'shared' && 'formula' in value && 'sheet' in value && 'row' in value || mode === 'axes' && 'sizePoints' in value && 'index' in value)) throw Error('resident formula state');
      return set.call(this, key, value);
    };
    let result;
    try { result = await readGnumeric(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } }); }
    finally { Map.prototype.set = set; Set.prototype.add = add; }
    expect(result).toEqual(expected); return result;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: document.length, async read(position, count) {
    const take = Math.min(count, 257, document.length - position); borrowed.set(document.subarray(position, position + take)); return borrowed.subarray(0, take);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics);
  expect(await fs.readdir('/')).toEqual([]);
});

it('preserves distinct shared-expression IDs, first definitions and owned replay with borrowed backing buffers', async () => {
  const { createGnumericValueStorage } = await import('./gnumeric-value-storage.js');
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384);
  let pending = 0, reads = 0, writes = 0, saved: ReturnType<typeof createGnumericValueStorage> | undefined;
  const ids = ['1', '01', '__proto__', 'é', 'é', '😀'.repeat(5000)];
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_source, ctx) {
    const values = saved = createGnumericValueStorage({ ...ctx, createWorkingStorage() {
      const store = ctx.createWorkingStorage!();
      return { ...store, async read(position, count) { expect(++pending).toBe(1); reads++; expect(count).toBeLessThanOrEqual(16384);
        try { const bytes = await store.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; } },
        async write(position, bytes) { expect(++pending).toBe(1); writes++; expect(bytes.length).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); await store.write(position, bytes); } finally { pending--; } }
      };
    } });
    for (const [index, id] of ids.entries()) await values.shared.set(id, { formula: '=A1+' + index, row: index, column: 0, sheet: 'Data', arrayStringLiterals: true });
    for (let index = 0; index < 300; index++) { await values.formulas.set(index, '=Rate+' + index); await values.rejections.set(index, 'rejected ' + index); await values.names.set('scope:' + index, index); }
    for (let index = 299; index >= 0; index--) {
      expect(await values.formulas.get(index)).toBe('=Rate+' + index); expect(await values.rejections.get(index)).toBe('rejected ' + index); expect(await values.names.get('scope:' + index)).toBe(index);
    }
    for (const [index, id] of ids.entries()) {
      const first = await values.shared.get(id); expect(first).toEqual({ formula: '=A1+' + index, row: index, column: 0, sheet: 'Data', arrayStringLiterals: true });
      first!.formula = '=mutated'; expect((await values.shared.get(id))!.formula).toBe('=A1+' + index);
    }
    for (const [index, id] of ids.entries()) await values.names.set(id, index);
    for (const [index, id] of ids.entries()) expect(await values.names.get(id)).toBe(index);
    expect(await values.names.get('missing')).toBeUndefined();
    expect(await values.shared.get('missing')).toBeUndefined(); expect(await values.formulas.get(999)).toBeUndefined();
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.names.get('1')).rejects.toThrow('closed'); await expect(saved!.shared.get('1')).rejects.toThrow('closed'); await expect(saved!.formulas.get(0)).rejects.toThrow('closed');
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['write', 'read', 'cancel', 'read-close'].flatMap(mode => [false, true].map(names => ({ mode, names }))))('retires formula storage after $mode failure (name index: $names)', async ({ mode, names }) => {
  const { createGnumericValueStorage } = await import('./gnumeric-value-storage.js');
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('formula backing'), closeFailure = new Error('formula close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const values = createGnumericValueStorage({ ...ctx, createWorkingStorage() {
      const store = ctx.createWorkingStorage!();
      return { ...store, async read(position, count) { if (fail && mode.startsWith('read')) throw failure;
        const bytes = await store.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes; },
        async write(position, bytes) { if (mode === 'write') throw failure; await store.write(position, bytes); },
        async close() { await store.close(); if (mode === 'read-close') throw closeFailure; }
      };
    } });
    if (names) await values.names.set('shared', 1); else await values.shared.set('shared', { formula: '=A1', row: 0, column: 0, sheet: 'Data' }); fail = true;
    if (names) await values.names.get('shared'); else await values.shared.get('shared'); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});

it('binds many distinct global, local and future declarations through bounded visibility storage', async () => {
  const declaration = (name: string, value: string) => `<g:Name><g:name>${name}</g:name><g:value>${value}</g:value></g:Name>`;
  const declarations = Array.from({ length: 160 }, (_, i) => declaration('Rate_' + i, '11')).join('');
  const cells = Array.from({ length: 160 }, (_, i) => `<g:Cell Row="${i}" Col="0">=Rate_${i}+Missing_${i}+Data!Local_${i}</g:Cell>`).join('');
  const bytes = new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Names>' + declarations + '</g:Names><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells>' + cells + '</g:Cells><g:Names>' + declarations + '</g:Names></g:Sheet></g:Sheets></g:Workbook>');
  const expected = await readGnumeric(bytes, context);
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
    const add = Set.prototype.add, set = Map.prototype.set;
    Set.prototype.add = function(value: unknown) { if (typeof value === 'string' && value.startsWith('Rate_')) throw Error('resident names'); return add.call(this, value); };
    Map.prototype.set = function(key: unknown, value: unknown) { if (typeof key === 'string' && key.startsWith('["future-')) throw Error('resident future scope'); return set.call(this, key, value); };
    try { expect(await readGnumeric(source, ctx)).toEqual(expected); } finally { Set.prototype.add = add; Map.prototype.set = set; }
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) {
    const take = Math.min(count, borrowed.length, bytes.length - position); borrowed.set(bytes.subarray(position, position + take)); return borrowed.subarray(0, take);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});
