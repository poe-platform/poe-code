import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, rels } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (value: string) => new TextEncoder().encode(value);
function deck(mode = 'plain', text = 'Title 😀 &amp; text') {
  const root = mode === 'invalid-root' ? 'wrong' : 'coreProperties';
  const volume = fixture({ '_rels/.rels': rels([['doc', 'officeDocument', 'main.xml']]).replace('</Relationships>', '<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="core.xml"/></Relationships>'),
    'core.xml': `<cp:${root} xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${mode === 'empty' ? '' : text}</dc:title>${mode === 'duplicate' ? '<dc:title>Second</dc:title>' : ''}<cp:revision>-0</cp:revision><dcterms:created>2000-02</dcterms:created><foreign xmlns="urn:unknown">Kept</foreign></cp:${root}>`
  });
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const mode of ['plain', 'empty', 'duplicate', 'missing', 'invalid-root']) it(`streams properties ${operation}, json=${json}, ${mode}`, async () => {
  const bytes = deck(mode), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['properties', operation, '/deck.pptx', ...(json ? ['--json'] : []), ...(operation === 'get' || mode === 'missing' ? ['--name', mode === 'missing' ? 'missing' : 'title'] : [])].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr); if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage', 'read', 'close'] as const) it(`stages property reads with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck('plain', 'Long 😀 &quot; property text '.repeat(3000));
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['properties', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
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

for (const input of ['/deck.pptx', '-']) it(`routes property input ${input} through the default adapter and cleans caller scratch`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = deck();
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['properties', 'list', input, '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () { if (input === '-') yield bytes; })(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); if (input !== '-') expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { properties: [{ name: 'title', value: 'Title 😀 & text' }, { name: 'revision', value: 0 }, { name: 'created', value: '2000-02-01T00:00:00Z' }, { name: 'foreign', value: 'Kept' }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});

