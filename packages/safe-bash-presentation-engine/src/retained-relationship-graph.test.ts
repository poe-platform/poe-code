import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedRelationshipGraph } from './retained-relationship-graph.js';
import { literal } from './retained-values.js';
import { readRelationshipGraph } from './relationships.js';
const all = async <T>(source: AsyncIterable<T>): Promise<T[]> => { const values: T[] = []; for await (const value of source) values.push(value); return values; };
const encode = (value: string) => new TextEncoder().encode(value);
const xml = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const rel = (id: string, target: string, external = false) => `<Relationship Id="${id}" Type="type" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;
const fixture = (entries: Record<string, string>) => ({
  async *parts() { yield* Object.keys(entries); }, async byteLength(part: string) { return encode(entries[part]!).length; }, read: (part: string) => literal(entries[part]!)
});
const text = async (source: AsyncIterable<Uint8Array>) => { const decoder = new TextDecoder(); let value = ''; for await (const chunk of source) value += decoder.decode(chunk, { stream: true }); return value + decoder.decode(); };
it('preserves part order, outgoing/incoming edges, canonical names, dangling targets and DFS closure', async () => {
  const entries = { '/[Content_Types].xml': '', '/ppt/A.xml': '', '/ppt/B.xml': '', '/ppt/C.xml': '',
    '/_rels/.rels': xml(rel('root', 'PPT/a.xml')), '/ppt/_rels/A.xml.rels': xml(rel('b', 'b.xml') + rel('c', 'C.xml') + rel('url', 'https://example.org/', true)),
    '/ppt/_rels/B.xml.rels': xml(rel('cycle', 'A.xml')), '/ppt/_rels/C.xml.rels': xml(rel('absent', 'missing.xml')) };
  const baseline = readRelationshipGraph({ names: Object.keys(entries), get: name => encode(entries[name as keyof typeof entries]), has: () => true, relsXmlFor: () => null });
  const fs = createMemoryFileSystem(), graph = await openRetainedRelationshipGraph(fixture(entries), { workingStorage: { fs, directory: '/' } });
  expect(await all(graph.parts())).toEqual(baseline.parts);
  const collect = async (edges: ReturnType<typeof graph.outgoing>) => { const result = []; for await (const edge of edges) result.push({ owner: edge.owner, id: await text(edge.id()), type: await text(edge.type()), target: await text(edge.target()), external: edge.external, targetPart: edge.targetPart ? await text(edge.targetPart()) : null }); return result; };
  for (const part of ['/', ...baseline.parts]) expect(await collect(graph.outgoing(part))).toEqual(baseline.outgoing(part));
  expect(await collect(graph.incoming('/PPT/b.xml'))).toEqual(baseline.incoming('/ppt/B.xml'));
  expect(await collect(graph.dangling())).toEqual(baseline.dangling);
  await expect(all(graph.closure(['/']))).rejects.toMatchObject({ code: 'missing-binding' });
  await graph.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('traverses cycles in stable depth-first order and supports independently retired closure iterators', async () => {
  const entries = { '/a': '', '/b': '', '/c': '', '/_rels/.rels': xml(rel('a', 'a') + rel('c', 'c')), '/_rels/a.rels': xml(rel('b', 'b') + rel('c', 'c')), '/_rels/b.rels': xml(rel('a', 'a')) };
  const fs = createMemoryFileSystem(), graph = await openRetainedRelationshipGraph(fixture(entries), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(await all(graph.closure(['/']))).toEqual(['/a', '/b', '/c']);
  const first = graph.closure(['/']), second = graph.closure(['/c']);
  expect((await first.next()).value).toBe('/a'); expect((await second.next()).value).toBe('/c'); await first.return(undefined); await second.return(undefined);
  await graph.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(graph.parts().next()).rejects.toMatchObject({ code: 'invalid-handle' });
});
it('enforces cumulative relationship bytes, counts, parts and owner existence', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/' } }, entries = { '/a': '', '/b': '', '/_rels/a.rels': xml(rel('b', 'b')), '/_rels/b.rels': xml(rel('a', 'a')) };
  for (const relationshipLimits of [{ maxParts: 1 }, { maxRelationships: 1 }, { maxBytes: encode(entries['/_rels/a.rels']).length + 1 }])
    await expect(openRetainedRelationshipGraph(fixture(entries), { ...settings, relationshipLimits })).rejects.toMatchObject({ code: 'resource-limit' });
  await expect(openRetainedRelationshipGraph(fixture({ '/_rels/absent.rels': xml('') }), settings)).rejects.toMatchObject({ code: 'missing-binding' });
  expect(await fs.readdir('/')).toEqual([]);
});
it('spills generated graph indexes and traversal state with bounded outstanding IO and slow consumers', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0;
  fs.readFile = async () => { throw new Error('whole-file reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => { const size = parameters[0].length; written += size; pending += size; peak = Math.max(peak, pending); try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= size; } };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const count = 512, header = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">', footer = '</Relationships>';
  let bytes = encode(header + footer).length; for (let n = 0; n < count; n++) bytes += encode(rel(`r${n}`, `p${n}`)).length;
  const archive = {
    async *parts() { yield '/_rels/.rels'; for (let n = 0; n < count; n++) yield `/p${n}`; },
    async byteLength() { return bytes; },
    read: () => (async function* () {
      yield* literal(header); const reused = new Uint8Array(256);
      for (let n = 0; n < count; n++) { const data = encode(rel(`r${n}`, `p${n}`)); reused.fill(0); reused.set(data); yield reused.subarray(0, data.length); }
      yield* literal(footer);
    })()
  };
  const graph = await openRetainedRelationshipGraph(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  expect(graph.partCount).toBe(count); expect(graph.relationshipCount).toBe(count); expect(written).toBeGreaterThan(16384);
  const beforeClosure = written; let seen = 0;
  for await (const part of graph.closure(['/'])) { expect(part).toBe(`/p${seen++}`); await Promise.resolve(); }
  expect(seen).toBe(count); expect(written).toBeGreaterThan(beforeClosure); expect(peak).toBeLessThanOrEqual(16384);
  const edge = await graph.get('/', 'r500'); expect(await text(edge!.targetPart!())).toBe('/p500');
  await graph.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('preserves per-edge spelling for absent targets sharing a case-insensitive incoming bucket', async () => {
  const fs = createMemoryFileSystem(), graph = await openRetainedRelationshipGraph(fixture({ '/_rels/.rels': xml(rel('one', 'Missing') + rel('two', 'missing')) }), { workingStorage: { fs, directory: '/' } });
  const names = []; for await (const edge of graph.incoming('/MISSING')) names.push(await text(edge.targetPart!()));
  expect(names).toEqual(['/Missing', '/missing']); await graph.close();
});
it('preserves source failures and cancellation and retires graph/closure storage', async () => {
  const fs = createMemoryFileSystem(), settings = { workingStorage: { fs, directory: '/', cacheBytes: 16384 } };
  const source = fixture({ '/a': '', '/_rels/.rels': xml(rel('a', 'a')) });
  const failed = { ...source, read: () => (async function* () { yield* literal('<Relationships'); throw new Error('source failed'); })() };
  await expect(openRetainedRelationshipGraph(failed, settings)).rejects.toMatchObject({ code: 'io-failure' });
  expect(await fs.readdir('/')).toEqual([]);
  const controller = new AbortController(), graph = await openRetainedRelationshipGraph(source, { ...settings, signal: controller.signal });
  const traversal = graph.closure(['/']); expect((await traversal.next()).value).toBe('/a'); controller.abort();
  await expect(traversal.next()).rejects.toMatchObject({ code: 'cancelled' }); await graph.close(); expect(await fs.readdir('/')).toEqual([]);
});
it('preserves graph admission errors when retiring spilled descriptors also fails', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let retired = 0;
  fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { await handle.close(...parameters).catch(() => {}); retired++; throw new Error('cleanup failed'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const archive = { async *parts() { for (let n = 0; n < 512; n++) yield `/p${n}`; yield '/_rels/absent.rels'; }, async byteLength() { return encode(xml('')).length; }, read: () => literal(xml('')) };
  await expect(openRetainedRelationshipGraph(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: 'missing-binding' });
  expect(retired).toBeGreaterThan(0); expect(await fs.readdir('/')).toEqual([]);
});
