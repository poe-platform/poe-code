import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine, type PptxStreamPublicationRequest, type PptxPublicationRequest } from '../src/command-engine.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
const encode = (text: string) => new TextEncoder().encode(text);
async function collect(source: AsyncIterable<Uint8Array>) { const chunks: Uint8Array[] = []; for await (const bytes of source) chunks.push(new Uint8Array(bytes)); return Buffer.concat(chunks); }
for (const mode of ['success', 'atomic', 'partial', 'preflight', 'unsupported', 'limit', 'count'] as const) for (const json of [false, true]) it(`streams extraction publication and response: ${mode} json=${json}`, async () => {
  const bytes = storedArchive(Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  const args = ['extract', '/deck.pptx', '--output-dir', '/out', ...(mode === 'atomic' || mode === 'unsupported' ? [] : ['--allow-partial-output']), ...(json ? ['--json'] : []), ...(mode === 'limit' ? ['--limit', 'maxOutputBytes=20'] : mode === 'count' ? ['--limit', 'maxOutputs=1'] : [])].map(encode);
  let baselineWrites = 0, baselinePreflights = 0, writes = 0, preflights = 0;
  const expectedFiles: { path: string; bytes: Uint8Array }[] = [], actualFiles: { path: string; bytes: Uint8Array }[] = [];
  const expected = await engine.execute({ args, signal, readInput: async () => bytes,
    publishOutput: async item => { if (item.dryRun) { baselinePreflights++; if (mode === 'preflight') throw new Error('failed preflight'); return; } if (mode === 'partial' && baselineWrites++ === 1) throw new Error('failed write'); expectedFiles.push({ path: item.outputPath, bytes: item.bytes }); },
    ...(mode === 'atomic' ? { publishOutputs: async (items: readonly import('../src/command-engine.js').PptxPublicationRequest[]) => { for (const item of items) expectedFiles.push({ path: item.outputPath, bytes: item.bytes }); } } : {})
  });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const actual = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); },
    streaming: { workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
      stdout: { async write(bytes) { await Promise.resolve(); expect(bytes.length).toBeLessThanOrEqual(16384); stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } } },
    publishOutput: async (item: PptxPublicationRequest | PptxStreamPublicationRequest) => { if (item.dryRun) { preflights++; if (mode === 'preflight') throw new Error('failed preflight'); return; } expect(preflights).toBe(baselinePreflights); if (mode === 'partial' && writes++ === 1) throw new Error('failed write'); expect(item.bytes).not.toBeInstanceOf(Uint8Array); actualFiles.push({ path: item.outputPath, bytes: new Uint8Array(await collect(item.bytes as AsyncIterable<Uint8Array>)) }); },
    ...(mode === 'atomic' ? { preflightOutputStream: async (item: PptxStreamPublicationRequest) => { expect(item.dryRun).toBe(true); preflights++; }, publishOutputStreams: async (items: AsyncIterable<PptxStreamPublicationRequest>) => { for await (const item of items) actualFiles.push({ path: item.outputPath, bytes: new Uint8Array(await collect(item.bytes)) }); } } : {})
  });
  expect(actual.exitCode).toBe(expected.exitCode); expect(Buffer.concat([...stdout, actual.stdout])).toEqual(Buffer.from(expected.stdout)); expect(Buffer.concat([...stderr, actual.stderr])).toEqual(Buffer.from(expected.stderr));
  expect(actualFiles).toEqual(expectedFiles); expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['new', 'nested', 'exists', 'force', 'protected', 'partial', 'unsupported', 'unsupported-second', 'limit'] as const) it(`default adapter extracts through retained sources: ${mode}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments, toByteSource } = await import('safe-bash-contracts');
  const parts = Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) }));
  const bytes = storedArchive(parts), owner = createMemoryFileSystem(), directory = mode === 'nested' ? '/new/nested' : '/out';
  await owner.mkdir('/out');
  const input = mode === 'protected' ? '/out/part-000001.xml' : '/input.pptx';
  await owner.writeFile(input, bytes);
  if (mode === 'exists' || mode === 'force') await owner.writeFile('/out/part-000002.xml', encode('keep'));
  let publications = 0, outstanding = 0, peak = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'capabilitiesFor' && mode === 'unsupported-second') return async (path: string) => ({ ...owner.capabilities, ...(path.endsWith('/part-000002.xml') ? { atomicFileStaging: false } : {}) });
    if (key === 'createStagedFile') return async (...args: Parameters<NonNullable<typeof owner.createStagedFile>>) => {
      const staged = await owner.createStagedFile!(...args); const number = ++publications;
      return { ...staged, writer: { async write(bytes: Uint8Array, options?: Parameters<NonNullable<typeof staged.writer>['write']>[1]) {
        outstanding += bytes.length; peak = Math.max(peak, outstanding);
        try { await Promise.resolve(); if (mode === 'partial' && number === 2) throw new Error('injected publication failure'); await staged.writer!.write(bytes, options); }
        finally { outstanding -= bytes.length; }
      }, finish: staged.writer!.finish.bind(staged.writer) } };
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['extract', input, '--output-dir', directory, '--json', ...(mode === 'unsupported' ? [] : ['--allow-partial-output']), ...(mode === 'force' || mode === 'protected' ? ['--force'] : []), ...(mode === 'limit' ? ['--limit', 'maxOutputs=1'] : [])]);
  const chunks: Uint8Array[] = [];
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(chunk)); } }, stderr: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } } });
  const envelope = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.exitCode).toBe(['new', 'nested', 'force'].includes(mode) ? 0 : mode === 'limit' ? 4 : 3);
  expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(16384); expect(await owner.readFile(input)).toEqual(bytes);
  if (result.exitCode === 0 || mode === 'partial') {
    expect(envelope.data.outputs).toHaveLength(mode === 'partial' ? 1 : parts.length);
    for (const item of envelope.data.outputs) expect(await owner.readFile(item.path)).toEqual(parts.find(part => '/' + part.name === item.part)!.bytes);
    expect((await owner.readdir(directory)).length).toBe(mode === 'partial' ? 1 : parts.length);
  } else {
    expect(publications).toBe(0);
    expect((await owner.readdir('/out')).length).toBe(mode === 'exists' || mode === 'protected' ? 1 : 0);
  }
  expect((await owner.readdir('/')).every(entry => !entry.name.startsWith('.'))).toBe(true);
});

for (const mode of ['cancel', 'sink', 'transaction-failure', 'manifest-limit'] as const) it(`preserves extraction failure reporting: ${mode}`, async () => {
  const bytes = storedArchive(Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
  const fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), controller = new AbortController(), stdout: Uint8Array[] = []; let published = 0;
  const args = ['extract', '/deck.pptx', '--output-dir', mode === 'manifest-limit' ? '/' + 'x'.repeat(10000) : '/out', '--json', '--allow-partial-output', ...(mode === 'manifest-limit' ? ['--limit', 'maxOutputBytes=5000'] : [])].map(encode);
  const execution = engine.execute({ args, signal: controller.signal, readInput: async () => { throw new Error('buffered read forbidden'); },
    streaming: { workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }), stdout: { async write(bytes) { if (mode === 'sink') throw new Error('sink failed'); stdout.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected stderr'); } } },
    publishOutput: async (item: PptxPublicationRequest | PptxStreamPublicationRequest) => { if (item.dryRun) return; if (mode === 'cancel' && published === 1) { controller.abort(); throw new Error('cancelled write'); } await collect(item.bytes as AsyncIterable<Uint8Array>); published++; },
    ...(mode === 'transaction-failure' ? { publishOutputStreams: async () => { throw new Error('transaction rejected'); } } : {})
  });
  if (mode === 'sink') { await expect(execution).rejects.toThrow('sink failed'); expect(published).toBeGreaterThan(1); }
  else {
    const result = await execution, envelope = JSON.parse(Buffer.concat([...stdout, result.stdout]).toString());
    expect(result.exitCode).toBe(mode === 'cancel' ? 130 : mode === 'manifest-limit' ? 4 : 3);
    expect(published).toBe(mode === 'cancel' ? 1 : 0);
    expect(envelope.affected).toBe(mode === 'cancel' ? 1 : 0);
    if (mode === 'cancel') { expect(envelope.data.outputs).toHaveLength(1); expect(envelope.errors[0].code).toBe('cancelled'); }
    else expect(envelope.data).toBeNull();
  }
  expect(await fs.readdir('/')).toEqual([]);
});
