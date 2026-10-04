import { expect, it } from 'vitest';
import { createEngine } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { ZipStorageFailure } from '@poe-code/office-package';
import { createWorksheetIndexes } from './worksheet-indexes.js';

it('bounds shared worksheet indexes across sheets, replacements and borrowed I/O', async () => {
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), scratch: Uint8Array[] = [];
  let saved: ReturnType<ReturnType<typeof createWorksheetIndexes>['sheet']> | undefined, reads = 0, writes = 0, pending = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    const indexes = createWorksheetIndexes({ ...ctx, createWorkingStorage() {
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) {
        expect(++pending).toBe(1); expect(count).toBeLessThanOrEqual(16384); reads++;
        try { const bytes = await backing.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; }
      }, async write(position, bytes) {
        expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); writes++;
        if (bytes.buffer.byteLength === 16384) scratch.push(bytes);
        try { await Promise.resolve(); await backing.write(position, bytes); } finally { pending--; }
      } };
    } });
    const first = saved = indexes.sheet(), second = indexes.sheet();
    const ids = ['1', '01', '__proto__', 'é', 'é', '😀'.repeat(40000)];
    for (let i = 0; i < 300; i++) {
      await first.cells.set(i * 16384, i); await second.cells.set(i * 16384, 299 - i);
      await first.shared.set('shared-' + i, { expression: '=A1+' + i, row: i, column: 0 });
    }
    for (const [i, id] of ids.entries()) await first.shared.set(id, { expression: '=A1', row: i, column: 0, arrayStringLiterals: true });
    await first.shared.set('1', { expression: '=B2', row: 1, column: 1 });
    await first.cells.set(0, 999);
    for (let i = 299; i >= 0; i--) {
      expect(await first.cells.get(i * 16384)).toBe(i === 0 ? 999 : i);
      expect(await second.cells.get(i * 16384)).toBe(299 - i);
      expect(await first.shared.get('shared-' + i)).toEqual({ expression: '=A1+' + i, row: i, column: 0 });
    }
    for (const [i, id] of ids.entries()) {
      expect(await first.shared.get(id)).toEqual(i === 0 ? { expression: '=B2', row: 1, column: 1 } : { expression: '=A1', row: i, column: 0, arrayStringLiterals: true });
      expect(await second.shared.get(id)).toBeUndefined();
    }
    const value = await first.shared.get('1'); value!.expression = '=mutated';
    const [again, missing] = await Promise.all([first.shared.get('1'), first.cells.get(999999)]);
    expect(again!.expression).toBe('=B2'); expect(missing).toBeUndefined();
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: new AbortController().signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.cells.get(0)).rejects.toMatchObject({ cause: { message: 'XLSX record storage is closed' } }); await expect(saved!.shared.get('1')).rejects.toMatchObject({ cause: { message: 'XLSX record storage is closed' } });
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(scratch.length).toBeGreaterThan(0);
  expect(scratch.every(bytes => bytes.every(value => value === 0))).toBe(true); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['acquire', 'write', 'read', 'cancel', 'read-close'])('retires worksheet indexes after %s failure', async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = Error('index backing'), closeFailure = Error('index close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const sheet = createWorksheetIndexes({ ...ctx, createWorkingStorage() {
      if (mode === 'acquire') throw failure;
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) {
        if (fail && mode.startsWith('read')) throw failure;
        const bytes = await backing.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes;
      }, async write(position, bytes) { if (mode === 'write') throw failure; await backing.write(position, bytes); },
      async close() { await backing.close(); if (mode === 'read-close') throw closeFailure; } };
    } }).sheet();
    await sheet.shared.set('id', { expression: '=A1', row: 0, column: 0 }); fail = true;
    await sheet.shared.get('id'); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; } finally { await engine.dispose(); }
  const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : error instanceof ZipStorageFailure ? leaves(error.cause) : [error];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});
