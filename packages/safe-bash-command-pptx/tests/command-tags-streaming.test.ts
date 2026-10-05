import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { tagFixture } from '../../safe-bash-presentation-engine/tests/fixtures/tags.js';
const encode = (value: string) => new TextEncoder().encode(value);
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const mode of ['plain', 'strict', 'empty', 'absent', 'duplicate', 'invalid-root', 'missing-value', 'presentation']) it(`streams tags ${operation}, json=${json}, ${mode}`, async () => {
  const { bytes } = tagFixture(mode), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['tags', operation, '/deck.pptx', ...(json ? ['--json'] : []), ...(mode === 'presentation' ? ['--scope', 'presentation'] : [])].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr); if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage', 'read', 'close'] as const) it(`stages tag reads with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = tagFixture('plain', 'Long 😀 &quot; name '.repeat(1500), 'Long 😀 &quot; value '.repeat(1500)).bytes;
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['tags', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { const size = Math.min(n, reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); return reused.subarray(0, size); },
      async *stream() { for (let p = 0; p < bytes.length; p += reused.length) { const size = Math.min(reused.length, bytes.length - p); reused.set(bytes.subarray(p, p + size)); yield reused.subarray(0, size); reused.fill(255); } } }),
    stdout: { async write(bytes) { if (mode === 'sink') throw new Error('injected sink failure'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostics'); } }
  } });
  if (mode === 'sink') await expect(execution).rejects.toThrow('injected sink failure');
  else if (mode === 'cancel') await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
  else {
    const result = await execution;
    if (mode === 'storage' || mode === 'read' || mode === 'close') { expect(result.exitCode).toBe(3); expect(chunks).toEqual([]); }
    else {
      const expected = await engine.execute({ args, signal: controller.signal, readInput: async () => bytes });
      expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); if (mode === 'limit') expect(chunks).toEqual([]);
    }
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});

for (const input of ['/deck.pptx', '-']) it(`routes tag input ${input} through the default adapter and cleans caller scratch`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = tagFixture().bytes;
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['tags', 'list', input, '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () { if (input === '-') yield bytes; })(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); if (input !== '-') expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { tags: [{ name: 'Key😀', value: 'Value & text' }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});


for (const mode of ['exact', 'reordered', 'stale', 'malformed', 'missing-input']) it(`preserves tag selector and input error precedence: ${mode}`, async () => {
  const { bytes } = tagFixture(), engine = createPptxCommandEngine(), fs = createMemoryFileSystem(), signal = new AbortController().signal;
  const listed = await engine.execute({ args: ['tags', 'list', '/deck.pptx', '--json'].map(encode), signal, readInput: async () => bytes });
  const token = JSON.parse(Buffer.from(listed.stdout).toString()).data.tags[0].selector as string, location = JSON.parse(token);
  const selected = mode === 'exact' ? token : mode === 'reordered' ? JSON.stringify(Object.fromEntries(Object.entries(location).reverse())) : mode === 'stale' ? JSON.stringify({ ...location, fingerprint: '0'.repeat(64) }) : 'invalid';
  const args = ['tags', 'get', '/deck.pptx', '--select', selected, '--json'].map(encode), chunks: Uint8Array[] = [];
  const readInput = async () => { if (mode === 'missing-input') throw new Error('missing input'); return bytes; };
  const expected = await engine.execute({ args, signal, readInput });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => { await readInput(); return { size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }; },
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});
