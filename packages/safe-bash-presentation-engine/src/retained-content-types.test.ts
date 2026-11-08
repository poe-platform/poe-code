import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { parseContentTypes } from "./content-types.js";
import { openRetainedContentTypes } from "./retained-content-types.js";
const encode = (value: string) => new TextEncoder().encode(value);
const source = (value: string) => (async function* () { yield encode(value); })();
const text = async (value: AsyncIterable<Uint8Array>) => { let result = ""; for await (const bytes of value) result += new TextDecoder().decode(bytes); return result; };
const manifest = (body: string) => `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${body}</Types>`;
const main = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
it("looks up defaults and overrides preserving media parameters and presentation kinds", async () => {
  const fs = createMemoryFileSystem();
  const index = await openRetainedContentTypes(source(manifest(`<Default Extension="xml" ContentType="application/xml; a=&quot;x;y&quot;"/><Override PartName="/ppt/presentation.xml" ContentType="${main}"/>`)), { workingStorage: { fs, directory: "/" } });
  expect(await text(await index.get('/Other.XML'))).toBe('application/xml; a="x;y"');
  expect(await index.presentationKind('/PPT/presentation.xml')).toBe('pptx');
  await expect(index.presentationKind('/ppt/presentation.xml', 'potx')).rejects.toMatchObject({ code: 'invalid-opc' });
  await expect(index.get('/absent.bin')).rejects.toMatchObject({ code: 'missing-binding' });
  await index.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(index.get('/x.xml')).rejects.toMatchObject({ code: 'invalid-handle' });
});
for (const body of [
  '', '<Default Extension="xml" ContentType="x"/>', '<Default Extension="xml" ContentType="x/y; a=b; A=c"/>',
  '<Default Extension="xml" ContentType="x/y "/>', '<Default Extension="xml" ContentType="x/y; a=&quot;unterminated"/>',
  '<Default Extension="xml" ContentType="x/y"/><Default Extension="XML" ContentType="a/b"/>',
  '<Override PartName="/A.xml" ContentType="x/y"/><Override PartName="/a.xml" ContentType="x/y"/>',
  '<Override PartName="/a%41.xml" ContentType="x/y"/>', '<Override PartName="/a%ff.xml" ContentType="x/y"/>',
  '<Default Extension="x%" ContentType="x/y"/>', '<Default Extension="xml" ContentType="x/y"><a/></Default>',
  '<Default Extension="xml" ContentType="x/y"/>text', '<![CDATA[ ]]><Default Extension="xml" ContentType="x/y"/>',
  `<Default Extension="xml" ContentType="${main}; a=b"/>`, '<Default Extension="xml" ContentType="x/y" extra="a"/>',
  '<Override PartName="/a./b" ContentType="x/y"/>', '<Override PartName="/a//b" ContentType="x/y"/>'
]) it(`preserves rejection: ${body}`, async () => {
  const input = manifest(body); expect(() => parseContentTypes(encode(input))).toThrow();
  const fs = createMemoryFileSystem();
  await expect(openRetainedContentTypes(source(input), { workingStorage: { fs, directory: '/' } })).rejects.toBeDefined();
  expect(await fs.readdir('/')).toEqual([]);
});
it('spills generated large scalar values and parameter indexes through bounded caller writes', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, outstanding = 0, peak = 0;
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { const size = parameters[0].length; written += size; outstanding += size; peak = Math.max(peak, outstanding); try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= size; } };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const input = (async function* () {
    yield encode(manifest('').replace('</Types>', '') + '<Default Extension="xml" ContentType="x/y; a=&quot;');
    const bytes = new Uint8Array(16384).fill(120); for (let n = 0; n < 80; n++) { bytes.fill(120); yield bytes; }
    yield encode('&quot;'); for (let n = 0; n < 200; n++) yield encode(`; p${n}=v`);
    yield encode('"/></Types>');
  })();
  const index = await openRetainedContentTypes(input, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  let length = 0; for await (const bytes of await index.get('/a.xml')) { expect(bytes.length).toBeLessThanOrEqual(16384); length += bytes.length; await Promise.resolve(); }
  expect(length).toBeGreaterThan(80 * 16384); expect(written).toBeGreaterThan(length); expect(peak).toBeLessThanOrEqual(16384);
  await index.close(); expect(await fs.readdir('/')).toEqual([]);
});
for (const mime of ['x/y', 'X/Y', 'x/y;a=b', 'x/y ; a="x\\"y"', 'x/y; a="é"', 'x/y; a=""', 'x/y; a="a;b"', 'x/y; a=b; c=d', 'x/y;', '/y', 'x/', 'x/y; a= ', 'x/y; a="🙂"', 'application/vnd.openxmlformats-package.test; a=b']) {
  it(`matches existing MIME admission: ${mime}`, async () => {
    const input = manifest(`<Default Extension="xml" ContentType="${mime.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"/>`);
    let expected = true; try { parseContentTypes(encode(input)); } catch { expected = false; }
    const fs = createMemoryFileSystem(); let actual;
    try { actual = await openRetainedContentTypes(source(input), { workingStorage: { fs, directory: '/' } }); }
    catch { expect(expected).toBe(false); }
    if (actual) { expect(expected).toBe(true); expect(await text(await actual.get('/x.xml'))).toBe(mime); await actual.close(); }
    expect(await fs.readdir('/')).toEqual([]);
  });
}
it('enforces caller limits and preserves cancellation/source failures while retiring storage', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const input = manifest('<Default Extension="xml" ContentType="x/y"/><Default Extension="bin" ContentType="x/z"/>');
  await expect(openRetainedContentTypes(source(input), settings, { maxEntries: 1 })).rejects.toMatchObject({ code: 'resource-limit' });
  await expect(openRetainedContentTypes(source(input), settings, { maxBytes: 32 })).rejects.toMatchObject({ code: 'resource-limit' });
  const controller = new AbortController();
  const broken = (async function* () { yield encode(input); controller.abort(); yield encode(' '); })();
  await expect(openRetainedContentTypes(broken, { ...settings, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  const failed = (async function* () { yield encode('<Types>'); throw new Error('source failed'); })();
  await expect(openRetainedContentTypes(failed, settings)).rejects.toMatchObject({ code: 'io-failure' });
  expect(await fs.readdir('/')).toEqual([]);
  const index = await openRetainedContentTypes(source(input), settings);
  const value = await index.get('/x.xml'); await index.close();
  await expect(value[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'invalid-handle' });
});
it('does not collect long default extensions, override paths or MIME parameter names', async () => {
  const fs = createMemoryFileSystem();
  const input = (async function* () {
    yield encode(manifest('').replace('</Types>', '') + '<Default Extension="');
    const chunk = new Uint8Array(16384).fill(97); for (let n = 0; n < 5; n++) yield chunk;
    yield encode('" ContentType="x/y"/><Override PartName="/'); for (let n = 0; n < 5; n++) yield chunk;
    yield encode('" ContentType="x/y"/><Default Extension="xml" ContentType="x/y; '); for (let n = 0; n < 5; n++) yield chunk;
    yield encode('=b"/></Types>');
  })();
  const index = await openRetainedContentTypes(input, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(await text(await index.get('/' + 'a'.repeat(5 * 16384)))).toBe('x/y');
  expect(await text(await index.get('/x.' + 'a'.repeat(5 * 16384)))).toBe('x/y');
  await index.close(); expect(await fs.readdir('/')).toEqual([]);
});
