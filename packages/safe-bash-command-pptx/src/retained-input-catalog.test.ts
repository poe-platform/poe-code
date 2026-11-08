import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { PagedStorage } from '@poe-code/safe-fs/storage';
import { compareCopyIdentity } from 'safe-bash-contracts/filesystem-identity';
import { RetainedInputCatalog } from './retained-input-catalog.js';
for (const scope of [{}, Symbol('private'), Symbol.for('pptx-test-scope')]) it(`preserves stored identity scope: ${String(scope)}`, async () => {
  const fs = createMemoryFileSystem(), pages = new PagedStorage({ fs, cwd: '/', env: {}, signal: new AbortController().signal }, 1);
  const catalog = new RetainedInputCatalog(pages, new AbortController().signal);
  const stat = { type: 'file' as const, size: 3, mode: 420, atimeMs: 1, mtimeMs: 2, ctimeMs: 3, ino: 9, dev: 2, identityScope: scope, revision: 7 };
  try {
    await catalog.put('/source', { start: 8, size: 3, entry: stat, identity: stat });
    const same = await catalog.get('/source', stat); expect(same?.start).toBe(8); expect(same?.size).toBe(3); expect(same?.entry).toEqual(stat); expect(same?.identity).toEqual(stat);
    const other = { ...stat, identityScope: {} }; expect(compareCopyIdentity((await catalog.get('/source', other))?.entry, other)).toBe('distinct');
    expect(await catalog.get('/absent', stat)).toBeUndefined();
  } finally { await pages.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
it('stores increasing replay records in caller pages and bounds spill writes', async () => {
  const owner = createMemoryFileSystem(); let writes = 0, peak = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args);
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => { peak = Math.max(peak, args[0].length); writes += args[0].length; return handle.write(...args); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const signal = new AbortController().signal, pages = new PagedStorage({ fs, cwd: '/', env: {}, signal }, 1), catalog = new RetainedInputCatalog(pages, signal);
  try {
    for (let i = 0; i < 500; i++) await catalog.put(`/港😀-${i}`, { start: 8 + i, size: i });
    let count = 0; for await (const [path, row] of catalog.entries()) { expect(path).toBe(`/港😀-${count}`); expect(row.size).toBe(count++); }
    expect(count).toBe(500); expect((await catalog.get('/港😀-499'))?.start).toBe(507); expect(writes).toBeGreaterThan(16384); expect(peak).toBeLessThanOrEqual(16384);
  } finally { await pages.close(); }
  expect(await fs.readdir('/')).toEqual([]);
});
