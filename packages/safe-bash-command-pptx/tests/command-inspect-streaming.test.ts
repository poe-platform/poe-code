import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck() {
  return storedArchive(Object.entries(fixture().toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const json of [false, true]) for (const flags of [[], ['--slide', '1'], ['--slide', '1', '--shape', 'Lantern'], ['--scope', 'notes'], ['--slide', '99']]) it(`streams inspection with exact command parity: ${json} ${flags.join(' ')}`, async () => {
  const bytes = deck(), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['inspect', '/deck.pptx', ...flags, ...(json ? ['--json'] : [])].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 },
    openInput: async () => ({ size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }, async *stream() { for (let p = 0; p < bytes.length; p += 1024) yield bytes.subarray(p, p + 1024); } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode);
  expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
  expect(Buffer.concat([...errors, result.stderr])).toEqual(Buffer.from(expected.stderr));
  expect(await fs.readdir('/')).toEqual([]);
});

for (const maxOutputBytes of [1, 100, 1000, 100000]) it(`preserves output limits without exposing partial inspection: ${maxOutputBytes}`, async () => {
  const bytes = deck(), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine({ maxOutputBytes });
  const args = ['inspect', '/deck.pptx', '--json'].map(encode), expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 },
    openInput: async () => ({ size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
  if (result.exitCode !== 0) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['success', 'sink', 'cancel', 'storage'] as const) it(`spills complete command output and retires storage: ${mode}`, async () => {
  const volume = fixture();
  const name = 'Quoted &quot; \\ 😀 &#10; '.repeat(2000);
  volume.writeFileSync('/deck/slide.xml', `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld name="${name}"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr lang="${name}"/></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), open = fs.open!.bind(fs), controller = new AbortController(); let written = 0, outstanding = 0, peak = 0, handles = 0;
  fs.readFile = async () => { throw new Error('payload-wide read forbidden'); };
  fs.open = async (...args) => { const handle = await open(...args); handles++; return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (...parameters: Parameters<typeof handle.write>) => {
      if (mode === 'storage') throw new Error('injected storage failure');
      const length = parameters[0].length; written += length; outstanding += length; peak = Math.max(peak, outstanding);
      try { await Promise.resolve(); return await handle.write(...parameters); } finally { outstanding -= length; }
    };
    if (key === 'close') return async (...parameters: Parameters<typeof handle.close>) => { handles--; return handle.close(...parameters); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }); };
  const engine = createPptxCommandEngine(), args = ['inspect', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [];
  const source = new Uint8Array(16384);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 },
    openInput: async () => ({ size: bytes.length, async read(position, maximum) { const length = Math.min(maximum, source.length, bytes.length - position); source.set(bytes.subarray(position, position + length)); return source.subarray(0, length); },
      async *stream() { for (let p = 0; p < bytes.length; p += source.length) { const length = Math.min(source.length, bytes.length - p); source.set(bytes.subarray(p, p + length)); yield source.subarray(0, length); source.fill(255); } } }),
    stdout: { async write(bytes) { if (mode === 'sink') throw new Error('injected sink failure'); if (mode === 'cancel') controller.abort(); await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } },
    stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  if (mode === 'sink') await expect(execution).rejects.toThrow('injected sink failure');
  else if (mode === 'cancel') await expect(execution).rejects.toMatchObject({ code: 'cancelled' });
  else {
    const result = await execution;
    if (mode === 'storage') { expect(result.exitCode).toBe(3); expect(chunks).toEqual([]); }
    else {
      const expected = await engine.execute({ args, signal: controller.signal, readInput: async () => bytes });
      expect(result.exitCode).toBe(0); expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected.stdout)); expect(written).toBeGreaterThan(16384 * 4); expect(peak).toBeLessThanOrEqual(16384);
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
  const args = createCommandArguments(['inspect', mode === 'stdin' ? '-' : '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () { yield bytes; })(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { inventory: { counts: { slides: 1 } } } });
  expect(await fs.readdir('/scratch')).toEqual([]);
});
