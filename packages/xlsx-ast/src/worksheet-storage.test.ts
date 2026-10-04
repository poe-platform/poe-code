import { expect, it, vi } from 'vitest';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { createZipCodec } from '@poe-code/office-package';
import { parseXmlStream } from '@poe-code/safe-fs/xml';
import { ZipStorageFailure } from '@poe-code/office-package';
import { createWorksheetStorage } from './worksheet-storage.js';
import { readXlsx } from './xlsx.js';
const guard = vi.hoisted(() => ({ active: false }));
vi.mock('@poe-code/safe-fs/xml', async original => {
  const actual = await original<typeof import('@poe-code/safe-fs/xml')>();
  return { ...actual, async parseXmlStream(...args: Parameters<typeof actual.parseXmlStream>) {
    const result = await actual.parseXmlStream(...args);
    if (guard.active && result.localName === 'worksheet' && result.children.some(node => node.localName === 'sheetData' && node.children.length)) throw Error('resident worksheet rows');
    return result;
  } };
});
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: 'C', timezone: 'UTC' } };
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function fixture(alias = false, reused = false) {
  const parts = [
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="sheet"/>${reused ? '<sheet name="Copy" sheetId="2" r:id="sheet"/>' : ''}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="${rel}/worksheet" Target="sheet.xml"/></Relationships>`],
    ['xl/sheet.xml', `<worksheet xmlns="${ns}"><sheetFormatPr defaultRowHeight="17"/><cols><col min="1" max="160" width="12" outlineLevel="2"/><col min="1" max="159" hidden="1"/></cols><sheetData>  \n` + Array.from({ length: 160 }, (_, i) => `<row r="${i + 1}"><bad/><c r="A${i + 1}"><v>${i}</v></c><c r="B${i + 1}"><f t="shared" si="${i}">A${i + 1}+1</f><v>${i + 1}</v></c><c r="C${i + 1}"><f t="shared" si="${i}"/><v>${i + 2}</v></c></row> \n`).join('') + '<row r="1"><c r="A1"><v>999</v></c></row> \n</sheetData><sheetFormatPr defaultRowHeight="23"/><sheetData><row><c t="inlineStr"><is><r><rPr><b/></rPr><t>é😀</t></r></is></c></row></sheetData></worksheet>']
  ];
  if (alias) parts.push(['xl/_rels/sheet.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="comments" Type="${rel}/comments" Target="sheet.xml"/></Relationships>`]);
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = []; for (const [name, text] of parts) entries.push(await zip.makeZipEntry(name!, new TextEncoder().encode(text), { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: 'store' }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
it.each([false, true].flatMap(alias => [false, true].map(reused => ({ alias, reused }))))('stages worksheet rows with duplicate cells, formulas and diagnostics (metadata alias: $alias, repeated part: $reused)', async ({ alias, reused }) => {
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const bytes = await fixture(alias, reused), expected = await readXlsx(bytes, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } });
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(source, ctx) {
    guard.active = true;
    const set = Map.prototype.set;
    Map.prototype.set = function(key: unknown, value: unknown) {
      if (typeof key === 'number' && typeof value === 'number') throw Error('resident numeric worksheet index');
      if (typeof key === 'number' && value && typeof value === 'object' && 'index' in value) throw Error('resident axis metadata');
      if (value && typeof value === 'object' && 'expression' in value && 'row' in value && 'column' in value) throw Error('resident shared formula index');
      return set.call(this, key, value);
    };
    try { expect(await readXlsx(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } })).toEqual(expected); }
    finally { guard.active = false; Map.prototype.set = set; }
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, maximum) {
    const take = Math.min(maximum, borrowed.length, bytes.length - position); borrowed.set(bytes.subarray(position, position + take)); return borrowed.subarray(0, take);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics); expect(await fs.readdir('/')).toEqual([]);
});

it('replays independent row containers concurrently and restores original mixed XML content', async () => {
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), payloads: Uint8Array[] = [];
  let saved: ReturnType<typeof createWorksheetStorage> | undefined, pending = 0, reads = 0, writes = 0;
  const text = `<worksheet xmlns="${ns}"><sheetData>before<![CDATA[mid]]><!--keep-->` + Array.from({ length: 200 }, (_, i) => `<row r="${i + 1}"><c t="inlineStr"><is><t>é😀 ${i}</t></is></c></row> \n`).join('') + '</sheetData><sheetData>second<row r="999"/>tail</sheetData></worksheet>';
  const expected = await parseXmlStream([text]);
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    const store = saved = createWorksheetStorage({ ...ctx, createWorkingStorage() {
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) { expect(++pending).toBe(1); reads++; expect(count).toBeLessThanOrEqual(16384);
        try { const bytes = await backing.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; } },
        async write(position, bytes) { expect(++pending).toBe(1); writes++; expect(bytes.length).toBeLessThanOrEqual(16384); if (bytes.buffer.byteLength === 16384 && bytes.buffer !== borrowed.buffer) payloads.push(bytes);
          try { await Promise.resolve(); await backing.write(position, bytes); } finally { pending--; } }
      };
    } }, namespace => namespace === ns);
    const root = await parseXmlStream([text], { streamElements: store.streamElements });
    expect(root.children.map(node => node.children.length)).toEqual([0, 0]);
    const recognized = [];
    for (const container of root.children) {
      for await (const row of store.children(container)) await store.stage(container, row);
      const normalized = { ...container }; store.complete(container, normalized); recognized.push(normalized);
    }
    const restored = store.restore(root), first = store.rows(recognized[0]!), second = store.rows(recognized[1]!);
    const [a, b] = await Promise.all([first.next(), second.next()]);
    if (a.done || b.done) throw Error('missing replayed row');
    expect(a.value.attributes.find(attribute => attribute.localName === 'r')?.value).toBe('1');
    expect(b.value.attributes.find(attribute => attribute.localName === 'r')?.value).toBe('999');
    await first.return(undefined); await second.return(undefined); expect(await restored).toEqual(expected);
    const replay = store.rows(recognized[0]!); let count = 0; for await (const row of replay) { expect(row.localName).toBe('row'); count++; } expect(count).toBe(200);
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  await expect(saved!.restore(expected)).rejects.toThrow('closed');
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(payloads.length).toBeGreaterThan(0);
  expect(payloads.every(bytes => bytes.every(value => value === 0))).toBe(true); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['acquire', 'write', 'read', 'cancel', 'read-close'])('cleans worksheet records after %s failure', async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('row backing'), closeFailure = new Error('row close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const store = createWorksheetStorage({ ...ctx, createWorkingStorage() {
      if (mode === 'acquire') throw failure;
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) { if (fail && mode.startsWith('read')) throw failure;
        const bytes = await backing.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes; },
        async write(position, bytes) { if (mode === 'write') throw failure; await backing.write(position, bytes); },
        async close() { await backing.close(); if (mode === 'read-close') throw closeFailure; }
      };
    } }, namespace => namespace === ns);
    const root = await parseXmlStream([`<worksheet xmlns="${ns}"><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>`], { streamElements: store.streamElements });
    fail = true; await store.restore(root); return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : error instanceof ZipStorageFailure ? leaves(error.cause) : [error];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});
