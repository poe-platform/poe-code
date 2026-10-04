import { expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedXmlDocument } from './retained-xml-document.js';
const encode = (text: string) => new TextEncoder().encode(text);
const source = (text: string) => (async function* () { yield encode(text); })();
async function collect(source: AsyncIterable<Uint8Array>) { const decoder = new TextDecoder(); let value = ''; for await (const bytes of source) value += decoder.decode(bytes, { stream: true }); return value + decoder.decode(); }
for (const markup of [
  '<root a="&amp;">before<child/>after<!--keep--><![CDATA[raw]]><?pi data?><last>text</last></root >',
  '<root xmlns="urn:root" xmlns:p="urn:p"><p:child xmlns:p="urn:inner"><grand /></p:child><p:last/></root>',
  '<港 a="😀">\r\n<😀child/>\r\n</港>'.replace('😀child', '𐀀child'),
  '<root />', '<root></root>'
]) it(`retains exact markup and element shells: ${markup}`, async () => {
  const fs = createMemoryFileSystem();
  const doc = await openRetainedXmlDocument(source(markup), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  try {
    expect(await collect(doc.markup(doc.root))).toBe(markup);
    let expected = markup;
    for await (const child of doc.children(doc.root)) if (child.kind === 'element') expected = expected.replace(await collect(doc.markup(child)), '');
    expect(await collect(doc.shell(doc.root))).toBe(expected);
    const names = []; for await (const node of doc.elements(doc.root)) names.push(await collect(doc.raw(node.name)));
    expect(names[0]).toBe(await collect(doc.raw(doc.root.name)));
    const declarations = [];
    for await (const node of doc.declarations(doc.root)) declarations.push([await collect(doc.raw(node.name)), await collect(doc.text(node))]);
    expect(declarations).toEqual(markup.includes('xmlns') ? [['xmlns', 'urn:root'], ['xmlns:p', 'urn:p']] : []);
  } finally { await doc.close(); }
  await expect(collect(doc.markup(doc.root))).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await fs.readdir('/')).toEqual([]);
});

it('rejects foreign and non-element handles for markup, shells and element traversal', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/' } };
  const doc = await openRetainedXmlDocument(source('<root attr="x">text</root>'), settings), other = await openRetainedXmlDocument(source('<other/>'), settings);
  try {
    const attribute = (await doc.attributes(doc.root).next()).value!;
    for (const node of [other.root, attribute]) for (const method of ['markup', 'shell', 'elements', 'declarations'] as const)
      await expect(async () => { for await (const ignored of doc[method](node)) { /* consume admission */ } }).rejects.toMatchObject({ code: 'invalid-handle' });
  } finally { await Promise.all([doc.close(), other.close()]); }
});

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) it(`preserves decoded lexical bytes from ${encoding}`, async () => {
  const markup = '<root q="&quot;">港\r\n<child/>😀</root >';
  const declaration = `<?xml version="1.0" encoding="${encoding === 'utf-8' ? encoding : 'utf-16'}"?>`;
  let bytes: Uint8Array;
  if (encoding === 'utf-8') bytes = new Uint8Array([239, 187, 191, ...encode(declaration + markup)]);
  else { const text = declaration + markup; bytes = new Uint8Array(2 + text.length * 2); const view = new DataView(bytes.buffer); view.setUint16(0, 0xfeff, encoding === 'utf-16le'); for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), encoding === 'utf-16le'); }
  const doc = await openRetainedXmlDocument((async function* () { for (let offset = 0; offset < bytes.length; offset += 3) yield bytes.subarray(offset, offset + 3); })(), { workingStorage: { fs: createMemoryFileSystem(), directory: '/', cacheBytes: 16384 } });
  try { expect(await collect(doc.markup(doc.root))).toBe(markup); expect(await collect(doc.shell(doc.root))).toBe(markup.replace('<child/>', '')); }
  finally { await doc.close(); }
});

for (const mode of ['success', 'cancel', 'storage', 'closed'] as const) it(`streams deep wide markup with bounded caller IO and cleanup: ${mode}`, async () => {
  const owner = createMemoryFileSystem(), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole payload read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          if (mode === 'storage') throw new Error('injected storage failure');
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); written += args[0].length; return await handle.write(...args); }
          finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const repeats = 200, depth = 80, chunk = new Uint8Array(16384).fill(120);
  async function* generated() {
    yield encode('<root>'); for (let i = 0; i < depth; i++) yield encode('<deep>');
    for (let i = 0; i < repeats; i++) { yield encode('<child>'); chunk.fill(97 + i % 26); yield chunk; chunk.fill(255); yield encode('</child>'); }
    for (let i = 0; i < depth; i++) yield encode('</deep>'); yield encode('</root>');
  }
  const expected = sha256.create(), actual = sha256.create();
  async function* input() { for await (const bytes of generated()) { expected.update(bytes); yield bytes; } }
  const run = openRetainedXmlDocument(input(), { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode === 'storage') await expect(run).rejects.toMatchObject({ code: 'io-failure' });
  else {
    const doc = await run;
    try {
      let count = 0, total = 0;
      for await (const node of doc.elements(doc.root)) { expect(node.kind).toBe('element'); count++; }
      expect(count).toBe(1 + depth + repeats);
      const stream = doc.markup(doc.root); let first = true;
      const consume = async () => { for await (const bytes of stream) { expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); total += bytes.length; actual.update(bytes); if (first && mode === 'cancel') controller.abort(); if (first && mode === 'closed') await doc.close(); first = false; } };
      if (mode === 'cancel' || mode === 'closed') await expect(consume()).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'invalid-handle' });
      else { await consume(); expect(total).toBe(13 + depth * 13 + repeats * (15 + chunk.length)); expect(await collect(doc.shell(doc.root))).toBe('<root></root>'); expect(actual.digest()).toEqual(expected.digest()); }
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
    } finally { await doc.close(); }
  }
  expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
