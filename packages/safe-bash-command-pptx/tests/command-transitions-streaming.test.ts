import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { fixture, xml, tree, rels } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
function deck(properties: string) {
  const volume = fixture({ 'slide.xml': xml('sld', tree('2') + properties) });
  return storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
}
for (const operation of ['list', 'get']) for (const json of [false, true]) for (const properties of [
  '', '<p:transition><p:cut/></p:transition>', '<p:transition advClick="false" advTm="123"><p:push dir="r"/></p:transition>',
  '<p:transition advTm=" "><p:fade/></p:transition>', '<p:transition advClick="on"><p:cut/></p:transition>',
  '<p:transition/><p:transition/>', '<p:transition><p:cut/><p:fade/></p:transition>',
  '<p:extLst><p:ext uri="x"><p:transition/></p:ext></p:extLst>'
]) it(`streams transitions ${operation}, json ${json}, ${properties}`, async () => {
  const bytes = deck(properties), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['transitions', operation, '/deck.pptx', ...(json ? ['--json'] : [])].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  if (result.exitCode) expect(chunks).toEqual([]);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const operation of ['list', 'get']) for (const selection of [[], ['--slide', '1'], ['--slide', '99'], ['--select', 'invalid'], ['--all']] as const) it(`preserves transition selection: ${operation} ${selection}`, async () => {
  const bytes = deck('<p:transition><p:fade/></p:transition>'), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['transitions', operation, '/deck.pptx', '--json', ...selection].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(Buffer.from(expected.stdout).toString()); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['success', 'limit', 'sink', 'cancel', 'storage'] as const) it(`stages transition output with bounded caller IO and cleanup: ${mode}`, async () => {
  const bytes = deck(`<p:transition advTm="${'0'.repeat(80000)}123"><p:fade/></p:transition>`);
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
  const engine = createPptxCommandEngine(mode === 'limit' ? { maxOutputBytes: 100 } : {}), args = ['transitions', 'list', '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [], reused = new Uint8Array(16384);
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
  const owner = createMemoryFileSystem(), bytes = deck('<p:transition><p:cut/></p:transition>');
  await owner.writeFile('/deck.pptx', bytes); await owner.mkdir('/scratch'); let retained = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { retained++; return owner.openReadFile!(...args); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['transitions', 'list', '/deck.pptx', '--json']), chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostic'); } } });
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0); expect(retained).toBeGreaterThan(0);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ ok: true, data: { items: [{ kind: 'cut' }] } });
  expect(await owner.readdir('/scratch')).toEqual([]);
});

for (const count of [0, 2]) for (const operation of ['list', 'get']) it(`preserves complete slide cardinality ${count} ${operation}`, async () => {
  const volume = fixture(), main = volume.readFileSync('/deck/main.xml', 'utf8') as string;
  volume.writeFileSync('/deck/main.xml', main.replace('<p:sldId id="256" r:id="slide"/>', count ? '<p:sldId id="256" r:id="slide"/><p:sldId id="257" r:id="second"/>' : ''));
  if (count) {
    volume.writeFileSync('/deck/second.xml', xml('sld', tree('2') + '<p:transition><p:fade/></p:transition>'));
    volume.writeFileSync('/deck/_rels/second.xml.rels', rels([['layout', 'slideLayout', 'layout.xml']]));
    const relationships = volume.readFileSync('/deck/_rels/main.xml.rels', 'utf8') as string;
    volume.writeFileSync('/deck/_rels/main.xml.rels', relationships.replace('</Relationships>', '<Relationship Id="second" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="second.xml"/></Relationships>'));
    const types = volume.readFileSync('/deck/[Content_Types].xml', 'utf8') as string;
    volume.writeFileSync('/deck/[Content_Types].xml', types.replace('</Types>', '<Override PartName="/second.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'));
  }
  const bytes = storedArchive(Object.entries(volume.toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) }))), fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  const args = ['transitions', operation, '/deck.pptx', '--json'].map(encode), chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes });
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected diagnostics'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  if (operation === 'list') { expect(expected.exitCode, Buffer.from(expected.stdout).toString()).toBe(0); expect(JSON.parse(Buffer.from(expected.stdout).toString()).locations).toHaveLength(count); }
  expect(await fs.readdir('/')).toEqual([]);
});
