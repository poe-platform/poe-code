import { expect, it } from 'vitest';
import { createMemoryFileSystem, type FileSystem } from '@poe-code/safe-fs';
import { stageRetainedSlideSettings } from './retained-slide-publication.js';
import { fixture, xml, tree } from '../tests/fixtures/validation.js';
import { storedArchive } from '../tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
for (const mode of ['success', 'no-op', 'limit', 'source', 'storage', 'sink', 'cancel'] as const) it(`owns bounded slide publication staging: ${mode}`, async () => {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2')) });
  volume.writeFileSync('/deck/extra.xml', '<root>' + '港 &amp; 😀 '.repeat(5000) + '</root>');
  const original = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const owner = createMemoryFileSystem(), controller = new AbortController(), signal = controller.signal;
  let written = 0, outstanding = 0, peak = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole payload read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<FileSystem['open']>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          if (mode === 'storage') throw new Error('storage failed');
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
  const reused = new Uint8Array(16384);
  const input = { size: original.length,
    async read(p: number, n: number) { const size = Math.min(n, reused.length, original.length - p); reused.set(original.subarray(p, p + size)); return reused.subarray(0, size); },
    async *stream() { for (let p = 0; p < original.length; p += reused.length) { if (mode === 'source') throw new Error('source failed'); const size = Math.min(reused.length, original.length - p); reused.set(original.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } }
  };
  const run = stageRetainedSlideSettings(input, { selection: { kind: 'slide', all: true }, ...(mode === 'no-op' ? { hidden: false } : { name: '港'.repeat(14000), hidden: true }) },
    { signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { json: true, dryRun: false, destination: '-', maxOutputBytes: mode === 'limit' ? 10 : Infinity });
  if (mode === 'source' || mode === 'storage') await expect(run).rejects.toThrow(`${mode} failed`);
  else if (mode === 'limit') await expect(run).rejects.toMatchObject({ code: 'resource-limit', phase: 'publish' });
  else {
    const staged = await run, chunks: Uint8Array[] = [];
    try {
      const write = staged.output.write({ async write(bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); if (mode === 'sink') throw new Error('sink failed'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); chunks.push(new Uint8Array(bytes)); } });
      if (mode === 'sink' || mode === 'cancel') await expect(write).rejects.toThrow();
      else {
        await write; expect(Buffer.concat(chunks).length).toBe(staged.size);
        const replay: Uint8Array[] = []; for await (const bytes of staged.bytes()) replay.push(new Uint8Array(bytes));
        expect(Buffer.concat(replay)).toEqual(Buffer.concat(chunks));
        if (mode === 'no-op') expect(Buffer.concat(chunks)).toEqual(Buffer.from(original));
      }
    } finally { await staged.close(); }
    await expect(async () => { for await (const ignored of staged.bytes()) { /* expired */ } }).rejects.toMatchObject({ code: 'invalid-handle' });
  }
  if (mode !== 'source' && mode !== 'storage') { expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); }
  expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
