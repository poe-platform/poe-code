import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import * as gnumeric from "./gnumeric.js";
import type { WorkbookSource } from "./types.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: "C", timezone: "UTC" } };
const xml = (cells: string) => '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells>' + cells + '</g:Cells></g:Sheet></g:Sheets></g:Workbook>';

it.each([false, true])('replays scalar Gnumeric cells without a resident cell array, gzip=%s', async gzip => {
  const text = xml(Array.from({ length: 300 }, (_, i) => `<g:Cell Row="${299 - i}" Col="0" ValueType="40">${i}</g:Cell>`).join('') +
    '<g:Cell Row="2" Col="0" ValueType="40">-0</g:Cell><g:Cell Row="1" Col="2" ValueType="60" ValueFormat="@[bold=0:1]">😀</g:Cell>');
  const bytes = gzip ? new Uint8Array(gzipSync(text)) : new TextEncoder().encode(text);
  const expected = await gnumeric.readGnumeric(bytes, context);
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  let captured: WorkbookSource | undefined;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(source, ctx) {
      const push = Array.prototype.push, set = Map.prototype.set;
      Map.prototype.set = function(key: unknown, value: unknown) {
        if (value && typeof value === 'object' && 'index' in value && 'sizePoints' in value) throw new Error('resident Gnumeric axes');
        return set.call(this, key, value);
      };
      Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
        if (items.some(item => item && typeof item === 'object' && 'row' in item && 'column' in item && 'value' in item)) throw new Error('resident workbook cells');
        return push.apply(this, items);
      };
      try { captured = await gnumeric.readGnumericWorkbookSource(source, ctx); }
      finally { Array.prototype.push = push; Map.prototype.set = set; }
      expect(captured).toBeDefined();
      expect(captured!.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [] })) });
      const sorted = [...expected.sheets[0]!.cells].sort((a, b) => a.row - b.row || a.column - b.column);
      for (let pass = 0; pass < 2; pass++) {
        const actual = []; for await (const cell of captured!.cells('s1')) actual.push(cell);
        expect(actual).toEqual(sorted);
        Object.assign(actual[0]!, { value: { kind: 'string', value: 'mutated' } });
      }
      return captured!.metadata;
    }
  }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) {
    const take = Math.min(count, borrowed.length, bytes.length - position); borrowed.set(bytes.subarray(position, position + take)); return borrowed.subarray(0, take);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  await expect(captured!.cells('s1')[Symbol.asyncIterator]().next()).rejects.toThrow();
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['<g:Cell Row="0" Col="0">=1+2</g:Cell>', '<g:Cell Row="0" Col="0" ExprID="1"/>'])('declines formula/shared-expression inputs before diagnostics: %s', async cell => {
  const bytes = new TextEncoder().encode(xml('<g:Odd/>' + cell)), fs = createMemoryFileSystem();
  let diagnostics = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(source, ctx) {
      expect(await gnumeric.readGnumericWorkbookSource(source, { ...ctx, async diagnostic() { diagnostics++; } })).toBeUndefined();
      expect(diagnostics).toBe(0);
      return gnumeric.readGnumeric(source, ctx);
    }
  }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

it('converts through the registered source to a slow CSV sink without array readers', async () => {
  const { default: format } = await import('./providers/xml.js');
  const { csvFormat } = await import('@poe-code/spreadsheet-format-csv');
  const bytes = new TextEncoder().encode(xml(Array.from({ length: 500 }, (_, row) => `<g:Cell Row="${row}" Col="0" ValueType="40">${row}</g:Cell>`).join('')));
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, formats: [csvFormat,
    { ...format, services: format.services.map(service => service.direction === 'read' ? { ...service, readSource() { throw new Error('array input'); }, read() { throw new Error('buffered input'); } } : service) }
  ] });
  let output = '', pending = 0;
  try { await engine.convert({ input: { kind: 'range', source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + Math.min(count, 257)); } } },
    importType: 'Gnumeric_XmlIO:sax', exportType: 'Gnumeric_stf:stf_csv', destination: { kind: 'stream', sink: { async write(bytes) {
      expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); output += new TextDecoder().decode(bytes); pending--;
    } } } }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(output).toBe(Array.from({ length: 500 }, (_, row) => row + '\n').join(''));
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['write', 'read', 'cancel', 'read-close'])('cleans up caller-backed decoded cells after %s failure', async mode => {
  const { createGnumericValueStorage } = await import('./gnumeric-value-storage.js');
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('backing failed'), closeFailure = new Error('close failed');
  let reads = 0, writes = 0, pending = 0;
  const borrowed = new Uint8Array(16384);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(_source, ctx) {
      const values = createGnumericValueStorage({ ...ctx, createWorkingStorage() {
        const store = ctx.createWorkingStorage!();
        return { ...store, async write(position, bytes) { expect(++pending).toBe(1); writes++; expect(bytes.length).toBeLessThanOrEqual(16384);
          try { await Promise.resolve(); if (mode === 'write') throw failure; await store.write(position, bytes); } finally { pending--; } },
          async read(position, count) { reads++; expect(count).toBeLessThanOrEqual(16384);
            if (mode.startsWith('read')) throw failure;
            const data = await store.read(position, count); borrowed.set(data); if (mode === 'cancel') controller.abort(failure); return borrowed.subarray(0, data.length); },
          async close() { await store.close(); if (mode === 'read-close') throw closeFailure; }
        };
      } });
      await values.append(0, { row: 0, column: 0, value: { kind: 'string', value: 'x'.repeat(20000) } });
      for await (const cell of values.cells(0)) expect(cell.value).toBeDefined();
      return { sheets: [] };
    }
  }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
  expect(leaves(caught)).toContain(failure);
  if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(writes).toBeGreaterThan(0); if (mode !== 'write') expect(reads).toBeGreaterThan(0);
  expect(await fs.readdir('/')).toEqual([]);
});

it('preserves styled multi-sheet metadata, sparse coordinates and literal equals strings', async () => {
  const text = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:SheetNameIndex><g:SheetName g:Rows="16777216" g:Cols="16384">Data</g:SheetName><g:SheetName>Second</g:SheetName></g:SheetNameIndex><g:Sheets>' +
    '<g:Sheet><g:Name>Data</g:Name><g:Styles><g:StyleRegion startRow="0" startCol="0" endRow="4" endCol="4"><g:Style Format="0.00"><g:Font Bold="1">Sans</g:Font></g:Style></g:StyleRegion></g:Styles>' +
    '<g:Rows DefaultSizePts="22"><g:RowInfo No="1" Unit="30" Hidden="1"/></g:Rows><g:Cells><g:Cell Row="16777215" Col="16383" ValueType="40">42</g:Cell><g:Cell Row="1" Col="2" ValueType="60">=literal</g:Cell><g:Cell Row="0" Col="0" ValueType="50">#DIV/0!</g:Cell><g:Cell Row="1" Col="2" ValueType="60"><g:Content>last😀</g:Content></g:Cell></g:Cells></g:Sheet>' +
    '<g:Sheet><g:Name>Second</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="20">TRUE</g:Cell><g:Cell Row="2" Col="1" ValueType="10"/></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const bytes = new TextEncoder().encode(text), expected = await gnumeric.readGnumeric(bytes, context), fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
    const replay = (await gnumeric.readGnumericWorkbookSource(source, ctx))!;
    expect(replay.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [] })) });
    for (const sheet of expected.sheets) {
      const cells = []; for await (const cell of replay.cells(sheet.id)) cells.push(cell);
      expect(cells).toEqual([...sheet.cells].sort((a, b) => a.row - b.row || a.column - b.column));
    }
    return replay.metadata;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

it('serializes concurrent replays through borrowed storage responses and erases scratch on cleanup', async () => {
  const { createGnumericValueStorage } = await import('./gnumeric-value-storage.js');
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), outputs = new Set<Uint8Array>();
  let pending = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(_source, ctx) {
    const values = createGnumericValueStorage({ ...ctx, createWorkingStorage() {
      const store = ctx.createWorkingStorage!();
      return { ...store, async write(position, bytes) { expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); outputs.add(bytes);
        try { await Promise.resolve(); await store.write(position, bytes); } finally { pending--; } },
        async read(position, count) { expect(++pending).toBe(1); expect(count).toBeLessThanOrEqual(16384);
          try { const bytes = await store.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; } }
      };
    } });
    for (let row = 150; row >= 0; row--) for (const sheet of [0, 1]) await values.append(sheet, { row, column: 0, value: { kind: 'string', value: `${sheet}:${row}:` + '😀'.repeat(5000) } });
    const verify = async (sheet: number) => { let row = 0; for await (const cell of values.cells(sheet)) {
      expect(cell.row).toBe(row); expect(cell.value).toEqual({ kind: 'string', value: `${sheet}:${row}:` + '😀'.repeat(5000) }); row++;
    } expect(row).toBe(151); };
    await Promise.all([verify(0), verify(1), verify(0)]);
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  // Cell payload/header views share the fixed scratch; index writes own their
  // short buffers and do not contain the payload text.
  expect([...outputs].filter(bytes => bytes.length > 8).every(bytes => bytes.every(byte => byte === 0))).toBe(true);
  expect(await fs.readdir('/')).toEqual([]);
});

it.each([
  '<g:Rows DefaultSizePts="20"/><g:Cells><g:Cell Row="2" Col="1" ValueType="40">1</g:Cell></g:Cells><g:Rows DefaultSizePts="25"><g:RowInfo No="2" Count="2" Unit="0" Hidden="1"/></g:Rows><g:Cells><g:Cell Row="9" Col="1" ValueType="40">2</g:Cell></g:Cells><g:Rows DefaultSizePts="30"/>',
  '<g:Cells><g:Cell Row="2" Col="1" ValueType="40">1</g:Cell></g:Cells><g:Rows DefaultSizePts="20"><g:RowInfo No="2" Unit="-1"/><g:RowInfo No="2" Count="2" Unit="0"/></g:Rows><g:Cols DefaultSizePts="55"><g:ColInfo No="1" Count="2" Unit="0" Collapsed="1"/></g:Cols>',
  '<g:Rows DefaultSizePts="20"><g:RowInfo No="2" Unit="35"/><g:RowInfo No="1" Count="3" Unit="0" OutlineLevel="2"/></g:Rows><g:Cells><g:Cell Row="2" Col="1" ValueType="40">1</g:Cell></g:Cells><g:Rows DefaultSizePts="22"><g:RowInfo No="3" Unit="40"/></g:Rows>'
])('preserves stored axis timing, range recovery and diagnostics for %s', async sections => {
  const bytes = new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name>' + sections + '</g:Sheet></g:Sheets></g:Workbook>');
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await gnumeric.readGnumeric(bytes, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } });
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(source, ctx) {
    const replay = await gnumeric.readGnumericWorkbookSource(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } });
    expect(replay!.metadata).toEqual({ ...expected, sheets: expected.sheets.map(sheet => ({ ...sheet, cells: [] })) });
    return replay!.metadata;
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics);
  expect(await fs.readdir('/')).toEqual([]);
});
