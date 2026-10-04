import { expect, it } from 'vitest';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import type { NamedExpression, Workbook } from '../workbook.js';
import { rejectGnumericNameCycles } from './gnumeric-name-cycles.js';

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: 'C', timezone: 'UTC' } };
const names: NamedExpression[] = Array.from({ length: 160 }, (_, i) => ({ name: 'Rate_' + i, expression: i ? `Rate_${i - 1}+Rate_${i - 1}` : 'Rate_159', position: { sheet: 's', row: 0, column: 0 } }));
const book: Workbook = { sheets: [{ id: 's', name: 'Data', cells: [] }], names };

it.each(['edges', 'visited'])('stages name-cycle %s while preserving native rejection order and work accounting', async mode => {
  let expectedTicks = 0, actualTicks = 0;
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await rejectGnumericNameCycles(book, names, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } }, () => { expectedTicks++; });
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_range, ctx) {
    const set = Map.prototype.set, add = Set.prototype.add;
    Map.prototype.set = function(key: unknown, value: unknown) {
      if (mode === 'edges' && typeof key === 'number' && Array.isArray(value)) throw Error('resident name dependencies');
      return set.call(this, key, value);
    };
    Set.prototype.add = function(value: unknown) { if (mode === 'visited' && typeof value === 'number') throw Error('resident name traversal'); return add.call(this, value); };
    let result;
    try { result = await rejectGnumericNameCycles(book, names, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } }, () => { actualTicks++; }); }
    finally { Map.prototype.set = set; Set.prototype.add = add; }
    expect(result).toEqual(expected); return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualTicks).toBe(expectedTicks); expect(actualDiagnostics).toEqual(expectedDiagnostics); expect(await fs.readdir('/')).toEqual([]);
});

it('keeps dependency order, visit epochs and reusable stack slots independent with borrowed storage', async () => {
  const { createGnumericNameGraph } = await import('./gnumeric-name-graph.js');
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), payloads: Uint8Array[] = [];
  let saved: ReturnType<typeof createGnumericNameGraph> | undefined, pending = 0, reads = 0, writes = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_range, ctx) {
    const graph = saved = createGnumericNameGraph({ ...ctx, createWorkingStorage() {
      const store = ctx.createWorkingStorage!();
      return { ...store, async read(position, count) { expect(++pending).toBe(1); reads++; expect(count).toBeLessThanOrEqual(16384);
        try { const bytes = await store.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; } },
        async write(position, bytes) { expect(++pending).toBe(1); writes++; expect(bytes.length).toBeLessThanOrEqual(16384); if (bytes.length === 16) payloads.push(bytes);
          try { await Promise.resolve(); await store.write(position, bytes); } finally { pending--; } }
      };
    } });
    const list = graph.list();
    for (let i = 0; i < 300; i++) { await list.append(i); await graph.push(i); expect(await graph.seen(i, 1)).toBe(false); await graph.reject(i); }
    await graph.accept(0, list.head); await graph.accept(1, 0);
    let at = 0; for await (const target of graph.dependencies(0)) expect(target).toBe(at++); expect(at).toBe(300);
    for await (const unused of graph.dependencies(1)) expect.unreachable(String(unused));
    for (let i = 299; i >= 0; i--) {
      expect(await graph.pop()).toBe(i); expect(await graph.seen(i, 1)).toBe(true); expect(await graph.seen(i, 2)).toBe(false); expect(await graph.rejected(i)).toBe(true);
    }
    expect(await graph.pop()).toBeUndefined(); expect(await graph.rejected(999)).toBe(false);
    await graph.push(999); graph.reset(); expect(await graph.pop()).toBeUndefined();
    const replacement = graph.list(); await replacement.append(42); await graph.accept(0, replacement.head);
    const targets = []; for await (const target of graph.dependencies(0)) targets.push(target); expect(targets).toEqual([42]);
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.pop()).rejects.toThrow('closed'); await expect(saved!.rejected(0)).rejects.toThrow('closed');
  expect(payloads.every(bytes => bytes.every(value => value === 0))).toBe(true);
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['write', 'read', 'cancel', 'read-close'])('cleans name dependencies after %s failure', async mode => {
  const { createGnumericNameGraph } = await import('./gnumeric-name-graph.js');
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('graph backing'), closeFailure = new Error('graph close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const graph = createGnumericNameGraph({ ...ctx, createWorkingStorage() {
      const store = ctx.createWorkingStorage!();
      return { ...store, async read(position, count) { if (fail && mode.startsWith('read')) throw failure;
        const bytes = await store.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes; },
        async write(position, bytes) { if (mode === 'write') throw failure; await store.write(position, bytes); },
        async close() { await store.close(); if (mode === 'read-close') throw closeFailure; }
      };
    } });
    const list = graph.list(); await list.append(1); await graph.accept(0, list.head); fail = true;
    for await (const target of graph.dependencies(0)) expect(target).toBe(1); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});

it('preserves same-spelling rejection across scopes and repeated declaration identity', async () => {
  const global: NamedExpression = { name: 'Rate', expression: 'Data!Rate' }, local: NamedExpression = { name: 'Rate', expression: '7', sheet: 's' };
  const input: Workbook = { sheets: [{ id: 's', name: 'Data', cells: [] }], names: [global, local, global] }, declarations = [global, local, global];
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await rejectGnumericNameCycles(input, declarations, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } }, () => {});
  expect(expected[0]!.expression).toBe('Data!Rate'); expect(expected[2]!.expression).toBe('');
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_range, ctx) {
    const actual = await rejectGnumericNameCycles(input, declarations, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } }, () => {});
    expect(actual).toEqual(expected); return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics); expect(await fs.readdir('/')).toEqual([]);
});
