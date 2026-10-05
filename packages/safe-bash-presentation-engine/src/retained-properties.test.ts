import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedProperties } from './retained-properties.js';
import { readProperties } from './properties.js';
import { streamJson } from './retained-output.js';
import { resourceContext } from './resource-limits.js';
import { fixture, rels, read } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const bytes of source) chunks.push(Buffer.from(bytes)); return Buffer.concat(chunks).toString(); }
for (const strict of [false, true]) for (const name of [undefined, 'title', 'Custom😀', 'missing']) it(`retains property records with SDK parity: strict=${strict}, name=${name}`, async () => {
  const custom = strict ? 'http://purl.oclc.org/ooxml/officeDocument/customProperties' : 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
  const vt = strict ? 'http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes' : 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
  const volume = fixture({
    '_rels/.rels': rels([['doc', 'officeDocument', 'main.xml'], ['custom', 'custom-properties', 'custom.xml']]).replace('</Relationships>', '<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="core.xml"/></Relationships>'),
    'core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Title 😀<dc:span>nested</dc:span><![CDATA[<&]]></dc:title><cp:revision> 0x10 </cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2000-02</dcterms:created><dcterms:modified xsi:type="unknown:date">not a date</dcterms:modified><other xmlns="urn:foreign">Foreign</other></cp:coreProperties>',
    'custom.xml': `<Properties xmlns="${custom}" xmlns:vt="${vt}"><property name="Custom😀"><vt:lpwstr>Text</vt:lpwstr></property><property name="Number"><vt:r8>9007199254740993</vt:r8></property><property name="Boolean"><vt:bool>true</vt:bool></property><property name="Date"><vt:filetime>2000-02-29</vt:filetime></property><property name="Unknown"><vt:unknown>Preserved</vt:unknown></property><property name="Ambiguous"><vt:i4>1</vt:i4><vt:i4>2</vt:i4></property><foreign>Foreign</foreign></Properties>`
  });
  if (strict) for (const [path, text] of Object.entries(volume.toJSON())) volume.writeFileSync(path, text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  const reader = read(volume), bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: new TextEncoder().encode(text!) })));
  const fs = createMemoryFileSystem(), query = name === undefined ? {} : { name }, expected = await readProperties(bytes, query, resourceContext({}));
  const view = await openRetainedProperties({ async *parts() { yield* reader.names; }, async has(part) { return reader.has(part); }, async byteLength(part) { return reader.get(part).length; }, async *read(part) { yield reader.get(part); } }, 'f'.repeat(64), query, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(JSON.parse(await collect(streamJson(view.records())))).toEqual(expected);
  expect(JSON.parse(await collect(streamJson(view.records())))).toEqual(expected);
  await view.close(); await expect(view.records().next()).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'cancel', 'source']) it(`retains long metadata scalars with spill and cleanup: ${mode}`, async () => {
  const long = 'Text😀'.repeat(6000), volume = fixture({ '_rels/.rels': rels([['doc', 'officeDocument', 'main.xml'], ['custom', 'custom-properties', 'custom.xml']]), 'custom.xml': `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="${long}"><vt:lpwstr>${long}</vt:lpwstr></property><property name="number"><vt:r8>${'0'.repeat(20000)}-0</vt:r8></property></Properties>` });
  const reader = read(volume), fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let writes = 0, peak = 0;
  fs.readFile = async () => { throw new Error('whole-file read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) { if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { writes += parameters[0].length; peak = Math.max(peak, parameters[0].length); await Promise.resolve(); return handle.write(...parameters); }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }); };
  let customReads = 0;
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { if (part === '/custom.xml') customReads++; const input = reader.get(part), reused = new Uint8Array(16384); for (let p = 0; p < input.length; p += reused.length) { if (part === '/custom.xml' && customReads > 1) { if (mode === 'source') throw new Error('source failure'); if (mode === 'cancel') controller.abort(); } const size = Math.min(reused.length, input.length - p); reused.set(input.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } };
  const pending = openRetainedProperties(archive, 'f'.repeat(64), {}, { workingStorage: { fs, directory: '/', cacheBytes: 16384 }, signal: controller.signal });
  if (mode !== 'success') await expect(pending).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  else { const view = await pending; try { const records = JSON.parse(await collect(streamJson(view.records()))); expect(records[0]).toMatchObject({ name: long, value: long }); expect(records[1].value).toBe(null); expect(writes).toBeGreaterThan(65536); expect(peak).toBeLessThanOrEqual(16384); } finally { await view.close(); } }
  expect(await fs.readdir('/')).toEqual([]);
});
