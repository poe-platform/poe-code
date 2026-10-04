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

it.each(['bindings', 'rejections', 'shared', 'axes'])('stages formula-bearing Gnumeric %s with workbook and diagnostic parity', async mode => {
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await readGnumeric(document, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } });
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
    const set = Map.prototype.set;
    Map.prototype.set = function(key: unknown, value: unknown) {
      if (typeof key === 'number' && typeof value === 'string' && (mode === 'bindings' && value.startsWith('=') || mode === 'rejections' && value.includes('does not exist'))) throw Error('resident formula binding');
      if (value && typeof value === 'object' && (mode === 'shared' && 'formula' in value && 'sheet' in value && 'row' in value || mode === 'axes' && 'sizePoints' in value && 'index' in value)) throw Error('resident formula state');
      return set.call(this, key, value);
    };
    let result;
    try { result = await readGnumeric(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } }); }
    finally { Map.prototype.set = set; }
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
    for (let index = 0; index < 300; index++) { await values.formulas.set(index, '=Rate+' + index); await values.rejections.set(index, 'rejected ' + index); }
    for (let index = 299; index >= 0; index--) {
      expect(await values.formulas.get(index)).toBe('=Rate+' + index); expect(await values.rejections.get(index)).toBe('rejected ' + index);
    }
    for (const [index, id] of ids.entries()) {
      const first = await values.shared.get(id); expect(first).toEqual({ formula: '=A1+' + index, row: index, column: 0, sheet: 'Data', arrayStringLiterals: true });
      first!.formula = '=mutated'; expect((await values.shared.get(id))!.formula).toBe('=A1+' + index);
    }
    expect(await values.shared.get('missing')).toBeUndefined(); expect(await values.formulas.get(999)).toBeUndefined();
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.shared.get('1')).rejects.toThrow('closed'); await expect(saved!.formulas.get(0)).rejects.toThrow('closed');
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['write', 'read', 'cancel', 'read-close'])('retires formula storage after %s failure', async mode => {
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
    await values.shared.set('shared', { formula: '=A1', row: 0, column: 0, sheet: 'Data' }); fail = true;
    await values.shared.get('shared'); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});
