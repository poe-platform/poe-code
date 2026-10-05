import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck(properties: string, count = 1) {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2', Array.from({ length: count }, (_, n) => `<p:sp><p:nvSpPr><p:cNvPr id="${n + 3}" name="Frame"/></p:nvSpPr><p:txBody>${properties}<a:p><a:r><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>`).join(''))) });
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const properties of [
  '', '<a:bodyPr/>', '<a:bodyPr lIns="12700" rIns="-25400" tIns="0" bIns="+38100" anchor="ctr" numCol="2" wrap="none" vert="vert270" rot="60000"><a:normAutofit/></a:bodyPr>',
  '<a:bodyPr anchor="just"><a:spAutoFit/></a:bodyPr>', '<a:bodyPr anchor="dist"><a:noAutofit/></a:bodyPr>',
  '<a:bodyPr lIns="  +0000012700  "/>', '<a:bodyPr lIns="1e3"/>', '<a:bodyPr wrap="true"/>', '<a:bodyPr numCol="17"/>',
  '<a:bodyPr/><a:bodyPr/>', '<a:bodyPr><a:noAutofit/><a:normAutofit/></a:bodyPr>'
]) it(`streams frames ${operation}, json ${json}, ${properties}`, async () => {
  const bytes = deck(properties), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['text', 'frames', operation, '/deck.pptx', ...(json ? ['--json'] : [])].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const operation of ['list', 'get']) for (const [count, selection] of [[0, []], [2, []], [1, ['--slide', '1', '--shape', 'Missing']], [1, ['--slide', '99']], [1, ['--scope', 'notes']]] as const) it(`preserves frame cardinality and selection: ${operation} ${count} ${selection}`, async () => {
  const bytes = deck('<a:bodyPr/>', count), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['text', 'frames', operation, '/deck.pptx', '--json', ...selection].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage'] as const) it(`stages frame output with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck(`<a:bodyPr lIns="${' '.repeat(40000)}+${'0'.repeat(40000)}12700${' '.repeat(40000)}" ignored="${'unrecognized'.repeat(4000)}"/>`, 4);
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['text', 'frames', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
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

it('routes the default adapter through retained input and cleans caller scratch', async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = deck('<a:bodyPr lIns="25400" anchor="b"/>');
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['text', 'frames', 'list', '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { frames: [{ formatting: { marginLeft: 2, verticalAnchor: 'bottom' } }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});
