import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { validatePresentation, type ValidationLimits } from './validation.js';
import { openRetainedPresentationValidation } from './retained-validation.js';
import { fixture, read, xml, rels, tree, limits } from '../tests/fixtures/validation.js';
const all = async <T>(source: AsyncIterable<T>) => { const result: T[] = []; for await (const value of source) result.push(value); return result; };
const cases: Record<string, string | null>[] = [
  {}, { '_rels/.rels': rels([]) }, { '_rels/.rels': rels([['a', 'officeDocument', 'main.xml'], ['b', 'officeDocument', 'main.xml']]) },
  { '_rels/.rels': rels([['a', 'officeDocument', 'https://example.org/', 'External']]) }, { 'untyped.bin': 'bytes' },
  { '_rels/slide.xml.rels': rels([['bad', 'image', 'missing.xml']]) }, { 'slide.xml': xml('sld', '') },
  { 'slide.xml': xml('sld', tree() + tree()) }, { 'slide.xml': xml('notes', tree()) },
  { 'slide.xml': xml('sld', tree('1')) }, { 'slide.xml': xml('sld', tree('-1')) },
  { '_rels/layout.xml.rels': rels([]) }, { '_rels/slide.xml.rels': rels([]) },
  { 'master.xml': xml('sldMaster', tree() + '<p:clrMap/>') },
  { '_rels/notes.xml.rels': rels([['master', 'notesMaster', 'notes-master.xml']]) },
  { '_rels/notes.xml.rels': rels([['slide', 'slide', 'slide.xml']]) },
  { 'layout.xml': null, '_rels/layout.xml.rels': null }, { 'master.xml': null, '_rels/master.xml.rels': null },
  { 'slide.xml': xml('sld', tree() + '<p:timing><p:cTn id="1"/><p:cTn id="1"/><p:tn val="9"/><p:bldP spid="99"/></p:timing>') },
  { 'slide.xml': xml('sld', tree('2', '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3"/><p:cNvCxnSpPr><a:stCxn id="99" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr></p:cxnSp>')) }
];
for (const id of ['256','2147483647','+000256','2147483648','1e3','','-256','  +000256  ','000000000000000000000000256']) cases.push({ 'main.xml': xml('presentation', `<p:sldIdLst><p:sldId id="${id}" r:id="slide"/></p:sldIdLst><p:notesSz/>`) });
cases.push(
  { 'main.xml': xml('presentation', '<p:notesSz/><p:sldIdLst><p:sldId id="256" r:id="slide"/><p:sldId id="256" r:id="slide"/></p:sldIdLst>') },
  { 'main.xml': xml('presentation', '<p:notesSz/><p:notesMasterIdLst/><p:notesMasterIdLst><p:notesMasterId r:id="absent"/></p:notesMasterIdLst>') },
  { 'slide.xml': xml('sld', tree('2', '<p:extLst><p:ext uri="urn:test"><opaque xmlns="urn:test"><p:cNvPr id="2"/></opaque></p:ext></p:extLst>')) },
  { 'slide.xml': xml('sld', tree('2', '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p"><p:sp><p:nvSpPr><p:cNvPr id="3"/></p:nvSpPr></p:sp></mc:Choice><mc:Fallback><p:cNvPr id="2"/></mc:Fallback></mc:AlternateContent>')) },
  { 'slide.xml': xml('sld', tree('2', '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3"/><p:cNvCxnSpPr><a:stCxn id="2" idx="0"/><a:endCxn id="1" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr></p:cxnSp>') + '<p:timing><p:cTn id="1"/><p:tn val="1"/><p:bldP spid="2"/></p:timing>') }
);
const strict = fixture().toJSON();
cases.push(Object.fromEntries(Object.entries(strict).map(([name, text]) => [name.slice(6), text!.replaceAll('http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main').replaceAll('http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main').replaceAll('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships')])));
for (const [n, changes] of cases.entries()) it(`matches all validation results and their order for fixture ${n}`, async () => {
  const reader = read(fixture(changes)), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async byteLength(name: string) { return reader.get(name).length; }, read: (name: string) => (async function* () { yield reader.get(name); })() };
  const result = await openRetainedPresentationValidation(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, limits);
  expect({ valid: result.valid, schema: result.schema, rules: result.rules, issues: await all(result.issues()) }).toEqual(validatePresentation(reader, limits));
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(result.issues().next()).rejects.toMatchObject({ code: 'invalid-handle' });
});
for (const settings of [{ maxBytes: 100 }, { maxNodes: 20 }, { maxDepth: 2 }, { maxParts: 1 }, { maxRelationships: 1 }, { maxEntries: 1 }] satisfies Partial<ValidationLimits>[]) it(`preserves validation resource rejection: ${JSON.stringify(settings)}`, async () => {
  const reader = read(fixture()), fs = createMemoryFileSystem();
  expect(() => validatePresentation(reader, { ...limits, ...settings })).toThrow();
  const archive = { async *parts() { yield* reader.names; }, async byteLength(name: string) { return reader.get(name).length; }, read: (name: string) => (async function* () { yield reader.get(name); })() };
  await expect(openRetainedPresentationValidation(archive, { workingStorage: { fs, directory: '/' } }, { ...limits, ...settings })).rejects.toMatchObject({ code: 'resource-limit' });
  expect(await fs.readdir('/')).toEqual([]);
});

it('spills generated identifiers and traversal frames using bounded caller writes and reused source chunks', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0;
  fs.readFile = async () => { throw new Error('whole-file reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      const size = parameters[0].length; written += size; pending += size; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= size; }
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const longId = 'r'.repeat(32768), zeroes = '0'.repeat(32768);
  const changes = {
    'main.xml': xml('presentation', `<p:notesSz/><p:sldIdLst><p:sldId id="+${zeroes}256" r:id="${longId}"/></p:sldIdLst>`),
    '_rels/main.xml.rels': rels([[longId, 'slide', 'slide.xml']]),
    'slide.xml': xml('sld', tree('2', Array.from({ length: 256 }, (_, n) => `<p:sp><p:nvSpPr><p:cNvPr id="${n + 3}"/></p:nvSpPr></p:sp>`).join('')))
  };
  const reader = read(fixture(changes)), archive = {
    async *parts() { yield* reader.names; }, async byteLength(name: string) { return reader.get(name).length; },
    async *read(name: string) {
      const bytes = reader.get(name), chunk = new Uint8Array(1024);
      for (let offset = 0; offset < bytes.length; offset += chunk.length) {
        const length = Math.min(chunk.length, bytes.length - offset); chunk.set(bytes.subarray(offset, offset + length)); yield chunk.subarray(0, length); chunk.fill(255);
      }
    }
  };
  const result = await openRetainedPresentationValidation(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(result.valid).toBe(true); expect(await all(result.issues())).toEqual([]);
  expect(written).toBeGreaterThan(32768); expect(peak).toBeLessThanOrEqual(16384);
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
});

it.each(['cancel', 'read', 'profile'] as const)('retires all spilled indexes on %s failure during document admission', async (failure) => {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  const reader = read(fixture({ 'slide.xml': xml('sld', tree() + '<p:ext/>'.repeat(256) + (failure === 'profile' ? '<unknown xmlns="urn:required"/>' : '')) }));
  const archive = { async *parts() { yield* reader.names; }, async byteLength(name: string) { return reader.get(name).length; },
    async *read(name: string) {
      yield reader.get(name);
      if (name === '/slide.xml') {
        if (failure === 'cancel') controller.abort();
        if (failure === 'read') throw new Error('injected read failure');
      }
    }
  };
  await expect(openRetainedPresentationValidation(archive, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: failure === 'cancel' ? 'cancelled' : failure === 'profile' ? 'unsupported-profile' : 'io-failure' });
  expect(await fs.readdir('/')).toEqual([]);
});
