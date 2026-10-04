import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedXmlReplacement } from './retained-xml-replacement.js';
import { openPackageArchive } from './retained-package.js';
import { replaceXmlPart } from './xml-parts.js';
import { readPackage } from './package-reader.js';
import { resourceContext } from './resource-limits.js';
import { parseXmlPart, type XmlElement } from './xml.js';
import { createDeckFixture } from '../tests/fixtures/decks.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
const part = '/ppt/slides/slide1.xml';
const limits = { maxBytes: 100000, maxNodes: 5000, maxDepth: 60, maxParts: 100, maxRelationships: 100, maxEntries: 100 };
function deck(changes: Record<string, string | Uint8Array> = {}) { const { volume, root } = createDeckFixture('seed-library'); for (const [name, content] of Object.entries(changes)) { const path = root + name; volume.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true }); volume.writeFileSync(path, content); } return storedArchive(Object.keys(volume.toJSON()).map(path => ({ name: path.slice(root.length + 1), bytes: new Uint8Array(volume.readFileSync(path) as Buffer) }))); }
async function collect(source: AsyncIterable<Uint8Array>) { const chunks: Uint8Array[] = []; for await (const bytes of source) chunks.push(bytes); return Buffer.concat(chunks); }
function find(root: XmlElement, name: string): XmlElement { if (root.name.localName === name) return root; for (const child of root.children) { const result = find(child, name); if (result) return result; } return undefined!; }
for (const kind of ['unchanged', 'text', 'remove-run', 'reorder', 'remove-shape', 'root', 'namespace', 'resource', 'opaque', 'insert', 'malformed'] as const) it(`matches complete buffered XML replacement admission: ${kind}`, async () => {
  const input = deck(), before = await readPackage(input), original = before.get(part), text = new TextDecoder().decode(original);
  const doc = parseXmlPart(original), tree = find(doc.root, 'spTree'), paragraph = find(doc.root, 'p');
  const replacement = kind === 'remove-run' ? doc.spliceChildren(paragraph, 0, 1, []).bytes()
    : kind === 'reorder' ? doc.reorderChildren(tree, [...tree.children.slice(0, 2), tree.children[3]!, tree.children[2]!, ...tree.children.slice(4)]).bytes()
    : kind === 'remove-shape' ? doc.spliceChildren(tree, 2, 1, []).bytes()
    : encode(kind === 'text' ? text.replace('Borrow seeds.', 'Share seeds.') : kind === 'root' ? text.replaceAll('p:sld', 'p:notes')
      : kind === 'namespace' ? text.replace('xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"', 'xmlns:c="urn:changed"')
      : kind === 'resource' ? text.replace('r:embed="rId2"', 'r:embed="absent"') : kind === 'opaque' ? text.replace('r:id="rId3"', 'r:id="rId2"')
      : kind === 'insert' ? text.replace('</p:spTree>', '<p:unknown/></p:spTree>') : kind === 'malformed' ? '<bad>' : text);
  let expected: Uint8Array | undefined, error: unknown;
  try { expected = await replaceXmlPart(input, part, replacement, { ...resourceContext({}), validationLimits: limits }); } catch (caught) { error = caught; }
  const fs = createMemoryFileSystem(), settings = { validationLimits: limits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings);
  try {
    const run = openRetainedXmlReplacement(archive, part, (async function* () { yield replacement; })(), settings);
    if (error) await expect(run).rejects.toMatchObject({ code: (error as { code: string }).code });
    else {
      const result = await run;
      try {
        expect(result.changed).toBe(!Buffer.from(original).equals(replacement));
        const after = await readPackage(expected!);
        for (const name of before.names) expect(await collect(result.read(name))).toEqual(Buffer.from(after.get(name)));
        expect(await result.replacement('/[Content_Types].xml')).toBeUndefined();
      } finally { await result.close(); }
    }
  } finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['protected', 'signature', 'macro', 'dangling', 'opaque-kept', 'opaque-changed', 'namespace-order', 'utf16', 'strict'] as const) it(`preserves package and lexical guards: ${mode}`, async () => {
  const baseline = await readPackage(deck()), decoder = new TextDecoder();
  const original = decoder.decode(baseline.get(part)); let input = deck(), replacement = encode(original.replace('Borrow seeds.', 'Share seeds.'));
  if (mode === 'protected') input = deck({ '/ppt/presentation.xml': decoder.decode(baseline.get('/ppt/presentation.xml')).replace('</p:presentation>', '<p:modifyVerifier/></p:presentation>') });
  if (mode === 'signature' || mode === 'macro') input = deck({ '/[Content_Types].xml': decoder.decode(baseline.get('/[Content_Types].xml')).replace('</Types>', `<Override PartName="/guard.xml" ContentType="application/${mode === 'signature' ? 'digital-signature' : 'vbaproject'}+xml"/></Types>`), '/guard.xml': '<guard/>' });
  if (mode === 'dangling') { const xml = original.replace('r:id="rId3"', 'r:id="absent"'); input = deck({ [part]: xml }); replacement = encode(xml.replace('Borrow seeds.', 'Share seeds.')); }
  if (mode.startsWith('opaque')) { const xml = original.replace('</p:sld>', '<p:extLst><p:ext uri="test"><x:item xmlns:x="urn:opaque">unchanged</x:item></p:ext></p:extLst></p:sld>'); input = deck({ [part]: xml }); replacement = encode(xml.replace('Borrow seeds.', 'Share seeds.').replace('>unchanged<', mode === 'opaque-changed' ? '>changed<' : '>unchanged<')); }
  if (mode === 'namespace-order') { const ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'; replacement = encode(original.replace(ns, '').replace('<p:sld ', `<p:sld ${ns} `).replace('Borrow seeds.', 'Share seeds.')); }
  if (mode === 'utf16') { const text = decoder.decode(replacement).replace('UTF-8', 'UTF-16').replace('utf-8', 'utf-16'); const bytes = new Uint8Array(2 + text.length * 2), view = new DataView(bytes.buffer); view.setUint16(0, 0xfeff, true); for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), true); replacement = bytes; }
  if (mode === 'strict') {
    const convert = (text: string) => text.replaceAll('http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main').replaceAll('http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main').replaceAll('http://schemas.openxmlformats.org/drawingml/2006/chart', 'http://purl.oclc.org/ooxml/drawingml/chart').replaceAll('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships');
    input = deck(Object.fromEntries(baseline.names.filter(name => name.endsWith('.xml') || name.endsWith('.rels')).map(name => [name, convert(decoder.decode(baseline.get(name)))]))); replacement = encode(convert(decoder.decode(replacement)));
  }
  let expected: Uint8Array | undefined, failure: unknown;
  try { expected = await replaceXmlPart(input, part, replacement, { ...resourceContext({}), validationLimits: limits }); } catch (error) { failure = error; }
  const fs = createMemoryFileSystem(), settings = { validationLimits: limits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings);
  try {
    const result = openRetainedXmlReplacement(archive, part, (async function* () { for (let p = 0; p < replacement.length; p += 257) yield replacement.subarray(p, p + 257); })(), settings);
    if (failure) await expect(result).rejects.toMatchObject({ code: (failure as { code: string }).code });
    else { const mutation = await result; try { expect(await collect(mutation.read(part))).toEqual(Buffer.from((await readPackage(expected!)).get(part))); } finally { await mutation.close(); } }
  } finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'source', 'storage', 'cancel', 'limit'] as const) it(`retains large replacements with bounded storage and cleanup: ${mode}`, async () => {
  const input = deck(), original = (await readPackage(input)).get(part), replacement = encode(new TextDecoder().decode(original).replace('Borrow seeds.', '港 &amp; 😀 '.repeat(5000)));
  const owner = createMemoryFileSystem(), controller = new AbortController(); let armed = false, written = 0, outstanding = 0, peak = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-payload read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          if (armed && mode === 'storage') throw new Error('injected storage failure');
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); written += args[0].length; return await handle.write(...args); } finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const settings = { signal: controller.signal, validationLimits: { ...limits, maxBytes: mode === 'limit' ? 50000 : Infinity }, workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings); armed = true;
  const buffer = new Uint8Array(16384);
  async function* source() { for (let offset = 0; offset < replacement.length; offset += buffer.length) { if (offset && mode === 'source') throw new Error('injected source failure'); if (offset && mode === 'cancel') controller.abort(); const size = Math.min(buffer.length, replacement.length - offset); buffer.set(replacement.subarray(offset, offset + size)); yield buffer.subarray(0, size); buffer.fill(255); } }
  try {
    const run = openRetainedXmlReplacement(archive, part, source(), settings);
    if (mode === 'source') await expect(run).rejects.toMatchObject({ code: 'io-failure', phase: 'admit' });
    else if (mode === 'storage') await expect(run).rejects.toBeDefined();
    else if (mode === 'cancel') await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    else if (mode === 'limit') await expect(run).rejects.toMatchObject({ code: 'resource-limit' });
    else {
      const result = await run;
      try {
        const output: Uint8Array[] = []; for await (const bytes of result.read(part)) { expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); output.push(new Uint8Array(bytes)); }
        expect(Buffer.concat(output)).toEqual(Buffer.from(replacement));
        const chunks: Uint8Array[] = []; await archive.rewrite({ async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, { replace: result.replacement });
        const after = await readPackage(Buffer.concat(chunks)), baseline = await readPackage(input); expect(after.get(part)).toEqual(replacement);
        for (const name of after.names) if (name !== part) expect(after.get(name)).toEqual(baseline.get(name));
      } finally { await result.close(); }
      await expect(result.replacement(part)).rejects.toMatchObject({ code: 'invalid-handle' });
      expect(written).toBeGreaterThan(16384 * 4);
    }
  } finally { await archive.close(); }
  expect(peak).toBeLessThanOrEqual(16384); expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['read-limit', 'invalid-chunk', 'missing', 'too-large', 'source-failure'] as const) it(`preserves byte admission diagnostics and iterator cleanup: ${mode}`, async () => {
  const input = deck(), original = (await readPackage(input)).get(part), fs = createMemoryFileSystem(); let closed = 0;
  const makeSource = () => ({ [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> {
    if (mode === 'invalid-chunk') return { done: false, value: 42 as unknown as Uint8Array };
    if (mode === 'missing' || mode === 'too-large') throw Object.assign(new Error('private path'), { code: mode === 'missing' ? 'ENOENT' : 'EFBIG' });
    if (mode === 'source-failure') throw new Error('private host diagnostics');
    return { done: false, value: original };
  }, async return() { closed++; throw new Error('cleanup must not mask admission'); } }; } });
  const settings = { ...resourceContext({ limits: { maxReads: 1 } }), validationLimits: limits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  let error: unknown; try { await replaceXmlPart(input, part, makeSource(), settings); } catch (caught) { error = caught; }
  const archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings);
  try { await expect(openRetainedXmlReplacement(archive, part, makeSource(), settings)).rejects.toMatchObject({ code: (error as { code: string }).code, phase: 'admit' }); }
  finally { await archive.close(); }
  expect(closed).toBe(2); expect(await fs.readdir('/')).toEqual([]);
});

for (const insert of [false, true]) it(`accounts for repeated identical children without reusing matches: insert ${insert}`, async () => {
  const baseline = await readPackage(deck()), doc = parseXmlPart(baseline.get(part)), run = find(doc.root, 'r'), markup = doc.markup(run);
  const input = deck({ [part]: new TextDecoder().decode(baseline.get(part)).replace(markup, markup.repeat(40)) });
  const original = (await readPackage(input)).get(part), document = parseXmlPart(original), paragraph = find(document.root, 'p');
  const replacement = insert ? encode(new TextDecoder().decode(original).replace(markup, markup + markup)) : document.spliceChildren(paragraph, 2, 20, []).bytes();
  let expected: Uint8Array | undefined, failure: unknown;
  try { expected = await replaceXmlPart(input, part, replacement, { ...resourceContext({}), validationLimits: limits }); } catch (error) { failure = error; }
  const fs = createMemoryFileSystem(), settings = { validationLimits: limits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings);
  try {
    const result = openRetainedXmlReplacement(archive, part, (async function* () { yield replacement; })(), settings);
    if (failure) await expect(result).rejects.toMatchObject({ code: (failure as { code: string }).code });
    else { const mutation = await result; try { expect(await collect(mutation.read(part))).toEqual(Buffer.from((await readPackage(expected!)).get(part))); } finally { await mutation.close(); } }
  } finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['header', 'picture', 'opaque-frame', 'paragraph-order', 'unknown-attribute', 'opaque-duplicate-remove', 'opaque-duplicate-reorder'] as const) it(`retains structural safety guard: ${mode}`, async () => {
  const baseline = await readPackage(deck()); let document = parseXmlPart(baseline.get(part)), input = deck();
  let tree = find(document.root, 'spTree'), paragraph = find(document.root, 'p');
  if (mode === 'unknown-attribute') { document = document.merge(tree.children[2]!, { attributes: [{ namespace: 'urn:custom-state', localName: 'marker', value: 'keep' }] }); tree = find(document.root, 'spTree'); input = deck({ [part]: document.bytes() }); }
  if (mode.startsWith('opaque-duplicate')) {
    const run = '<a:r xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:u="urn:opaque-run" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u" u:state="keep"><a:t>Repeated text</a:t></a:r>';
    document = document.spliceChildren(paragraph, 0, 1, [run, run, '<a:br xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>']); paragraph = find(document.root, 'p'); input = deck({ [part]: document.bytes() });
  }
  const replacement = mode === 'header' ? document.spliceChildren(tree, 0, 1, []).bytes()
    : mode === 'picture' ? document.spliceChildren(tree, 3, 1, []).bytes()
    : mode === 'opaque-frame' ? document.spliceChildren(tree, tree.children.findIndex(child => child.name.localName === 'graphicFrame'), 1, []).bytes()
    : mode === 'unknown-attribute' ? document.spliceChildren(tree, 2, 1, []).bytes()
    : mode === 'opaque-duplicate-remove' ? document.spliceChildren(paragraph, 1, 1, []).bytes()
    : mode === 'opaque-duplicate-reorder' ? document.reorderChildren(paragraph, [paragraph.children[0]!, paragraph.children[2]!, paragraph.children[1]!, ...paragraph.children.slice(3)]).bytes()
    : document.reorderChildren(paragraph, [...paragraph.children].reverse()).bytes();
  let failure: unknown; try { await replaceXmlPart(input, part, replacement, { ...resourceContext({}), validationLimits: limits }); } catch (error) { failure = error; }
  expect(failure).toBeDefined();
  const fs = createMemoryFileSystem(), settings = { validationLimits: limits, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, archive = await openPackageArchive({ size: input.length, async read(p, n) { return input.subarray(p, p + n); } }, settings);
  try { await expect(openRetainedXmlReplacement(archive, part, (async function* () { yield replacement; })(), settings)).rejects.toMatchObject({ code: (failure as { code: string }).code }); }
  finally { await archive.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
