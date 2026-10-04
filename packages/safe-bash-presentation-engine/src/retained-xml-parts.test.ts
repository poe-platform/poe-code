import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { getXmlPart, openRetainedXmlPart } from './xml-parts.js';
import { resourceContext } from './resource-limits.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const validationLimits = { maxBytes: Infinity, maxNodes: Infinity, maxDepth: Infinity, maxParts: Infinity, maxRelationships: Infinity, maxEntries: Infinity };
const encode = (value: string) => new TextEncoder().encode(value);
async function collect(source: AsyncIterable<Uint8Array>) { const chunks = []; for await (const chunk of source) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
function archiveOf(bytes: Uint8Array, type = 'application/xml') {
  const files = new Map([['/note.xml', bytes], ['/[Content_Types].xml', encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/note.xml" ContentType="${type}"/></Types>`)]]);
  return { async *parts() { yield* files.keys(); }, async has(name: string) { return files.has(name); }, async byteLength(name: string) { return files.get(name)!.length; }, async *read(name: string) { const value = files.get(name)!, reused = new Uint8Array(4096); for (let p = 0; p < value.length; p += reused.length) { const size = Math.min(reused.length, value.length - p); reused.set(value.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } };
}
const examples = [
  '<root/>', '<root > <one a="港 &amp; 😀"/>\r\n <two><deep/></two> </root >',
  '<?xml version="1.0"?>\r\n<!--before--><root><one/>mixed &amp; &#32; text<two/></root><!--after-->',
  '<root><one><!--keep--><two/></one><other/></root>', '<root><one><![CDATA[ ]]><two/></one><other/></root>',
  '<root><?keep instruction?><one/><two/></root>', '<root> &#160; <one/> </root>',
  '<root><one xmlns="urn:x"><two> 😀 </two></one><three/></root>',
  `<root>${'<node>'.repeat(96)}<leaf a="${'x'.repeat(20000)}"/>${'</node>'.repeat(96)}</root>`
];
for (const [i, source] of examples.entries()) for (const pretty of [false, true]) for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) it(`streams XML matching buffered view ${i}, pretty ${pretty}, ${encoding}`, async () => {
  const bytes = encoding === 'utf8' ? Buffer.from('\ufeff' + source) : Buffer.concat([Buffer.from([255, 254]), Buffer.from(source, 'utf16le')]); if (encoding === 'utf16be') bytes.swap16();
  const archive = archiveOf(bytes), entries = []; for await (const name of archive.parts()) entries.push({ name: name.slice(1), bytes: await collect(archive.read(name)) });
  const context = { ...resourceContext({}), validationLimits }, fs = createMemoryFileSystem();
  const expected = await getXmlPart(storedArchive(entries), '/note.xml', { ...context, validationLimits: context.validationLimits! }, { pretty });
  const result = await openRetainedXmlPart(archive, '/note.xml', { ...context, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { pretty });
  expect((await collect(result.xml())).toString()).toBe(expected.xml); expect(await collect(result.bytes())).toEqual(Buffer.from(expected.bytes));
  await result.close(); await result.close(); await expect(collect(result.xml())).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});
for (const type of ['application/octet-stream', 'APPLICATION/XML; charset=utf-8', 'text/xml', 'application/custom+xml', 'application/' + 'x'.repeat(20000) + '+xml']) it(`admits XML content types without collecting arbitrary values: ${type.slice(0, 32)}`, async () => {
  const fs = createMemoryFileSystem(), context = { ...resourceContext({}), validationLimits };
  const pending = openRetainedXmlPart(archiveOf(encode('<root/>'), type), '/note.xml', { ...context, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (type === 'application/octet-stream') await expect(pending).rejects.toMatchObject({ code: 'unsupported-profile' }); else await (await pending).close();
  expect(await fs.readdir('/')).toEqual([]);
});
for (const source of ['<root><bad></root>', '<root>&absent;</root>', '<root a="1" a="2"/>', '<root xmlns:x="urn:x"><y:bad/></root>']) it(`rejects invalid XML before returning a handle: ${source}`, async () => {
  const fs = createMemoryFileSystem(); await expect(openRetainedXmlPart(archiveOf(encode(source)), '/note.xml', { ...{ ...resourceContext({}), validationLimits }, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: 'invalid-xml' }); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['write', 'read', 'cancel'] as const) it(`retires caller storage on XML admission failure: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let handles = 0;
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { if (mode === 'write') throw new Error('injected write'); if (mode === 'cancel') controller.abort(); return handle.write(...parameters); };
    if (key === 'read' && mode === 'read') return async () => { throw new Error('injected read'); };
    if (key === 'close') return async () => { handles--; return handle.close(); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  await expect(openRetainedXmlPart(archiveOf(encode('<root>' + '<node/>'.repeat(2000) + '</root>')), '/note.xml', { ...{ ...resourceContext({}), validationLimits }, workingStorage: { fs, directory: '/', cacheBytes: 16384 }, signal: controller.signal }, { pretty: true })).rejects.toBeDefined();
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
it('uses explicit XML operation limits independently of generic XML limits', async () => {
  const fs = createMemoryFileSystem(), archive = archiveOf(encode('<root><child/></root>'));
  const entries = []; for await (const name of archive.parts()) entries.push({ name: name.slice(1), bytes: await collect(archive.read(name)) });
  const context = { ...resourceContext({ xmlLimits: { maxBytes: 1, maxNodes: 1, maxDepth: 1 } }), validationLimits };
  const expected = await getXmlPart(storedArchive(entries), '/note.xml', context);
  const result = await openRetainedXmlPart(archive, '/note.xml', { ...context, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect((await collect(result.xml())).toString()).toBe(expected.xml); await result.close(); expect(await fs.readdir('/')).toEqual([]);
});
