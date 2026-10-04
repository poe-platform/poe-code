import { expect, it } from 'vitest';
import { createEngine } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { ZipStorageFailure } from '@poe-code/office-package';
import { createXlsxCellStorage } from './cell-storage.js';

it('preserves insertion and coordinate order, numeric payloads, updates and ownership with bounded borrowed I/O', async () => {
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), scratch: Uint8Array[] = [];
  let saved: ReturnType<typeof createXlsxCellStorage> | undefined, reads = 0, writes = 0, pending = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    const stored = saved = createXlsxCellStorage({ ...ctx, createWorkingStorage() {
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) {
        expect(++pending).toBe(1); expect(count).toBeLessThanOrEqual(16384); reads++;
        try { const bytes = await backing.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; }
      }, async write(position, bytes) {
        expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); writes++;
        if (bytes.buffer.byteLength === 16384 && bytes.buffer !== borrowed.buffer) scratch.push(bytes);
        try { await Promise.resolve(); await backing.write(position, bytes); } finally { pending--; }
      } };
    } });
    const first = stored.sheet(0), second = stored.sheet(1), specials = [-0, Infinity, -Infinity, NaN];
    for (let i = 0; i < 300; i++) {
      await first.set(i, { row: 299 - i, column: 0, value: { kind: 'number', value: i }, formula: '=A1', cachedResult: { kind: 'number', value: specials[i % 4]! } });
      await second.set(i, { row: i, column: 1, value: { kind: 'string', value: 'é😀'.repeat(i) } });
    }
    for (let i = 0; i < 4; i++) await first.set(i, { row: 299 - i, column: 0, value: { kind: 'number', value: specials[i]! } });
    expect(first.size).toBe(300); expect(await first.get(999)).toBeUndefined();
    for (let i = 299; i >= 0; i--) {
      const cell = await first.get(i); expect(cell!.row).toBe(299 - i);
      expect(cell!.value).toEqual({ kind: 'number', value: i < 4 ? specials[i] : i });
      if (i >= 4) expect(cell!.cachedResult).toEqual({ kind: 'number', value: specials[i % 4] });
    }
    let position = 0; for await (const cell of first.values()) expect(cell.row).toBe(299 - position++);
    expect(position).toBe(300);
    position = 0; for await (const cell of stored.values(0, true)) expect(cell.row).toBe(position++);
    expect(position).toBe(300);
    const original = await second.get(1); (original!.value as { value: string }).value = 'changed';
    expect((await second.get(1))!.value).toEqual({ kind: 'string', value: 'é😀' });
    const left = stored.values(0, true), right = stored.values(1, true);
    const [a, b] = await Promise.all([left.next(), right.next()]); expect(a.value.column).toBe(0); expect(b.value.column).toBe(1);
    await left.return(undefined); await right.return(undefined);
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: new AbortController().signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.values(0).next()).rejects.toThrow('closed');
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(scratch.length).toBeGreaterThan(0); expect(scratch.every(bytes => bytes.every(value => value === 0))).toBe(true);
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['acquire', 'write', 'read', 'cancel', 'read-close'])('retires staged cells after %s failure', async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = Error('cell backing'), closeFailure = Error('cell close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const stored = createXlsxCellStorage({ ...ctx, createWorkingStorage() {
      if (mode === 'acquire') throw failure;
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) {
        if (fail && mode.startsWith('read')) throw failure;
        const bytes = await backing.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes;
      }, async write(position, bytes) { if (mode === 'write') throw failure; await backing.write(position, bytes); },
      async close() { await backing.close(); if (mode === 'read-close') throw closeFailure; } };
    } });
    const sheet = stored.sheet(0); await sheet.set(0, { row: 0, column: 0, value: { kind: 'number', value: 1 } });
    fail = true; await sheet.get(0); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; } finally { await engine.dispose(); }
  const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : error instanceof ZipStorageFailure ? leaves(error.cause) : [error];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});
