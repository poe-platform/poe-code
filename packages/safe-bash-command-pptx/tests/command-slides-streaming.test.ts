import { expect, it } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { createPptxCommandEngine } from '../src/command-engine.js';
import { storedArchive } from '../../safe-bash-presentation-engine/tests/fixtures/archive.js';
import { fixture, xml, tree } from '../../safe-bash-presentation-engine/tests/fixtures/validation.js';
const encode = (text: string) => new TextEncoder().encode(text);
const deck = () => storedArchive(Object.entries(fixture({ 'slide.xml': xml('sld', tree('2')) }).toJSON()).map(([path, text]) => ({ name: path.slice(6), bytes: encode(text!) })));
for (const flags of [['--name', 'Renamed'], ['--hidden', 'true'], ['--hidden', 'false']]) it(`streams slide settings without buffered input: ${flags}`, async () => {
  const bytes = deck(), fs = createMemoryFileSystem(), engine = createPptxCommandEngine(), signal = new AbortController().signal;
  const args = ['slides', 'set', '/deck.pptx', '--slide', '1', ...flags, '--dry-run', '--json'].map(encode);
  const expected = await engine.execute({ args, signal, readInput: async () => bytes }), chunks: Uint8Array[] = [];
  const result = await engine.execute({ args, signal, readInput: async () => { throw new Error('whole input forbidden'); }, streaming: {
    workingStorage: { fs, directory: '/', cacheBytes: 16384 }, openInput: async () => ({ size: bytes.length, async read(p, n) { return bytes.subarray(p, p + n); }, async *stream() { yield bytes; } }),
    stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(chunk)); } }, stderr: { async write() { throw new Error('unexpected diagnostic sink'); } }
  } });
  expect(result.exitCode).toBe(0);
  const actual = JSON.parse(Buffer.concat([...chunks, result.stdout]).toString());
  const baseline = JSON.parse(new TextDecoder().decode(expected.stdout));
  const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === 'fingerprint' && typeof item === 'string' ? '<fingerprint>' : item));
  expect(normalize(actual)).toEqual(normalize(baseline));
  expect(await fs.readdir('/')).toEqual([]);
});

for (const mode of ['new', 'in-place', 'force', 'exists', 'dry-run', 'limit', 'stdout', 'stale', 'write-failure'] as const) it(`default adapter publishes slide settings with retained identity: ${mode}`, async () => {
  const { createPptxCommand } = await import('../src/index.js');
  const { createCommandArguments, toByteSource } = await import('safe-bash-contracts');
  const { readPackage } = await import('safe-bash-presentation-engine/package-reader');
  const bytes = deck(), owner = createMemoryFileSystem(), overrides: Partial<typeof owner> = {}, chunks: Uint8Array[] = [];
  const fs = new Proxy(owner, { get(target, key) { if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key); const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  await fs.writeFile('/input.pptx', bytes);
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
  const args = createCommandArguments(['slides', 'set', '/input.pptx', '--slide', '1', '--name', 'Renamed',
    ...(inPlace ? ['--in-place'] : ['--output', mode === 'stdout' ? '-' : '/output.pptx']),
    ...(mode === 'force' ? ['--force'] : []), ...(mode === 'dry-run' ? ['--dry-run'] : []),
    ...(mode === 'limit' ? ['--limit', 'maxOutputBytes=10'] : []), ...(mode === 'stdout' ? [] : ['--json'])]);
  const result = await createPptxCommand().execute({ command: 'pptx', args: args.args, argumentValues: args,
    cwd: '/', env: {}, fs, stdin: toByteSource(''), signal: new AbortController().signal,
    stdout: { async write(chunk) { expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } } });
  const failure = ['exists', 'limit', 'stale', 'write-failure'].includes(mode);
  expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(mode === 'limit' ? 4 : mode === 'stale' ? 1 : failure ? 3 : 0);
  expect(outstanding).toBe(0); expect(peak).toBeLessThanOrEqual(16384);
  if (mode === 'new' || mode === 'force' || mode === 'in-place' || mode === 'stdout') {
    const output = mode === 'stdout' ? Buffer.concat(chunks) : await read(inPlace ? '/input.pptx' : '/output.pptx');
    const archive = await readPackage(output);
    expect(new TextDecoder().decode(archive.get('/slide.xml'))).toContain('name="Renamed"');
    if (mode !== 'stdout') expect(JSON.parse(Buffer.concat(chunks).toString()).data.outputs[0].bytes).toBe(output.length);
  } else if (mode === 'exists') expect(await read('/output.pptx')).toEqual(encode('old'));
  else expect((await fs.readdir('/')).some(entry => entry.name === 'output.pptx')).toBe(false);
  if (mode !== 'in-place') expect(await read('/input.pptx')).toEqual(mode === 'stale' ? encode('changed') : bytes);
  expect((await fs.readdir('/')).every(entry => ['input.pptx', 'output.pptx'].includes(entry.name))).toBe(true);
});
