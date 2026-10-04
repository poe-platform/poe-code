import { expect, it } from 'vitest';
import { createZipCodec } from '@poe-code/office-package';
import { createMemoryFileSystem } from '@poe-code/safe-fs/core';
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from '@poe-code/spreadsheet-engine';
import { readOdf } from './odf.js';

it.each([false, true].flatMap(formula => [false, true].map(print => ({ formula, print }))))('preserves staged row groups, mixed content, metadata and diagnostics (formula: $formula, print: $print)', async ({ formula, print }) => {
  const context: CapabilityContext = { signal: new AbortController().signal, limits: defaultSsconvertLimits, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' } };
  const xml = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"><office:body><office:spreadsheet><table:table table:name="Data"${print ? ' table:print-ranges="Data.A1:C9"' : ''}>
<table:table-column table:number-columns-repeated="3"/><!--before--><table:table-header-rows><table:table-row><table:table-cell office:value-type="string"><text:p>header</text:p></table:table-cell></table:table-row></table:table-header-rows>
<table:table-row-group><!--group--><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="2"${formula ? ' table:formula="of:=1+1"' : ''}/></table:table-row><table:table-row-group><table:table-row><table:table-cell office:value-type="string"><text:p><text:a xlink:href="https://example.invalid/">link</text:a></text:p><office:annotation><dc:creator>Ada</dc:creator><text:p>note</text:p></office:annotation></table:table-cell></table:table-row></table:table-row-group></table:table-row-group>
<![CDATA[between]]><?sample data?><table:table-row><table:unknown/><table:table-cell office:value-type="float" office:value="42"/></table:table-row><!--after-->
</table:table></office:spreadsheet></office:body></office:document-content>`;
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity, maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = [];
  for (const [name, value] of [['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', xml]]) entries.push(await zip.makeZipEntry(name!, new TextEncoder().encode(value!), { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: 'store' }, limits, context.signal));
  const bytes = await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
  const expectedDiagnostics: unknown[] = [], actualDiagnostics: unknown[] = [];
  const expected = await readOdf(bytes, { ...context, async diagnostic(value) { expectedDiagnostics.push(value); } });
  const fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: '/', cacheBytes: 16384 }, codecs: [{ id: 'fixture', description: 'fixture', extensions: [], async readSource(input, ctx) {
    const actual = await readOdf(input, { ...ctx, async diagnostic(value) { actualDiagnostics.push(value); } });
    expect(actual).toEqual(expected);
    return actual;
  } }] });
  const borrowed = new Uint8Array(257);
  try { await engine.readWorkbook({ kind: 'range', source: { size: bytes.length, async read(position, length) {
    const count = Math.min(length, borrowed.length, bytes.length - position); borrowed.set(bytes.subarray(position, position + count)); return borrowed.subarray(0, count);
  } } }, { importType: 'fixture' }, { signal: context.signal }); }
  finally { await engine.dispose(); }
  expect(actualDiagnostics).toEqual(expectedDiagnostics);
  expect(await fs.readdir('/')).toEqual([]);
});

it('preserves XML staging and cleanup failures together', async () => {
  const { createOdfWriter } = await import('./odf.js');
  const context: CapabilityContext = { signal: new AbortController().signal, limits: defaultSsconvertLimits, own() {}, environment: { env: {}, locale: 'C', timezone: 'UTC' } };
  const bytes = await createOdfWriter('strict')({ sheets: [{ id: 's', name: 'Data', cells: [{ row: 0, column: 0, value: { kind: 'number', value: 1 } }] }] }, [], context);
  const operation = new Error('XML write failed'), cleanup = new Error('XML cleanup failed');
  await expect(readOdf(bytes, { ...context, createWorkingStorage() { return {
    allocate() { return 8; }, async read() { throw operation; }, async write() { throw operation; }, async close() { throw cleanup; }
  }; } })).rejects.toMatchObject({ errors: [operation, cleanup] });
});
