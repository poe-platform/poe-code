import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (value: string) => new TextEncoder().encode(value);
function deck(text: string) {
  const volume = fixture({ 'slide.xml': xml('sld', tree('3', `<p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`)) });
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const mode of ['structural', 'raw', 'text', 'media', 'relationships']) for (const json of [false, true]) for (const same of [false, true]) it(`streams ${mode} diff, json=${json}, equal=${same}`, async () => {
  const left = deck('Before'), right = same ? left : deck('After'), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['diff', '/left.pptx', '/right.pptx', '--mode', mode, ...(json ? ['--json'] : [])].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async path => path === '/left.pptx' ? left : right });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async path => { const bytes = path === '/left.pptx' ? left : right; return { size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }; },
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const comparisonMode of ['text', 'structural']) for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage', 'read', 'close'] as const) it(`stages ${comparisonMode} comparison with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck('Long 😀 &quot; comparison text '.repeat(1200));
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (mode === 'storage') throw new Error('injected storage failure');
      written += parameters[0].length; outstanding += parameters[0].length; peak = Math.max(peak, outstanding);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= parameters[0].length; }
    };
    if (key === 'read') return async (...parameters: Parameters<typeof handle.read>) => { if (mode === 'read') throw new Error('injected storage read failure'); return handle.read(...parameters); };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; await handle.close(...parameters); if (mode === 'close') throw new Error('injected close failure'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['diff', '/left.pptx', '/right.pptx', '--mode', comparisonMode, '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async path => { const input = path === '/left.pptx' ? deck('Before') : bytes; return ({ size: input.length, async read(p, n) { const size = Math.min(n, reused.length, input.length - p); reused.set(input.subarray(p, p + size)); return reused.subarray(0, size); },
      async *stream() { for (let p = 0; p < input.length; p += reused.length) { const size = Math.min(reused.length, input.length - p); reused.set(input.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } }); },
    stdout: { async write(bytes) { if (mode === 'sink') throw new Error('injected sink failure'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostics'); } }
  } });
  if (mode === 'sink') await expect(execution).rejects.toThrow('injected sink failure');
  else if (mode === 'cancel') await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
  else {
    const result = await execution;
    if (mode === 'storage' || mode === 'read' || mode === 'close') { expect(result.exitCode).toBe(2); expect(chunks).toEqual([]); }
    else {
      const expected = await engine.execute({ args, signal: controller.signal, readInput: async path => path === '/left.pptx' ? deck('Before') : bytes });
      expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); if (mode === 'limit') expect(chunks).toEqual([]);
    }
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

it('routes the default adapter through retained input and cleans caller scratch', async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = deck('Before');
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['diff', '/deck.pptx', '/deck.pptx', '--mode', 'text', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { equal: true, changes: [] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});


for (const mode of ['structural', 'raw', 'text', 'media', 'relationships']) it(`reads both inputs before parsing the first for ${mode}`, async () => {
  const engine = createPptxCommandEngine(), fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const args = ['diff', '/bad', '/missing', '--mode', mode, '--json'].map(encode);
  const missing = () => { throw new Error('missing'); };
  const expected = await engine.execute({ args, signal, readInput: async path => path === '/bad' ? encode('invalid') : missing() });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/' }, openInput: async path => path === '/missing' ? missing() : ({ size: 7, async read(p, n) { return encode('invalid').slice(p, p + n); }, async *stream() { yield encode('invalid'); } }),
    stdout: { async write() { throw new Error('unexpected output'); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } }
  } });
  expect(result).toEqual(expected); expect(await fs.readdir('/')).toEqual([]);
});
