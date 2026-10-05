import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine, type PptxPublicationRequest, type PptxStreamPublicationRequest } from '../src/command-engine.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
const encode = (text: string) => new TextEncoder().encode(text);
function inputs() {
  const files = new Map<string, Uint8Array>();
  const parts = Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text], index) => { const bytes = encode(text!), file = `/source/${index}.xml`; files.set(file, bytes); return { part: path.slice(5), sha256: createHash('sha256').update(bytes).digest('hex'), file: { vfsPath: `${index}.xml` } }; });
  files.set('/source/manifest.json', encode(JSON.stringify({ parts }))); return files;
}
for (const mode of ['human', 'json', 'stdout', 'dry-run'] as const) it(`packs through retained streams with buffered result parity: ${mode}`, async () => {
  const files = inputs(), fs = createMemoryFileSystem(), signal = new AbortController().signal, engine = createPptxCommandEngine();
  const args = ['pack', '--manifest', '/source/manifest.json', ...(mode === 'dry-run' ? ['--dry-run'] : ['--output', mode === 'stdout' ? '-' : '/output.pptx']), ...(mode === 'json' ? ['--json'] : [])].map(encode);
  let expectedBytes: Uint8Array | undefined, actualBytes: Uint8Array | undefined; const chunks: Uint8Array[] = [];
  const expected = await engine.execute({ args, signal, readInput: async path => files.get(path)!, publishOutput: async publication => { expectedBytes = publication.bytes; } });
  const actual = await engine.execute({ args, signal, readInput: async () => { throw new Error('buffered input forbidden'); }, streaming: { workingStorage: { fs, directory: '/', cacheBytes: 16384 },
    openInput: async path => { const bytes = files.get(path)!; return { size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); }, async *stream() { for (let offset = 0; offset < bytes.length; offset += 17) yield bytes.subarray(offset, offset + 17); } }; },
    stdout: { async write(bytes) { expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write() { throw new Error('unexpected error sink'); } }
  }, publishOutput: async (publication: PptxPublicationRequest | PptxStreamPublicationRequest) => {
    expect(publication.bytes).not.toBeInstanceOf(Uint8Array); const output: Uint8Array[] = [];
    for await (const bytes of publication.bytes as AsyncIterable<Uint8Array>) { expect(bytes.length).toBeLessThanOrEqual(16384); output.push(new Uint8Array(bytes)); }
    actualBytes = new Uint8Array(Buffer.concat(output));
    const protectedPaths = []; for await (const path of publication.protectedInputPaths ?? []) protectedPaths.push(path); expect(protectedPaths).toEqual([...files.keys()].reverse().slice(0, 1).concat([...files.keys()].slice(0, -1)));
  } });
  expect(actual.exitCode, new TextDecoder().decode(actual.stderr)).toBe(0); expect(actual.stderr).toEqual(expected.stderr); expect(new Uint8Array(Buffer.concat([...chunks, actual.stdout]))).toEqual(expected.stdout); expect(actualBytes).toEqual(expectedBytes); expect(await fs.readdir('/')).toEqual([]);
});
for (const mode of ['new', 'force', 'exists', 'dry-run', 'stdout', 'protected', 'missing', 'bad-hash', 'limit', 'write-failure', 'cancel'] as const) it(`default pack uses retained reads and atomic publication: ${mode}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments, toByteSource } = await import('safe-bash-contracts');
  const { packPackage } = await import('safe-bash-presentation-engine/package-tools');
  const { resourceContext } = await import('safe-bash-presentation-engine/resource-limits');
  const files = inputs(), owner = createMemoryFileSystem(), controller = new AbortController(), chunks: Uint8Array[] = [];
  await owner.mkdir('/source'); await owner.mkdir('/scratch');
  for (const [path, bytes] of files) await owner.writeFile(path, bytes);
  const rows = JSON.parse(new TextDecoder().decode(files.get('/source/manifest.json'))).parts as { part: string; sha256: string; file: { vfsPath: string } }[];
  const expected = await packPackage(rows.map(row => ({ part: row.part, sha256: row.sha256, bytes: files.get('/source/' + row.file.vfsPath)! })), resourceContext());
  if (mode === 'bad-hash') await owner.writeFile('/source/0.xml', encode('changed'));
  if (mode === 'missing') await owner.unlink('/source/0.xml');
  if (mode === 'force' || mode === 'exists') await owner.writeFile('/output.pptx', encode('old'));
  let opened = 0, written = 0, peak = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === 'readFile') return async () => { throw new Error('whole-file read forbidden'); };
    if (key === 'openReadFile') return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => { opened++; return owner.openReadFile!(...args); };
    if (key === 'createStagedFile') return async (...args: Parameters<NonNullable<typeof owner.createStagedFile>>) => {
      const staged = await owner.createStagedFile!(...args);
      return { ...staged, writer: { async write(bytes: Uint8Array, options: Parameters<NonNullable<typeof staged.writer>['write']>[1]) {
        if (mode === 'write-failure') throw new Error('output failure'); if (mode === 'cancel') controller.abort();
        peak = Math.max(peak, bytes.length); await Promise.resolve(); await staged.writer!.write(bytes, options); written += bytes.length;
      }, finish: staged.writer!.finish.bind(staged.writer) } };
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const args = createCommandArguments(['pack', '--manifest', '/source/manifest.json', '--output', mode === 'stdout' ? '-' : mode === 'protected' ? '/source/0.xml' : '/output.pptx', ...(mode === 'force' || mode === 'protected' ? ['--force'] : []), ...(mode === 'dry-run' ? ['--dry-run'] : []), ...(mode === 'limit' ? ['--limit', 'maxOutputBytes=10'] : []), ...(mode === 'stdout' ? [] : ['--json'])]);
  const run = Promise.resolve(createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args, cwd: '/', env: { TMPDIR: '/scratch' }, fs, stdin: toByteSource(''), signal: controller.signal, stdout: { async write(bytes) { peak = Math.max(peak, bytes.length); chunks.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } }));
  if (mode === 'cancel') { const result = await run; expect(result.exitCode).toBe(130); }
  else {
    const result = await run, failed = ['exists', 'protected', 'missing', 'bad-hash', 'limit', 'write-failure'].includes(mode);
    expect(result.exitCode === 0, Buffer.concat(chunks).toString()).toBe(!failed);
    if (mode === 'new' || mode === 'force' || mode === 'stdout') expect(mode === 'stdout' ? new Uint8Array(Buffer.concat(chunks)) : await owner.readFile('/output.pptx')).toEqual(expected);
    if (mode === 'exists') expect(await owner.readFile('/output.pptx')).toEqual(encode('old'));
  }
  expect(opened).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(16384);
  if (!['new', 'force', 'exists'].includes(mode)) expect((await owner.readdir('/')).some(entry => entry.name === 'output.pptx')).toBe(false);
  if (mode === 'dry-run') expect(written).toBe(0);
  expect(await owner.readdir('/scratch')).toEqual([]);
});
