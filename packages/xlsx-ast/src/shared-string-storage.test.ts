import { expect, it, vi } from 'vitest';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { createZipCodec } from '@poe-code/office-package';
import { parseXmlStream } from '@poe-code/safe-fs/xml';
import { ZipStorageFailure } from '@poe-code/office-package';
import { createSharedStringStorage } from './shared-string-storage.js';
import { readXlsx } from './xlsx.js';
const guard = vi.hoisted(() => ({ tree: false }));
vi.mock('@poe-code/safe-fs/xml', async original => {
  const actual = await original<typeof import('@poe-code/safe-fs/xml')>();
  return { ...actual, async parseXmlStream(...args: Parameters<typeof actual.parseXmlStream>) {
    const result = await actual.parseXmlStream(...args);
    if (guard.tree && result.localName === 'sst' && result.children.length) throw Error('resident shared string tree');
    return result;
  } };
});
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: 'C', timezone: 'UTC' } };
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function fixture(utf16 = false, sharedAlias = false) {
  const parts = [
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${namespace}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="sheet"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>${sharedAlias ? `<Relationship Id="theme" Type="${rel}/theme" Target="sharedStrings.xml"/>` : ''}<Relationship Id="sheet" Type="${rel}/worksheet" Target="sheet.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `<sst xmlns="${namespace}">` + Array.from({ length: 160 }, (_, i) => `<si><r><rPr><b/><bad:sz xmlns:bad="urn:unrecognized" val="123"/><rFont val="Font ${i}"/></rPr><t>é😀 ${i}</t></r><t>_x0041_</t></si>`).join('') + '</sst>'],
    ['xl/sheet.xml', `<worksheet xmlns="${namespace}"><sheetData>` + Array.from({ length: 160 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${159 - i}</v></c></row>`).join('') + '</sheetData></worksheet>']
  ];
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = []; for (const [name, text] of parts) {
    let bytes = new TextEncoder().encode(text);
    if (utf16 && name === 'xl/sharedStrings.xml') {
      bytes = new Uint8Array(2 + text!.length * 2); const view = new DataView(bytes.buffer); view.setUint16(0, 0xfeff, true);
      for (let i = 0; i < text!.length; i++) view.setUint16(2 + i * 2, text!.charCodeAt(i), true);
    }
    entries.push(await zip.makeZipEntry(name!, bytes, { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: utf16 ? 'deflate' : 'store' }, limits, context.signal));
  }
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
it.each(['tree', 'decoded', 'retained-alias'].flatMap(mode => [false, true].map(utf16 => ({ mode, utf16 }))))('stages XLSX shared-string $mode with rich-text and reverse lookup parity (UTF-16: $utf16)', async ({ mode, utf16 }) => {
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const bytes = await fixture(utf16, mode === 'retained-alias'), expected = await readXlsx(bytes, { ...context, async diagnostic(event) { expectedDiagnostics.push(event); } }), fs = createMemoryFileSystem(), borrowed = new Uint8Array(257);
  vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('whole-file read')); vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('whole-file write'));
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(source, ctx) {
    guard.tree = mode === 'tree'; const map = Array.prototype.map;
    Array.prototype.map = function(callback: any, thisArg?: any): any[] {
      const result = map.call(this, callback, thisArg);
      if (mode === 'decoded' && result.length > 128 && result.every(value => value && typeof value === 'object' && 'value' in value && typeof value.value === 'string')) throw Error('resident decoded shared strings');
      return result;
    };
    try { expect(await readXlsx(source, { ...ctx, async diagnostic(event) { actualDiagnostics.push(event); } })).toEqual(expected); } finally { guard.tree = false; Array.prototype.map = map; }
    return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, maximum) {
    const take = Math.min(maximum, borrowed.length, bytes.length - position); borrowed.set(bytes.subarray(position, position + take)); return borrowed.subarray(0, take);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics); expect(await fs.readdir('/')).toEqual([]);
});

it('replays shared strings beyond the index cache with bounded borrowed transfers and owned rich text', async () => {
  const fs = createMemoryFileSystem(), borrowed = new Uint8Array(16384), payloads: Uint8Array[] = [];
  let saved: ReturnType<typeof createSharedStringStorage> | undefined, pending = 0, reads = 0, writes = 0;
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    const store = saved = createSharedStringStorage({ ...ctx, createWorkingStorage() {
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) { expect(++pending).toBe(1); reads++; expect(count).toBeLessThanOrEqual(16384);
        try { const bytes = await backing.read(position, count); borrowed.set(bytes); return borrowed.subarray(0, bytes.length); } finally { pending--; } },
        async write(position, bytes) { expect(++pending).toBe(1); writes++; expect(bytes.length).toBeLessThanOrEqual(16384); if (bytes.buffer.byteLength === 16384 && bytes.buffer !== borrowed.buffer) payloads.push(bytes);
          try { await Promise.resolve(); await backing.write(position, bytes); } finally { pending--; } }
      };
    } }, ns => ns === namespace);
    const text = 'é😀'.repeat(4000);
    const root = await parseXmlStream([`<sst xmlns="${namespace}">` + Array.from({ length: 300 }, (_, i) => `<si><r><rPr><b/></rPr><t>${i === 299 ? text : 'Value ' + i}</t></r><t><![CDATA[tail]]></t></si>`).join('') + '</sst>'], { streamElements: store.streamElements });
    expect(root.children).toEqual([]);
    for await (const child of store.children(root)) await store.accept(child);
    await store.decode();
    for (let i = 299; i >= 0; i--) {
      const result = await store.get(i); expect(result?.value).toBe((i === 299 ? text : 'Value ' + i) + 'tail');
      expect(result?.richText?.[0]?.attributes.bold).toBe(1);
    }
    const result = await store.get(0); (result!.richText![0]!.attributes as Record<string, unknown>).bold = 0;
    expect((await store.get(0))!.richText![0]!.attributes.bold).toBe(1);
    expect(await store.get(300)).toBeUndefined(); return { sheets: [] };
  } }] });
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  const failure = await saved!.get(0).catch(error => error); expect(failure).toBeInstanceOf(ZipStorageFailure); expect(failure.cause.message).toContain('closed');
  expect(reads).toBeGreaterThan(0); expect(writes).toBeGreaterThan(0); expect(payloads.length).toBeGreaterThan(0);
  expect(payloads.every(bytes => bytes.every(value => value === 0))).toBe(true); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['acquire', 'write', 'read', 'cancel', 'read-close'])('retires shared-string storage after %s failure', async mode => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error('shared strings backing'), closeFailure = new Error('shared strings close');
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: '', extensions: [], async readSource(_source, ctx) {
    let fail = false;
    const store = createSharedStringStorage({ ...ctx, createWorkingStorage() {
      if (mode === 'acquire') throw failure;
      const backing = ctx.createWorkingStorage!();
      return { ...backing, async read(position, count) { if (fail && mode.startsWith('read')) throw failure;
        const bytes = await backing.read(position, count); if (fail && mode === 'cancel') controller.abort(failure); return bytes; },
        async write(position, bytes) { if (mode === 'write') throw failure; await backing.write(position, bytes); },
        async close() { await backing.close(); if (mode === 'read-close') throw closeFailure; }
      };
    } }, ns => ns === namespace);
    const root = await parseXmlStream([`<sst xmlns="${namespace}"><si><t>Value</t></si></sst>`], { streamElements: store.streamElements });
    fail = true; for await (const child of store.children(root)) await store.accept(child);
    return { sheets: [] };
  } }] });
  let caught: unknown;
  try { await engine.readWorkbook({ kind: 'range', source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: 'fixture' }, { signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await engine.dispose(); }
  const leaves = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(leaves) : error instanceof ZipStorageFailure ? leaves(error.cause) : [error];
  expect(leaves(caught)).toContain(failure); if (mode === 'read-close') expect(leaves(caught)).toContain(closeFailure);
  expect(await fs.readdir('/')).toEqual([]);
});
