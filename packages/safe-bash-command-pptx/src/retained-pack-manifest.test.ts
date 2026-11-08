import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { openRetainedPackManifest } from './retained-pack-manifest.js';
const encode = (value: string) => new TextEncoder().encode(value);
const part = (name = '/a.xml', path = 'a.xml') => ({ part: name, sha256: '0'.repeat(64), file: { vfsPath: path } });
async function* input(value: string) { const bytes = encode(value); for (let offset = 0; offset < bytes.length; offset += 3) yield bytes.subarray(offset, offset + 3); }
it('admits stored manifest descriptors and resolves scoped source paths', async () => {
  const fs = createMemoryFileSystem();
  const manifest = await openRetainedPackManifest(input(JSON.stringify({ parts: [part('/a.xml', '../a.xml'), part('/b.xml', '/absolute/./b.xml')] })), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: '/source/nested/manifest.json', output: '/result.pptx' });
  try {
    expect(manifest.count).toBe(2);
    const descriptors = []; for await (const row of manifest.members()) descriptors.push(row);
    expect(descriptors).toEqual([{ part: '/a.xml', sha256: '0'.repeat(64) }, { part: '/b.xml', sha256: '0'.repeat(64) }]);
    expect(await manifest.path('/a.xml')).toBe('/source/a.xml');
    expect(await manifest.path('/b.xml')).toBe('/absolute/b.xml');
    const paths = []; for await (const path of manifest.paths()) paths.push(path);
    expect(paths).toEqual(['/source/nested/manifest.json', '/source/a.xml', '/absolute/b.xml']);
  } finally { await manifest.close(); }
  await expect(manifest.path('/a.xml')).rejects.toMatchObject({ code: 'invalid-handle' }); expect(await fs.readdir('/')).toEqual([]);
});
for (const value of [ '{}', '{"parts":[]}', '{"parts":[],"parts":[]}', '{"parts":[],"p\\u0061rts":[]}', '{"parts":null}', '{"parts":[1]}', '{"parts":[],"other":0}', '[1]', '{"parts":[' + JSON.stringify(part()) + ',]}', JSON.stringify({ parts: [part(), part('/A.xml')] }), JSON.stringify({ parts: [{ ...part(), sha256: 'A'.repeat(64) }] }), JSON.stringify({ parts: [{ ...part(), file: { vfsPath: 'a', extra: 1 } }] }), JSON.stringify({ parts: [part('relative.xml')] }), JSON.stringify({ parts: [part('/a.xml', '../../escape')] }), JSON.stringify({ parts: [part('/a.xml', 'bad\\path')] }), JSON.stringify({ parts: [part('/a.xml', '')] }) ]) it(`rejects invalid manifest: ${value.slice(0, 65)}`, async () => {
  const fs = createMemoryFileSystem();
  await expect(openRetainedPackManifest(input(value), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: '/manifest.json' })).rejects.toMatchObject({ code: 'invalid-value' });
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['stdin', 'output', 'count', 'bytes', 'reads'] as const) it(`preserves manifest ${mode} admission`, async () => {
  const fs = createMemoryFileSystem(), data = JSON.stringify({ parts: [part('/a.xml', mode === 'stdin' ? '-' : 'a.xml'), part('/b.xml')] });
  await expect(openRetainedPackManifest(input(data), { archiveLimits: mode === 'count' ? { maxMembers: 1 } : {}, limits: mode === 'bytes' ? { maxBytes: 1 } : mode === 'reads' ? { maxReads: 1 } : {}, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: mode === 'stdin' ? '-' : '/manifest.json', ...(mode === 'output' ? { output: '/a.xml' } : {}) })).rejects.toMatchObject({ code: ['count', 'bytes', 'reads'].includes(mode) ? 'resource-limit' : 'invalid-value' });
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'storage', 'source', 'cancel', 'invalid-utf8', 'read-limit'] as const) it(`bounds manifest backing writes and retires sources: ${mode}`, async () => {
  const owner = createMemoryFileSystem(), controller = new AbortController(); let written = 0, handles = 0, peak = 0, outstanding = 0, retired = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); if (mode === 'storage') throw new Error('storage failure'); written += args[0].length; return await handle.write(...args); } finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  async function* chunks() {
    const reused = new Uint8Array(4096);
    async function* send(text: string) { const bytes = encode(text); for (let offset = 0; offset < bytes.length; offset += reused.length) { const size = Math.min(reused.length, bytes.length - offset); reused.set(bytes.subarray(offset, offset + size)); yield reused.subarray(0, size); reused.fill(255); } }
    try {
      yield* send('{"parts":[');
      for (let index = 0; index < 350; index++) {
        if (mode === 'source' && index === 50) throw new Error('source failure');
        if (mode === 'cancel' && index === 50) controller.abort();
        if (mode === 'invalid-utf8' && index === 50) { yield Uint8Array.of(255); return; }
        yield* send((index ? ',' : '') + JSON.stringify(part(`/a${index}.xml`, `directory/港😀-${index}.xml`)));
      }
      yield* send(']}');
    } finally { retired++; }
  }
  const pending = openRetainedPackManifest(chunks(), { signal: controller.signal, limits: mode === 'read-limit' ? { maxReads: 20 } : {}, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: '/inputs/manifest.json' });
  if (mode !== 'success') await expect(pending).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'invalid-utf8' ? 'invalid-value' : mode === 'read-limit' ? 'resource-limit' : 'io-failure' });
  else {
    const manifest = await pending;
    try { expect(manifest.count).toBe(350); expect(await manifest.path('/a349.xml')).toBe('/inputs/directory/港😀-349.xml'); let count = 0; for await (const row of manifest.members()) { await Promise.resolve(); expect(row.sha256).toBe('0'.repeat(64)); count++; } expect(count).toBe(350); }
    finally { await manifest.close(); }
    expect(written).toBeGreaterThan(16384 * 4);
  }
  expect(retired).toBe(1); expect(peak).toBeLessThanOrEqual(16384); expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
it('rejects long unknown names, excessive nesting and duplicate escaped names without collecting keys', async () => {
  for (const text of ['{"' + 'x'.repeat(200000) + '":0}', '['.repeat(33) + '0' + ']'.repeat(33), '{"parts":[{"part":"/a.xml","p\\u0061rt":"/b.xml"}]}']) {
    const fs = createMemoryFileSystem();
    await expect(openRetainedPackManifest(input(text), { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: '/manifest.json' })).rejects.toMatchObject({ code: 'invalid-value' });
    expect(await fs.readdir('/')).toEqual([]);
  }
});
it('keeps the primary parser failure when the source cleanup also fails', async () => {
  const fs = createMemoryFileSystem(); let closed = 0;
  const source = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: encode('!') }; }, async return(): Promise<IteratorResult<Uint8Array>> { closed++; throw new Error('cleanup failed'); } }; } };
  await expect(openRetainedPackManifest(source, { workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { manifest: '/manifest.json' })).rejects.toMatchObject({ code: 'invalid-value' });
  expect(closed).toBe(1); expect(await fs.readdir('/')).toEqual([]);
});
