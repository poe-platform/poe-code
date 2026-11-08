import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { readGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: "C", timezone: "UTC" } };

it.each([false, true])("stages Gnumeric cell XML without retaining a cell subtree collection, gzip=%s", async gzip => {
  const xml = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells>' +
    Array.from({ length: 300 }, (_, row) => `<g:Cell Row="${row}" Col="0" ValueType="60">row ${row}</g:Cell>`).join('') +
    '</g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const bytes = gzip ? new Uint8Array(gzipSync(xml)) : new TextEncoder().encode(xml), expected = await readGnumeric(bytes, context);
  const fs = createMemoryFileSystem(), reused = new Uint8Array(257);
  let inspecting = false;
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{ id: "fixture", description: "fixture", extensions: [],
    async readSource(source, ctx) { const result = await readGnumeric(source, ctx); inspecting = true; try { expect(result).toEqual(expected); } finally { inspecting = false; } return result; }
  }] });
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (!inspecting && items.some(item => item && typeof item === 'object' && 'kind' in item && item.kind === 'element' && 'localName' in item && item.localName === 'Cell')) throw new Error('resident XML cells');
    return push.apply(this, items);
  };
  try { await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, length) {
    const count = Math.min(length, reused.length, bytes.length - position); reused.set(bytes.subarray(position, position + count)); return reused.subarray(0, count);
  } } }, { importType: "fixture" }, { signal: context.signal }); }
  finally { Array.prototype.push = push; await engine.dispose(); }
  expect(await fs.readdir('/')).toEqual([]);
});

const cases = [
  '<g:Cells><g:Cell Row="2" Col="0" ValueType="60">before<g:Content>a<![CDATA[b]]>&amp;c</g:Content>after</g:Cell><g:Odd/><g:Cell Row="2" Col="0" ValueType="40">17</g:Cell></g:Cells>',
  '<g:Cells><g:Cell Row="0" Col="0">=Rate</g:Cell><g:Cell Row="1" Col="0">=[]Missing</g:Cell><g:Cell Row="2" Col="0" ExprID="1">=A1+1</g:Cell><g:Cell Row="3" Col="0" ExprID="1"/></g:Cells><g:Names><g:Name><g:name>Rate</g:name><g:value>2</g:value></g:Name></g:Names>',
  '<g:Cells><g:Cell Row="2" Col="0" ValueType="40">1</g:Cell></g:Cells><g:Rows DefaultSizePts="20"><g:RowInfo No="2" Unit="30" Hidden="1"/></g:Rows><g:Cells><g:Cell Row="9" Col="0">=Later</g:Cell></g:Cells><g:Rows DefaultSizePts="25"/>',
  '<g:Cells><foreign xmlns="urn:other"><child/></foreign><g:Cell Row="0" Col="0" ValueType="60" ValueFormat="@[bold=1:3]">x😀z</g:Cell><g:Cell Row="1" Col="0">=1+2<g:Odd/></g:Cell></g:Cells>'
];
it.each(cases)("preserves staged XML semantics and diagnostic order for %s", async body => {
  const xml = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Names><g:Name><g:name>Rate</g:name><g:value>11</g:value></g:Name></g:Names><g:Sheets><g:Sheet><g:Name>Data</g:Name>' + body + '</g:Sheet><g:Sheet><g:Name>Second</g:Name><g:Cells><g:Cell Row="0" Col="0">=Data!Rate</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const bytes = new TextEncoder().encode(xml), expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await readGnumeric(bytes, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } });
  const fs = createMemoryFileSystem(); let reads = 0, writes = 0, pending = 0;
  const borrowed = new Uint8Array(16384);
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{ id: "fixture", description: "fixture", extensions: [],
    async readSource(source, ctx) {
      const result = await readGnumeric(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); }, createWorkingStorage() {
        const store = ctx.createWorkingStorage!();
        return { ...store, async read(position, count) { reads++; expect(count).toBeLessThanOrEqual(16384); borrowed.set(await store.read(position, count)); return borrowed.subarray(0, count); },
          async write(position, bytes) { writes++; expect(bytes.length).toBeLessThanOrEqual(16384); expect(++pending).toBe(1);
            try { await Promise.resolve(); await store.write(position, bytes); } finally { pending--; } } };
      } });
      expect(result).toEqual(expected); return result;
    }
  }] });
  try { await engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } } }, { importType: "fixture" }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics); expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0);
  expect(await fs.readdir('/')).toEqual([]);
});

it.each(['bytes', 'range'])('captures %s before storage acquisition callbacks', async kind => {
  const bytes = new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells><g:Cell Row="0" Col="0" ValueType="40">42</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>');
  const source = { size: bytes.length, async read(position: number, count: number) { return bytes.subarray(position, position + count); } };
  const fs = createMemoryFileSystem(), engine = createEngine({ workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(_source, ctx) {
      const result = await readGnumeric(kind === 'bytes' ? bytes : source, { ...ctx, createWorkingStorage() {
        if (kind === 'bytes') bytes.fill(0); else { source.size = 0; source.read = async () => { throw new Error('replaced reader'); }; }
        return ctx.createWorkingStorage!();
      } });
      expect(result.sheets[0]!.cells[0]!.value).toEqual({ kind: 'number', value: 42 }); return result;
    }
  }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
});

it.each(['acquire', 'write', 'read', 'cancel', 'read-and-close'])('retires staged cells after %s failure', async mode => {
  const bytes = new TextEncoder().encode('<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>Data</g:Name><g:Cells>' + '<g:Cell Row="0" Col="0" ValueType="60">value</g:Cell>'.repeat(100) + '</g:Cells></g:Sheet></g:Sheets></g:Workbook>');
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('staging failed'), closeFailure = new Error('staging cleanup failed');
  const engine = createEngine({ workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(source, ctx) {
      return readGnumeric(source, { ...ctx, createWorkingStorage() {
        if (mode === 'acquire') throw failure;
        const store = ctx.createWorkingStorage!();
        return { ...store, async write(position, chunk) { if (mode === 'write') throw failure; await store.write(position, chunk); },
          async read(position, count) { if (mode.startsWith('read')) throw failure; const bytes = await store.read(position, count); if (mode === 'cancel') controller.abort(failure); return bytes; },
          async close() { await store.close(); if (mode === 'read-and-close') throw closeFailure; } };
      } });
    }
  }] });
  let error: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, count) { return bytes.subarray(position, position + count); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (caught) { error = caught; }
  finally { await engine.dispose(); }
  if (mode === 'read-and-close') {
    const leaves = (value: unknown): unknown[] => value instanceof AggregateError ? value.errors.flatMap(leaves) : [value];
    expect(leaves(error)).toContain(failure); expect(leaves(error)).toContain(closeFailure);
  } else expect(error).toBe(failure);
  expect(await fs.readdir('/')).toEqual([]);
});

it('registers XML storage cleanup before acquisition and erases borrowed staging windows', async () => {
  const { createGnumericCellStorage } = await import('./gnumeric-cell-storage.js');
  let acquired = false;
  expect(() => createGnumericCellStorage({ ...context, own(close) { void close(); }, createWorkingStorage() { acquired = true; throw new Error('acquired'); } }, () => true)).toThrow('closed');
  expect(acquired).toBe(false);
  const fs = createMemoryFileSystem(), borrowed: Uint8Array[] = [];
  const engine = createEngine({ workingFiles: { fs, directory: '/' }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [],
    async readSource(_source, ctx) {
      const source = createGnumericCellStorage({ ...ctx, createWorkingStorage() {
        const store = ctx.createWorkingStorage!(); return { ...store, async write(position, bytes) { borrowed.push(bytes); await store.write(position, bytes); } };
      } }, () => true);
      const { parseXmlStream } = await import('@poe-code/safe-fs/xml');
      const root = await parseXmlStream(['<Workbook><Sheets><Sheet><Cells><Cell>' + 'private'.repeat(10000) + '</Cell></Cells></Sheet></Sheets></Workbook>'], source);
      const cells = root.children[0]!.children[0]!.children[0]!;
      for await (const item of source.children(cells)) expect(item.node.text).toBe('private'.repeat(10000));
      return { sheets: [] };
    }
  }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(borrowed.length).toBeGreaterThan(0); expect(borrowed.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
  expect(await fs.readdir('/')).toEqual([]);
});
