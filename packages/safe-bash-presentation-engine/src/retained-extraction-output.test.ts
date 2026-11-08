import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { stageRetainedExtractionOutput } from './retained-extraction-output.js';
import type { RetainedPackageExtraction } from './retained-package-extraction.js';
const encode = (value: string) => new TextEncoder().encode(value);
for (const mode of ['success', 'partial', 'cancel', 'admission-cancel', 'sink', 'storage', 'limit'] as const) it(`stages bounded extraction manifests and diagnostics: ${mode}`, async () => {
  const owner = createMemoryFileSystem(), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'open') return async (...args: Parameters<NonNullable<typeof owner.open>>) => {
      const handle = await owner.open!(...args); handles++;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...args: Parameters<typeof handle.write>) => {
          if (mode === 'storage') throw new Error('storage failed');
          outstanding += args[0].length; peak = Math.max(peak, outstanding);
          try { await Promise.resolve(); written += args[0].length; return await handle.write(...args); } finally { outstanding -= args[0].length; }
        };
        if (key === 'close') return async () => { handles--; await handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const extraction: RetainedPackageExtraction = { count: 12, async close() { throw new Error('borrowed extraction must not be closed'); }, async *members() {
    for (let n = 0; n < 12; n++) {
      if (mode === 'admission-cancel' && n === 2) controller.abort();
      yield { part: `/part${n}.xml`, name: `part-${n}.xml`, size: 0, sha256: 'a'.repeat(64),
        async *contentType() { const chunk = encode('港"\\😀'.repeat(1000)); for (let n = 0; n < 3; n++) { chunk.set(encode('港"\\😀'.repeat(1000))); yield chunk; chunk.fill(255); } }, async *bytes() {} };
    }
  } };
  const run = stageRetainedExtractionOutput(extraction, { signal: controller.signal, workingStorage: { fs, directory: '/', cacheBytes: 16384 } }, { directory: '/out', json: true, allowPartialOutput: true, maxOutputBytes: mode === 'limit' ? 100 : Infinity });
  if (mode === 'limit' || mode === 'storage' || mode === 'admission-cancel') await expect(run).rejects.toThrow();
  else {
    const output = await run, chunks: Uint8Array[] = [];
    if (mode === 'cancel') controller.abort();
    try {
      const write = output.write({ async write(chunk) { if (mode === 'sink') throw new Error('sink failed'); expect(chunk.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(new Uint8Array(chunk)); } }, mode === 'partial' || mode === 'cancel' ? { code: mode === 'cancel' ? 'cancelled' : 'io-failure', published: 3 } : undefined);
      if (mode === 'sink') await expect(write).rejects.toThrow('sink failed');
      else { await write; const result = JSON.parse(Buffer.concat(chunks).toString()); expect(result.data.outputs).toHaveLength(mode === 'success' ? 12 : 3); expect(result.data.outputs[0].contentType).toBe('港"\\😀'.repeat(3000)); }
    } finally { await output.close(); }
    expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
  }
  expect(outstanding).toBe(0); expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
