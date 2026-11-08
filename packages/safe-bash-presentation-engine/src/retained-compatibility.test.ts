import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { parseXmlPart } from './xml.js';
import { interpretCompatibility } from './compatibility.js';
import { openRetainedXmlDocument, type RetainedXmlNode } from './retained-xml-document.js';
import { openRetainedCompatibility } from './retained-compatibility.js';
import { literal } from './retained-values.js';
const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006', p = 'http://purl.oclc.org/ooxml/presentationml/main';
const wrap = (body: string, controls = '') => `<p:sld xmlns:p="${p}" xmlns:mc="${mc}" xmlns:x="urn:future" ${controls}>${body}</p:sld>`;
const text = async (source: AsyncIterable<Uint8Array>) => { const decoder = new TextDecoder(); let result = ''; for await (const bytes of source) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); };
const cases = [
  wrap('<p:a/><p:b/>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="x"><x:new/></mc:Choice><mc:Fallback><p:old/></mc:Fallback></mc:AlternateContent><p:tail/>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="x"><x:new/></mc:Choice></mc:AlternateContent><p:tail/>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="p"><p:first/></mc:Choice><mc:Choice Requires="p"><p:second/></mc:Choice></mc:AlternateContent>'),
  wrap('<p:body xmlns:x="urn:other" xmlns:y="urn:future"><y:skip/><y:unwrap><p:visible y:flag="x"/></y:unwrap></p:body>', 'mc:Ignorable="x" mc:ProcessContent="x:unwrap"'),
  wrap('<x:any><p:visible/></x:any>', 'mc:Ignorable="x" mc:ProcessContent="x:*" mc:PreserveElements="x:*" mc:PreserveAttributes="x:a"'),
  wrap('<p:ext><x:payload/></p:ext>'), wrap('<x:opaque x:attr="1"><x:payload/></x:opaque>'),
  wrap('<p:a x:flag="1"/>'), wrap('<x:unexpected/>'), wrap('<p:a/>', 'mc:MustUnderstand="x"'),
  wrap('<p:a/>', 'mc:Ignorable="absent"'), wrap('<p:a/>', 'mc:Ignorable="p:bad"'),
  wrap('<p:a/>', 'mc:ProcessContent="x:unwrap"'), wrap('<p:a/>', 'mc:Unknown="x"'),
  wrap('<x:unwrap xml:lang="en"><p:visible/></x:unwrap>', 'mc:Ignorable="x" mc:ProcessContent="x:unwrap"'),
  wrap('<mc:AlternateContent/>'), wrap('<mc:Choice Requires="p"/>'),
  wrap('<mc:AlternateContent><mc:Choice/><mc:Fallback/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Choice Requires=""/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="absent"/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Fallback/><mc:Choice Requires="p"/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="p"/><mc:Fallback/><mc:Fallback/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent xml:lang="en"><mc:Choice Requires="p"/></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><x:ignored/><mc:Choice Requires="p"/></mc:AlternateContent>', 'mc:Ignorable="x"'),
  wrap('<mc:AlternateContent><x:unwrap/><mc:Choice Requires="p"/></mc:AlternateContent>', 'mc:Ignorable="x" mc:ProcessContent="x:unwrap"'),
  wrap('<mc:AlternateContent><mc:Choice Requires="x" mc:MustUnderstand="x"/><mc:Fallback><p:old/></mc:Fallback></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="p" mc:MustUnderstand="x"/></mc:AlternateContent>'),
  wrap('<p:ext mc:MustUnderstand="x"/>'), wrap('<x:opaque mc:MustUnderstand="x"/>')
];
cases.push(
  wrap('', 'mc:Ignorable="xmlns"'), wrap('', 'mc:Ignorable="mc"'), wrap('', 'mc:MustUnderstand="xml"'),
  wrap('', 'mc:Ignorable="x x" mc:PreserveElements="x:é"'), wrap('', 'mc:Ignorable="x" mc:ProcessContent="x:a:b"'),
  wrap('', 'mc:Ignorable="x" mc:ProcessContent="x:"'), wrap('', 'mc:Ignorable="x" mc:ProcessContent=":a"'),
  wrap('<x:skip><p:item mc:Unknown="bad"/></x:skip>', 'mc:Ignorable="x"'),
  wrap('<mc:AlternateContent><mc:Choice Requires="x"><x:item mc:Unknown="bad"/></mc:Choice><mc:Fallback><p:visible/></mc:Fallback></mc:AlternateContent>'),
  wrap('<mc:AlternateContent><mc:Choice Requires="p"><mc:AlternateContent><mc:Choice Requires="x"/><mc:Fallback><p:visible/></mc:Fallback></mc:AlternateContent></mc:Choice></mc:AlternateContent>')
);
for (const input of cases) it(`matches existing compatibility admission and visible tree: ${input}`, async () => {
  const opaque = [{ namespace: p, localName: 'ext' }, { namespace: 'urn:future', localName: 'opaque' }];
  const part = parseXmlPart(new TextEncoder().encode(input)); let expected, errorCode;
  try { expected = interpretCompatibility(part, [p], opaque); } catch (error) { errorCode = (error as { code: string }).code; }
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, doc = await openRetainedXmlDocument(literal(input), settings);
  let actual; try { actual = await openRetainedCompatibility(doc, [p], settings, opaque); } catch (error) { expect((error as { code: string }).code).toBe(errorCode); }
  if (actual) {
    expect(errorCode).toBeUndefined(); expect(actual.dialect).toBe(expected!.dialect);
    const oldTree = (node: typeof part.root): unknown => ({ name: node.name, attributes: expected!.attributes(node), children: expected!.children(node).map(oldTree) });
    const newTree = async (node: RetainedXmlNode): Promise<unknown> => {
      const attributes = [], children = [];
      for await (const attr of actual!.attributes(node)) attributes.push({ name: { namespace: await text(doc.namespace(attr)), localName: await text(doc.raw(attr.localName)) }, value: await text(doc.text(attr)) });
      for await (const child of actual!.children(node)) children.push(await newTree(child));
      return { name: { namespace: await text(doc.namespace(node)), localName: await text(doc.raw(node.localName)) }, attributes, children };
    };
    expect(await newTree(doc.root)).toEqual(oldTree(part.root));
    const alternatives = []; for await (const entry of actual.alternatives()) alternatives.push(entry.selected ? await text(doc.raw(entry.selected.localName)) : null);
    expect(alternatives).toEqual(expected!.alternatives.map(entry => entry.selected?.name.localName ?? null));
    await actual.close();
  } else expect(errorCode).toBeDefined();
  await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('spills large compatibility tokens and deep view indexes through bounded caller writes', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0;
  fs.readFile = async () => { throw new Error('whole-file reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { const size = parameters[0].length; written += size; pending += size; peak = Math.max(peak, pending); try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= size; } };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const source = (async function* () {
    const chunk = new Uint8Array(4096).fill(97);
    yield* literal(`<p:sld xmlns:p="${p}" xmlns:mc="${mc}" xmlns:`); for (let n = 0; n < 8; n++) yield chunk;
    yield* literal('="urn:future" mc:Ignorable="'); for (let n = 0; n < 8; n++) yield chunk;
    yield* literal('" mc:ProcessContent="'); for (let n = 0; n < 8; n++) yield chunk;
    yield* literal(':*"><'); for (let n = 0; n < 8; n++) yield chunk; yield* literal(':wrapper>');
    for (let n = 0; n < 512; n++) yield* literal('<p:child>'); yield* literal('<p:leaf/>'); for (let n = 0; n < 512; n++) yield* literal('</p:child>');
    yield* literal('</'); for (let n = 0; n < 8; n++) yield chunk; yield* literal(':wrapper></p:sld>');
  })();
  const settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, doc = await openRetainedXmlDocument(source, settings), before = written;
  const view = await openRetainedCompatibility(doc, [p], settings); expect(written).toBeGreaterThan(before + 16384); expect(peak).toBeLessThanOrEqual(16384);
  let node = doc.root, count = 0;
  for (;;) { const iterator = view.children(node), next = await iterator.next(); await iterator.return(undefined); if (next.done) break; node = next.value; count++; await Promise.resolve(); }
  expect(count).toBe(513); expect(await text(doc.raw(node.localName))).toBe('leaf');
  await view.close(); await expect(view.children(doc.root).next()).rejects.toMatchObject({ code: 'invalid-handle' });
  expect(await text(doc.namespace(doc.root))).toBe(p); await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('snapshots options while allowing asynchronous expansion of selected opaque containers', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/' } }, doc = await openRetainedXmlDocument(literal(wrap('<p:box><p:visible/></p:box><p:box><x:unknown/></p:box>')), settings);
  const supported = [p], opaque = [{ namespace: p, localName: 'box' }]; let calls = 0;
  const view = await openRetainedCompatibility(doc, supported, settings, opaque, async () => { supported.splice(0); opaque[0]!.localName = 'changed'; await Promise.resolve(); return ++calls === 1; });
  const children = []; for await (const child of view.children(doc.root)) children.push(child);
  const first = []; for await (const child of view.children(children[0]!)) first.push(await text(doc.raw(child.localName)));
  expect(first).toEqual(['visible']); expect((await view.children(children[1]!).next()).done).toBe(true);
  await expect(view.children({ ...doc.root }).next()).rejects.toMatchObject({ code: 'invalid-handle' });
  await view.close(); await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('retires compatibility storage on cancellation without taking ownership of the XML document', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, controller = new AbortController();
  const doc = await openRetainedXmlDocument(literal(wrap('<p:child/>'.repeat(512) + '<p:box/>')), settings);
  const files = await fs.readdir('/');
  await expect(openRetainedCompatibility(doc, [p], { ...settings, signal: controller.signal }, [{ namespace: p, localName: 'box' }], async () => { controller.abort(); return true; })).rejects.toMatchObject({ code: 'cancelled' });
  expect(await fs.readdir('/')).toEqual(files); expect(await text(doc.namespace(doc.root))).toBe(p);
  await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('preserves the primary profile error when retiring spilled compatibility storage fails', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const doc = await openRetainedXmlDocument(literal(wrap('<p:child/>'.repeat(512) + '<x:required/>')), settings), files = await fs.readdir('/');
  const open = fs.open!.bind(fs); let retired = 0;
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { await handle.close(...parameters).catch(() => {}); retired++; throw new Error('cleanup failed'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  await expect(openRetainedCompatibility(doc, [p], settings)).rejects.toMatchObject({ code: 'unsupported-profile' });
  expect(retired).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual(files);
  await doc.close(); expect(await fs.readdir('/')).toEqual([]);
});
