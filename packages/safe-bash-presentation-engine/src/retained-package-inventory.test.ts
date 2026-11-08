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

for (const reverse of [false, true]) it(`retains diagram kind precedence and sorted cyclic dependencies, reversed ${reverse}`, async () => {
  const incoming = [['z', 'diagramColors', 'data.xml'], ['a', 'diagramData', 'data.xml']];
  if (reverse) incoming.reverse();
  const reader = read(fixture({
    'data.xml': '<data/>', 'resource.xml': '<resource/>',
    '_rels/opaque.xml.rels': rels(incoming),
    '_rels/data.xml.rels': rels([['b', 'diagramLayout', 'resource.xml'], ['a', 'image', 'missing.bin'], ['c', 'image', 'missing.bin'], ['d', 'image', 'https://example.org/', 'External']]),
    '_rels/resource.xml.rels': rels([['cycle', 'diagramData', 'data.xml'], ['missing', 'image', 'other.bin']])
  })), fs = createMemoryFileSystem();
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
  const expected = buildSelectionIndex(reader, 'a'.repeat(64)).inventory.diagrams;
  const inventory = await openRetainedPackageInventory(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  const actual = [];
  for await (const diagram of inventory.diagrams()) actual.push({ ...diagram,
    owners: await Promise.all((await all(diagram.owners())).map(text)),
    dependencies: await Promise.all((await all(diagram.dependencies())).map(text)),
    missing: await Promise.all((await all(diagram.missing())).map(text))
  });
  expect(actual).toEqual(expected);
  await inventory.close(); expect(await fs.readdir('/')).toEqual([]);
  await expect(inventory.diagrams().next()).rejects.toMatchObject({ code: 'invalid-handle' });
});

it('prefers each exact diagram MIME type over conflicting incoming relationships', async () => {
  const { diagramContentTypes } = await import('./diagram-resources.js');
  for (const [kind, type] of Object.entries(diagramContentTypes)) {
    const volume = fixture({ 'data.xml': '<data/>', '_rels/opaque.xml.rels': rels([['data', 'diagramData', 'data.xml']]) });
    const manifest = volume.readFileSync('/deck/[Content_Types].xml', 'utf8') as string;
    volume.writeFileSync('/deck/[Content_Types].xml', manifest.slice(0, -8) + `<Override PartName="/data.xml" ContentType="${type}"/></Types>`);
    const reader = read(volume), fs = createMemoryFileSystem();
    const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); }, async byteLength(part: string) { return reader.get(part).length; }, async *read(part: string) { yield reader.get(part); } };
    const inventory = await openRetainedPackageInventory(archive, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
    expect((await all(inventory.diagrams())).map(({ part, kind }) => ({ part, kind }))).toEqual([{ part: '/data.xml', kind }]);
    await inventory.close(); expect(await fs.readdir('/')).toEqual([]);
  }
});

for (const mode of ['success', 'read', 'write', 'cancel'] as const) it(`uses bounded caller storage for a large diagram closure: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController();
  let phase = false, written = 0, pending = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide reads forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'read' && phase && mode === 'read') return async () => { throw new Error('injected diagram read failure'); };
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (phase && mode === 'write') throw new Error('injected diagram write failure');
      if (phase && mode === 'cancel') controller.abort();
      const length = parameters[0].length; if (phase) written += length;
      pending += length; peak = Math.max(peak, pending);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { pending -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const changes: Record<string, string> = {
    'data.xml': '<data/>', '_rels/opaque.xml.rels': rels([['d', 'diagramData', 'data.xml']]),
    '_rels/data.xml.rels': rels([['first', 'image', 'node0.xml'], ['lost', 'image', 'unused']])
  };
  for (let n = 0; n < 128; n++) {
    changes[`node${n}.xml`] = '<node/>';
    changes[`_rels/node${n}.xml.rels`] = rels([['next', 'image', n === 127 ? 'data.xml' : `node${n + 1}.xml`]]);
  }
  const reader = read(fixture(changes)), encode = (value: string) => new TextEncoder().encode(value);
  const archive = { async *parts() { yield* reader.names; }, async has(part: string) { return reader.has(part); },
    async byteLength(part: string) { if (part === '/data.xml') phase = true; return reader.get(part).length; },
    async *read(part: string) {
      if (part !== '/_rels/data.xml.rels') { yield reader.get(part); return; }
      yield encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="node0.xml"/><Relationship Id="lost" Type="urn:test" Target="');
      const chunk = new Uint8Array(4096);
      for (let n = 0; n < 10; n++) { chunk.fill(97); yield chunk; chunk.fill(255); }
      yield encode('"/></Relationships>');
    }
  };
  const admission = openRetainedPackageInventory(archive, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } });
  if (mode !== 'success') await expect(admission).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : 'io-failure' });
  else {
    const inventory = await admission, diagrams = await all(inventory.diagrams()); expect(diagrams).toHaveLength(1);
    const diagram = diagrams[0]!;
    expect(await Promise.all((await all(diagram.dependencies())).map(text))).toEqual(Array.from({ length: 128 }, (_, n) => `/node${n}.xml`).sort());
    const missing = await all(diagram.missing()); expect(missing).toHaveLength(1);
    let count = 0; for await (const bytes of missing[0]!) { await Promise.resolve(); for (const byte of bytes) expect(byte).toBe(count++ === 0 ? 47 : 97); }
    expect(count).toBe(40961); expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
    await inventory.close(); await expect(diagram.dependencies().next()).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  expect(phase).toBe(true); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
