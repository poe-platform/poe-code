import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck(count = 1, text = 'Cached 😀 &amp;', identifier = 'id', type = 'datetime13') {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Field"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Before</a:t></a:r><a:br/>${Array.from({ length: count }, (_, n) => `<a:fld id="${identifier}${n}" type="${type}"><a:t>${text}</a:t></a:fld>`).join('')}</a:p></p:txBody></p:sp>`)) });
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const count of [0, 1, 2]) it(`streams fields ${operation}, json ${json}, count ${count} with exact command parity`, async () => {
  const bytes = deck(count), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['fields', operation, '/deck.pptx', ...(json ? ['--json'] : [])].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage'] as const) it(`stages field output with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck(1, 'Long 😀 &quot; field\\value '.repeat(3000), 'Long id '.repeat(3000), 'Unknown type '.repeat(3000));
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['fields', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
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
      expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384); if (mode === 'limit') expect(chunks).toEqual([]);
    }
  }
  expect(handles).toBe(0); expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['retained', 'stream', 'buffered', 'stdin'] as const) it(`preserves default adapter input support: ${mode}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), overrides: Partial<typeof owner> = {};
  const fs = new Proxy(owner, { get(target, key) { if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key); const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  const bytes = deck(); await fs.writeFile('/deck.pptx', bytes); await fs.mkdir('/scratch');
  if (mode === 'stream' || mode === 'buffered') {
    overrides.capabilitiesFor = async () => ({ ...fs.capabilities, retainedRead: false, streamingRead: mode === 'stream' });
    overrides.openReadFile = async () => { throw new Error('retained source unavailable'); };
  }
  if (mode !== 'buffered') overrides.readFile = async () => { throw new Error('whole input read forbidden'); };
  const args = createCommandArguments(['fields', 'list', mode === 'stdin' ? '-' : '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () { yield bytes; })(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { items: [{ kind: 'date', name: 'id0', fields: [{ name: 'fieldType', value: { type: 'string', value: 'datetime13' } }, { name: 'cachedText', value: { type: 'string', value: 'Cached 😀 &' } }, { name: 'paragraph', value: { type: 'number', value: 0 } }, { name: 'inline', value: { type: 'number', value: 2 } }, { name: 'coordinateSystem', value: { type: 'string', value: 'zero-based' } }] }] } });
  expect(await fs.readdir('/scratch')).toEqual([]);
});
