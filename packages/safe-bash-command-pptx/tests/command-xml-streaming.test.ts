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

for (const flags of [['--dry-run'], ['--dry-run', '--json'], ['--output', '-']]) for (const selection of [['--slide', '1'], ['--part', '/slide.xml']]) it(`streams XML replacement with buffered parity: ${selection} ${flags}`, async () => {
  const bytes = deck(), replacement = encode(xml('sld', tree('2', '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>New text</a:t></a:r></a:p></p:txBody></p:sp>')));
  const fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  const args = ['xml', 'set', '/deck.pptx', '--file', '/replacement.xml', ...selection, ...flags].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async path => path === '/replacement.xml' ? replacement : bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async path => { const data = path === '/replacement.xml' ? replacement : bytes; return { size: data.length, async read(p, n) { return data.subarray(p, p + n); }, async *stream() { yield data; } }; },
    stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(chunk)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(expected.exitCode).toBe(selection[0] === '--slide' ? 2 : 0); expect(result.exitCode).toBe(expected.exitCode);
  expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); expect(result.stderr).toEqual(expected.stderr);
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['new', 'in-place', 'force', 'exists', 'dry-run', 'limit', 'stdout', 'stale', 'write-failure', 'protected'] as const) it(`default adapter publishes XML replacements with retained identity: ${mode}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments, toByteSource } = await import('safe-bash-contracts');
  const { readPackage } = await import('safe-bash-presentation-engine/package-reader');
  const bytes = deck(), owner = createMemoryFileSystem(), overrides: Partial<typeof owner> = {}, chunks: Uint8Array[] = [];
  const fs = new Proxy(owner, { get(target, key) { if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key); const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  await fs.writeFile('/input.pptx', bytes);
  const source = await readPackage(bytes), replacement = encode(new TextDecoder().decode(source.get('/slide.xml')).replace('港 &amp; 😀', 'Changed text'));
  await fs.writeFile('/replacement.xml', replacement);
  if (mode === 'force' || mode === 'exists') await fs.writeFile('/output.pptx', encode('old'));
  const read = fs.readFile.bind(fs), stage = fs.createStagedFile!.bind(fs);
  let written = 0, outstanding = 0, peak = 0;
  overrides.readFile = async () => { throw new Error('whole-file read forbidden'); };
  overrides.createStagedFile = async (...args) => {
    const item = await stage(...args);
    return { ...item, writer: { async write(chunk, options) {
      outstanding += chunk.length; peak = Math.max(peak, outstanding);
      try {
        await Promise.resolve();
        if (mode === 'write-failure') throw new Error('injected output failure');
        if (mode === 'stale' && written === 0) await fs.writeFile('/input.pptx', encode('changed'));
        await item.writer!.write(chunk, options); written += chunk.length;
      } finally { outstanding -= chunk.length; }
    }, finish: item.writer!.finish.bind(item.writer) } };
  };
  const inPlace = mode === 'in-place' || mode === 'stale';
  const args = createCommandArguments(['xml', 'set', '/input.pptx', '--part', '/slide.xml', '--file', '/replacement.xml',
    ...(inPlace ? ['--in-place'] : ['--output', mode === 'stdout' ? '-' : mode === 'protected' ? '/replacement.xml' : '/output.pptx']),
    ...(mode === 'force' || mode === 'protected' ? ['--force'] : []), ...(mode === 'dry-run' ? ['--dry-run'] : []),
    ...(mode === 'limit' ? ['--limit', 'maxOutputBytes=10'] : []), ...(mode === 'stdout' ? [] : ['--json'])]);
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args,
    cwd: '/', env: {}, fs, stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } } });
  const failure = ['exists', 'limit', 'stale', 'write-failure', 'protected'].includes(mode);
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(mode === 'limit' ? 4 : mode === 'stale' ? 1 : failure ? 3 : 0);
  expect(await read('/replacement.xml')).toEqual(replacement);
  expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(16384);
  if (mode === 'new' || mode === 'force' || mode === 'in-place' || mode === 'stdout') {
    const output = mode === 'stdout' ? Buffer.concat(chunks) : await read(inPlace ? '/input.pptx' : '/output.pptx');
    const archive = await readPackage(output);
    expect(new TextDecoder().decode(archive.get('/slide.xml'))).toContain('Changed text');
    if (mode !== 'stdout') expect(JSON.parse(Buffer.concat(chunks).toString()).data).toEqual({ part: '/slide.xml', dryRun: false });
  } else if (mode === 'exists') expect(await read('/output.pptx')).toEqual(encode('old'));
  else expect((await fs.readdir('/')).some(entry => entry.name === 'output.pptx')).toBe(false);
  if (mode !== 'in-place') expect(await read('/input.pptx')).toEqual(mode === 'stale' ? encode('changed') : bytes);
  expect((await fs.readdir('/')).every(entry => ['input.pptx', 'output.pptx', 'replacement.xml'].includes(entry.name))).toBe(true);
});

for (const change of ['noop', 'remove', 'malformed', 'namespace', 'missing', 'metadata', 'token'] as const) it(`preserves XML replacement selection and admission: ${change}`, async () => {
  const { readPackage } = await import('safe-bash-presentation-engine/package-reader');
  const bytes = deck(), archive = await readPackage(bytes), original = new TextDecoder().decode(archive.get('/slide.xml'));
  const replacement = encode(change === 'malformed' ? '<broken' : change === 'namespace' ? original.replace('drawingml/2006/main', 'invalid') : change === 'remove' ? original.slice(0, original.indexOf('<p:sp>')) + original.slice(original.indexOf('</p:sp>') + 7) : original);
  const fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  let token = '';
  if (change === 'token') { const inspected = await engine.execute({ args: ['inspect', '/deck.pptx', '--slide', '1', '--json'].map(encode), signal, readInput: async () => bytes }); token = JSON.parse(new TextDecoder().decode(inspected.stdout)).data.records[0].token; }
  const args = ['xml', 'set', '/deck.pptx', '--file', '/replacement.xml', ...(change === 'token' ? ['--select', token] : change === 'metadata' ? ['--scope', 'shared', '--part', '/[Content_Types].xml'] : ['--part', change === 'missing' ? '/absent.xml' : '/slide.xml']), '--output', '-'].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async path => path === '/replacement.xml' ? replacement : bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async path => { const data = path === '/replacement.xml' ? replacement : bytes; return { size: data.length, async read(p, n) { return data.subarray(p, p + n); }, async *stream() { yield data; } }; },
    stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout)); if (change === 'malformed') { expect(new TextDecoder().decode(result.stderr)).toContain('invalid-xml:'); expect(new TextDecoder().decode(expected.stderr)).toContain('invalid-xml:'); } else expect(result.stderr).toEqual(expected.stderr);
  if (change === 'noop') expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  expect(await fs.readdir('/')).toEqual([]);
});
