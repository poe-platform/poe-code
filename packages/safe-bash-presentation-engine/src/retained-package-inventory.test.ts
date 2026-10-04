import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { buildSelectionIndex } from './selectors.js';
import { openRetainedPackageInventory } from './retained-package-inventory.js';
import { fixture, read, rels } from '../tests/fixtures/validation.js';
async function text(source: AsyncIterable<Uint8Array>) { const decoder = new TextDecoder(); let result = ''; for await (const bytes of source) result += decoder.decode(bytes, { stream: true }); return result + decoder.decode(); }
async function all<T>(source: AsyncIterable<T>) { const result = []; for await (const value of source) result.push(value); return result; }
for (const changes of [{}, {
  'a.bin': 'a', 'z.bin': 'z',
  '_rels/opaque.xml.rels': rels([['z', 'image', 'z.bin'], ['a', 'hyperlink', 'https://example.org/', 'External'], ['b', 'image', 'missing.bin']])
}]) it('matches sorted part, media, relationship and unsupported metadata without retaining scalar values', async () => {
  const reader = read(fixture(changes)), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const expected = buildSelectionIndex(reader, 'a'.repeat(64)).inventory;
  const result = await openRetainedPackageInventory(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  for (const key of ['parts', 'media'] as const) {
    const actual = []; for await (const part of result[key]()) actual.push({ ...part, contentType: part.contentType ? await text(part.contentType()) : null });
    expect(actual).toEqual(expected[key]);
  }
  const relationships = []; for await (const edge of result.relationships()) relationships.push({ owner: edge.owner, external: edge.external, id: await text(edge.id()), type: await text(edge.type()), target: await text(edge.target()), targetPart: edge.targetPart ? await text(edge.targetPart()) : null });
  expect(relationships).toEqual(expected.relationships);
  const unsupported = []; for await (const item of result.unsupported()) unsupported.push({ part: item.part, reason: await text(item.reason()) });
  expect(unsupported).toEqual(expected.unsupported);
  for (const [kind, key] of [['slideMaster', 'masters'], ['slideLayout', 'layouts'], ['theme', 'themes']] as const) expect(await Promise.all((await all(result.targets(kind))).map(text))).toEqual(expected[key]);
  expect(result.counts).toEqual({ parts: expected.counts.parts, media: expected.counts.media, masters: expected.counts.masters, layouts: expected.counts.layouts, themes: expected.counts.themes });
  await result.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(result.parts().next()).rejects.toMatchObject({ code: 'invalid-handle' });
});

it('spills long scalar metadata and hashes reused member buffers with bounded caller IO', async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs); let written = 0, pending = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      const length = parameters[0].length; written += length; pending += length; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const id = 'z'.repeat(40000), type = 'image/example;parameter=' + 'a'.repeat(40000);
  const reader = read(fixture({ 'image.bin': 'unused', '_rels/opaque.xml.rels': rels([[id, 'image', 'image.bin']]),
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="${type}"/></Types>` }));
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); },
    async byteLength(part: string) { return part === '/image.bin' ? 262144 : reader.get(part).length; },
    async *read(part: string) {
      if (part !== '/image.bin') { yield reader.get(part); return; }
      const chunk = new Uint8Array(4096);
      for (let n = 0; n < 64; n++) { chunk.fill(n); yield chunk; chunk.fill(255); }
    }
  };
  const result = await openRetainedPackageInventory(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const image = (await all(result.media())).find(part => part.part === '/image.bin')!;
  expect(image.bytes).toBe(262144); expect(await text(image.contentType!())).toBe(type);
  const { sha256 } = await import('@noble/hashes/sha2.js'); const hash = sha256.create();
  for (let n = 0; n < 64; n++) hash.update(new Uint8Array(4096).fill(n));
  expect(image.sha256).toBe(Array.from(hash.digest(), value => value.toString(16).padStart(2, '0')).join(''));
  let found = false;
  for await (const edge of result.relationships()) if (edge.owner === '/opaque.xml') {
    let size = 0; for await (const bytes of edge.id()) { await Promise.resolve(); expect(bytes.every(value => value === 122)).toBe(true); size += bytes.length; }
    expect(size).toBe(40000); found = true;
  }
  expect(found).toBe(true); expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
  await result.close(); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['source', 'storage', 'cancel'] as const) it(`retires scratch after ${mode} failure`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), reader = read(fixture(mode === 'storage' ? {
    '_rels/opaque.xml.rels': rels([['x'.repeat(40000), 'image', 'missing.bin']])
  } : {}));
  if (mode === 'storage') {
    const open = fs.open!.bind(fs);
    fs.open = async (...args) => { const handle = await open(...args); return new Proxy(handle, { get(target, key) {
      if (key === 'write') return async () => { throw new Error('injected write failure'); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } }); };
  }
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); },
    async byteLength(part: string) { return reader.get(part).length; },
    async *read(part: string) {
      if (part === '/opaque.xml') {
        if (mode === 'source') throw new Error('injected source failure');
        if (mode === 'cancel') controller.abort();
        const chunk = new Uint8Array(4096).fill(97); for (let n = 0; n < 64; n++) yield chunk;
      } else yield reader.get(part);
    }
  };
  await expect(openRetainedPackageInventory(archive, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } })).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  expect(await fs.readdir('/')).toEqual([]);
});
