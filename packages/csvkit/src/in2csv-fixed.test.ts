import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, run, defaultLimits } from './engine.js';
import { createCompressionCodec } from '@poe-code/office-package/compression';
import { createGzipCompressionProvider } from './io/compression.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import { pythonCodecs } from './codecs/python.js';
import reference from '../../../docs/csvkit/in2csv-fixed-reference.json' with { type: 'json' };

for (const [index, item] of reference.cases.entries()) for (const sdk of index === 0 ? [false, true] : [false]) test(`in2csv fixed reference ${index} ${sdk ? 'SDK' : 'argv'}: ${item.argv.join(' ')}`, async () => {
  const volume = Volume.fromJSON(item.files, '/work');
  volume.mkdirSync('/work', { recursive: true });
  if ('binaries' in item) for (const [name, bytes] of Object.entries(item.binaries!)) volume.writeFileSync(`/work/${name}`, Buffer.from(bytes, 'base64'));
  const before = volume.toJSON();
  let stdout = ''; let stderr = '';
  const cleanups: (() => Promise<void>)[] = [];
  try {
    const context = {
      argv: new OwnedArguments(item.argv.map(arg => new TextEncoder().encode(arg)), defaultLimits), cwd: '/work',
      fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); } },
      stdin: (async function* () { yield 'stdinBase64' in item ? Buffer.from(item.stdinBase64!, 'base64') : new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: { PYTHONIOENCODING: 'utf-8' },
      codecs: [utf8Codec, ...pythonCodecs], compression: [createGzipCompressionProvider(createCompressionCodec())], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    } satisfies import('./contracts.js').CsvkitContext;
    const status = sdk ? await run({ command: 'in2csv', settings: { filetype: 'fixed', schema: 'schema.csv' } }, context) : await execute('in2csv', context);
    assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
    assert.deepEqual(volume.toJSON(), before);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});
