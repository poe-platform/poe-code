import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck(extra?: string) {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>港 &amp; 😀</a:t></a:r></a:p></p:txBody></p:sp>')) });
  if (extra) volume.writeFileSync('/deck/extra.xml', extra);
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const flags of [[], ['--json'], ['--pretty'], ['--pretty', '--json']]) for (const selection of [
  ['--slide', '1'], ['--part', '/slide.xml'], ['--scope', 'shared', '--part', '/[Content_Types].xml'],
  ['--scope', 'shared', '--part', '/_rels/.rels'], ['--scope', 'shared', '--part', '/_rels/slide.xml.rels'],
  ['--slide', '1', '--shape', 'Text'], ['--part', '/absent.xml']
]) it(`streams XML with exact buffered parity: ${selection.join(' ')} ${flags.join(' ')}`, async () => {
  const bytes = deck(), fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  const args = ['xml', 'get', '/deck.pptx', ...selection, ...flags].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage'] as const) it(`stages large XML with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck('<root long="' + 'x'.repeat(18000) + '"><child>' + '港 &amp; 😀 '.repeat(2000) + '</child><last/></root>');
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (mode === 'storage') throw new Error('injected storage failure');
      written += parameters[0].length; outstanding += parameters[0].length; peak = Math.max(peak, outstanding);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= parameters[0].length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['xml', 'get', '/deck.pptx', '--scope', 'shared', '--part', '/extra.xml', '--pretty', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { const size = Math.min(n, reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); return reused.subarray(0, size); },
      async *stream() { for (let p = 0; p < bytes.length; p += reused.length) { const size = Math.min(reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } }),
    stdout: { async write(bytes) { if (mode === 'sink') throw new Error('injected sink failure'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostics'); } }
  } });
  if (mode === 'sink') await expect(execution).rejects.toThrow('injected sink failure');
  else if (mode === 'cancel') await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
  else {
    const result = await execution;
    if (mode === 'storage') { expect(result.exitCode).toBe(3); expect(chunks).toEqual([]); }
    else {
      const expected = await engine.execute({ args, signal: controller.signal, readInput: async () => bytes });
      expect(result.exitCode).toBe(mode === 'limit' ? 4 : 0); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); if (mode === 'limit') expect(chunks).toEqual([]);
    }
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
