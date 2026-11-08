import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, run, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import reference from '../../../docs/csvkit/in2csv-fixed-user-reference.json' with { type: 'json' };

for (const [index, item] of reference.cases.entries()) test(`in2csv fixed user slicing/schema reference ${index}`, async () => {
  const volume = Volume.fromJSON({ '/schema.csv': item.schema });
  const before = volume.toJSON();
  for (const sdk of [false, true]) {
    let stdout = ''; let stderr = '';
    const cleanups: (() => Promise<void>)[] = [];
    const context = {
      argv: new OwnedArguments(['-f', 'fixed', '-s', '/schema.csv'].map(arg => new TextEncoder().encode(arg)), defaultLimits), cwd: '/',
      fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); } },
      stdin: (async function* () { for (const byte of new TextEncoder().encode(item.stdin)) yield Uint8Array.of(byte); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: { PYTHONIOENCODING: 'utf-8' },
      codecs: [utf8Codec], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => { assert.fail('fixed conversion must not infer types'); } },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    } satisfies import('./contracts.js').CsvkitContext;
    try {
      const status = sdk ? await run({ command: 'in2csv', settings: { filetype: 'fixed', schema: '/schema.csv' } }, context) : await execute('in2csv', context);
      assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
      assert.deepEqual(volume.toJSON(), before);
    } finally { for (const cleanup of cleanups) await cleanup(); }
  }
});
