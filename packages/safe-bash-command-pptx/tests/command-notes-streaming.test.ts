import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, xml, tree, rels } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
const shape = (id: number, body: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>${body}</p:sp>`;
function deck(mode = 'plain', text = 'Speaker 😀 &amp; text') {
  let content = shape(3, `<p:txBody><a:p><a:r><a:t>${text}<a:span>nested</a:span></a:t></a:r><a:br/><a:fld><a:t>cached</a:t></a:fld></a:p><a:p/></p:txBody>`);
  if (mode === 'missing-body') content = '';
  if (mode === 'missing-text') content = shape(3, '');
  if (mode === 'duplicate-body') content += shape(4, '');
  if (mode === 'duplicate-text') content = shape(3, '<p:txBody/><p:txBody/>');
  const volume = fixture({ 'notes.xml': xml('notes', mode === 'missing-tree' ? '' : tree('2', content)), ...(mode.startsWith('absent') ? { '_rels/slide.xml.rels': rels([['layout', 'slideLayout', 'layout.xml']]) } : {}) });
  if (mode === 'strict') for (const [path, text] of Object.entries(volume.toJSON())) volume.writeFileSync(path, text!.split('http://schemas.openxmlformats.org/presentationml/2006/main').join('http://purl.oclc.org/ooxml/presentationml/main').split('http://schemas.openxmlformats.org/drawingml/2006/main').join('http://purl.oclc.org/ooxml/drawingml/main').split('http://schemas.openxmlformats.org/officeDocument/2006/relationships').join('http://purl.oclc.org/ooxml/officeDocument/relationships'));
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const mode of ['plain', 'strict', 'missing-body', 'missing-text', 'duplicate-body', 'duplicate-text', 'missing-tree', 'absent', 'absent-invalid-selection']) it(`streams notes ${operation} ${json} ${mode} with buffered parity`, async () => {
  const bytes = deck(mode), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['notes', operation, '/deck.pptx', ...(json ? ['--json'] : []), ...(mode === 'absent-invalid-selection' ? ['--slide', '99'] : [])].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr);
  if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const operation of ['list', 'get']) for (const slides of [0, 1, 2]) for (const select of [[], ['--slide', '1'], ['--slide', '99']]) it(`preserves absent notes and slide selection: ${operation} ${slides} ${select}`, async () => {
  const { createPresentation } = await import('safe-bash-presentation-engine/creation');
  const { resourceContext } = await import('safe-bash-presentation-engine/resource-limits');
  const bytes = await createPresentation({ slides: Array.from({ length: slides }, () => ({})) }, resourceContext({})), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['notes', operation, '/deck.pptx', '--json', ...select].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage', 'read', 'close'] as const) it(`stages speaker notes with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck('plain', 'Long 😀 &quot; speaker text '.repeat(3000));
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 1000 } : {}), args = ['notes', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
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
it('routes the default adapter through retained input and cleans caller scratch', async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments } = await import('safe-bash-contracts');
  const owner = createMemoryFileSystem(), bytes = deck();
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['notes', 'list', '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { notes: [{ slide: 1, text: 'Speaker 😀 & textnested\vcached\n', bodyShapeId: '3' }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});

it('preserves input failure precedence over malformed notes tokens', async () => {
  const engine = createPptxCommandEngine(), signal = new AbortController().signal, fs = createMemoryFileSystem();
  const args = ['notes', 'get', '/missing.pptx', '--select', 'invalid', '--json'].map(encode);
  const missing = async (): Promise<never> => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const expected = await engine.execute({ args, signal, readInput: missing });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: missing,
    stdout: { async write() { throw new Error('unexpected output'); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } }
  } });
  expect(result).toEqual(expected); expect(await fs.readdir('/')).toEqual([]);
});
