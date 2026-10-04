import type { WorkbookSource } from "@poe-code/spreadsheet-engine/codecs/types";
import { expect, it } from 'vitest';
import type { Workbook } from '@poe-code/spreadsheet-ast';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { createOdfWriter, readOdf } from './odf.js';
import { odsFormat } from './index.js';

it.each(['strict', 'extended'] as const)('replays %s scalar ODF cells and axes without workbook arrays', async profile => {
  const book: Workbook = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 300 }, (_, row) => ({ row, column: row % 3,
    value: { kind: 'number' as const, value: row ? row : -0 } })), rows: [{ index: 200, hidden: true }], columns: [{ index: 3, sizePoints: 40 }] }, { id: 't', name: 'Rich', cells: [{ row: 7, column: 2, value: { kind: 'string', value: 'hello 😀' }, richText: [{ start: 0, end: 5, attributes: { bold: true } }] }], rows: [{ index: 9, sizePoints: 22 }] }] };
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const bytes = await createOdfWriter(profile)(book, [], context), expected = await readOdf(bytes, context);
  const fs = createMemoryFileSystem();
  const reader = odsFormat.services.find(service => service.direction === 'read')!;
  expect(reader.readWorkbookSource).toBeTypeOf('function');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const push = Array.prototype.push;
    Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
      if (items.some(item => item && typeof item === 'object' && ('row' in item && 'column' in item && 'value' in item || 'index' in item && ('hidden' in item || 'sizePoints' in item)))) throw new Error('resident ODF workbook array');
      return push.apply(this, items);
    };
    let source;
    try { source = await reader.readWorkbookSource!(input, ctx); } finally { Array.prototype.push = push; }
    expect(source).toBeDefined();
    if (!source || !("metadata" in source)) throw new Error("Expected ODF source");
    expect(source!.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [], rows: [], columns: [] })) });
    for (let pass = 0; pass < 2; pass++) for (const sheet of expected.sheets) {
      let at = 0;
      for await (const cell of source!.cells(sheet.id)) expect(cell).toEqual(sheet.cells[at++]);
      expect(at).toBe(sheet.cells.length);
      for (const kind of ['rows', 'columns'] as const) {
        at = 0;
        for await (const axis of source!.axes!(sheet.id, kind)) expect(axis).toEqual(sheet[kind]![at++]);
        expect(at).toBe(sheet[kind]!.length);
      }
    }
    return source!.metadata;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + Math.min(length, 257)); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['formula', 'name'])('keeps %s inputs on the workbook preparation path', async kind => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const bytes = await createOdfWriter('extended')({ sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 2 }, ...(kind === 'formula' ? { formula: '=1+1' } : {}) }] }],
    ...(kind === 'name' ? { names: [{ name: 'number', expression: '=2' }] } : {}) }, [], context);
  const fs = createMemoryFileSystem(); let diagnostics = 0;
  const reader = odsFormat.services.find(service => service.direction === 'read')!;
  const expected = await readOdf(bytes, context);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const result = await reader.readWorkbookSource!(input, { ...ctx, async diagnostic() { diagnostics++; } });
    expect(diagnostics).toBe(0);
    expect(result).toEqual(expected);
    return result as Workbook;
  } }] });
  try {
    const result = await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: context.signal });
    expect(result).toEqual(expected);
  } finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

it('owns concurrent cell/axis replay from reused backing reads and revokes it after disposal', async () => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const book: Workbook = { sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 300 }, (_, row) => ({ row, column: 0, value: { kind: 'number' as const, value: row } })),
    rows: Array.from({ length: 300 }, (_, index) => ({ index, sizePoints: 20 })), columns: [{ index: 1, hidden: true }] }] };
  const bytes = await createOdfWriter('strict')(book, [], context);
  const fs = createMemoryFileSystem();
  const reader = odsFormat.services.find(service => service.direction === 'read')!;
  let saved: WorkbookSource | undefined;
  let acquired = 0, closed = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const source = (await reader.readWorkbookSource!(input, { ...ctx, createWorkingStorage() {
      acquired++; const storage = ctx.createWorkingStorage!(), borrowed = new Uint8Array(16384);
      return { ...storage, async read(position, length) {
        expect(length).toBeLessThanOrEqual(16384);
        const bytes = await storage.read(position, length); borrowed.set(bytes); await Promise.resolve(); return borrowed.subarray(0, bytes.length);
      }, async write(position, bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); await storage.write(position, bytes); }, async close() { closed++; await storage.close(); } };
    } }))!;
    if (!("metadata" in source)) throw new Error("Expected ODF source");
    saved = source;
    const id = source.metadata.sheets[0]!.id;
    await expect(source.cells('missing')[Symbol.asyncIterator]().next()).rejects.toThrow('Unknown ODF source sheet');
    for (let pass = 0; pass < 2; pass++) await Promise.all([
      (async () => { let at = 0; for await (const cell of source.cells(id)) { expect(cell.row).toBe(at++); Object.assign(cell, { row: 999 }); } expect(at).toBe(300); })(),
      (async () => { let at = 0; for await (const axis of source.axes!(id, 'rows')) { expect(axis.index).toBe(at++); Object.assign(axis, { index: 999 }); } expect(at).toBe(300); })()
    ]);
    const iterator = source.cells(id)[Symbol.asyncIterator](); await iterator.next(); await iterator.return?.();
    return source.metadata;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + Math.min(length, 257)); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(closed).toBe(acquired);
  await expect(saved!.cells('Data')[Symbol.asyncIterator]().next()).rejects.toThrow('closed');
  await expect(saved!.axes!('Data', 'rows')[Symbol.asyncIterator]().next()).rejects.toThrow('closed');
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['read', 'write', 'cancel'])('preserves ODF backing %s failures and cleans acquired storage', async mode => {
  const controller = new AbortController(), failure = new Error('ODF source failure');
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: controller.signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const bytes = await createOdfWriter('strict')({ sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 42 } }] }] }, [], context);
  const fs = createMemoryFileSystem(); let armed = mode === 'write', acquired = 0, closed = 0;
  const reader = odsFormat.services.find(service => service.direction === 'read')!;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const source = (await reader.readWorkbookSource!(input, { ...ctx, createWorkingStorage() {
      acquired++; const storage = ctx.createWorkingStorage!();
      return { ...storage, async read(position, length) {
        if (armed && mode === 'read') throw failure;
        const bytes = await storage.read(position, length);
        if (armed && mode === 'cancel') controller.abort(failure);
        return bytes;
      }, async write(position, bytes) { if (armed && mode === 'write') throw failure; await storage.write(position, bytes); }, async close() { closed++; await storage.close(); } };
    } }))!;
    if (!("metadata" in source)) throw new Error("Expected ODF source");
    armed = true;
    for await (const cell of source.cells(source.metadata.sheets[0]!.id)) void cell;
    return source.metadata;
  } }] });
  try { await expect(engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: controller.signal })).rejects.toBe(failure); }
  finally { await engine.dispose(); }
  expect(acquired).toBeGreaterThan(0); expect(closed).toBe(acquired);
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['odf12-aes128-cbc', 'libreoffice-aes256-gcm'])('replays encrypted %s input with a single password request', async encryption => {
  let passwords = 0;
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {}, password: { async read() { passwords++; return 'fixture password'; } },
    entropy: { async read({ length }) { return Uint8Array.from({ length }, (_, i) => i + 1); } } };
  const bytes = await createOdfWriter('extended')({ sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 42 } }] }] }, [`encryption=${encryption}`], context);
  const expected = await readOdf(bytes, context); passwords = 0;
  const fs = createMemoryFileSystem(), reader = odsFormat.services.find(service => service.direction === 'read')!;
  const engine = createEngine({ password: context.password!, workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const source = await reader.readWorkbookSource!(input, ctx);
    if (!source || !('metadata' in source)) throw new Error('Expected ODF source');
    expect(source.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [], rows: [], columns: [] })) });
    for await (const cell of source.cells('Data')) expect(cell).toEqual(expected.sheets[0]!.cells[0]);
    return source.metadata;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) { return bytes.subarray(position, position + length); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(passwords).toBe(1); expect(await fs.readdir('/')).toEqual([]);
});

it('converts registered ODF input to a slow sink without scalar workbook arrays', async () => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: 'C', timezone: 'UTC' }, own() {} };
  const bytes = await createOdfWriter('strict')({ sheets: [{ id: 's', name: 'Data', cells: Array.from({ length: 300 }, (_, row) => ({ row, column: 0, value: { kind: 'number', value: row } })) }] }, [], context);
  const fs = createMemoryFileSystem(), reused = new Uint8Array(257); let count = 0, pending = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [{ ...odsFormat, services: odsFormat.services.map(service => service.direction === 'read' ? { ...service,
    async read() { throw new Error('buffered reader'); }, async readSource() { throw new Error('workbook reader'); }
  } : service) }], codecs: [{ id: 'fixture', description: 'fixture', extensions: [], sourceAxes: true, async write() { throw new Error('workbook writer'); }, async *writeWorkbookSource(source) {
    for (const sheet of source.metadata.sheets) for await (const cell of source.cells(sheet.id)) {
      expect(cell.value).toEqual({ kind: 'number', value: count++ }); yield new Uint8Array([42]);
    }
  } }] });
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item && typeof item === 'object' && 'row' in item && 'column' in item && 'value' in item)) throw new Error('resident ODF workbook array');
    return push.apply(this, items);
  };
  try { await engine.convert({ input: { kind: 'range', source: { size: bytes.length, async read(position, length) {
    const take = Math.min(length, reused.length, bytes.length - position); reused.set(bytes.subarray(position, position + take)); return reused.subarray(0, take);
  } } }, importType: 'Gnumeric_OpenCalc:openoffice', exportType: 'fixture', destination: { kind: 'stream', sink: { async write(bytes) {
    expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); pending--;
  } } } }, { signal: context.signal }); }
  finally { Array.prototype.push = push; await engine.dispose(); }
  expect(count).toBe(300); expect(await fs.readdir('/')).toEqual([]);
});
