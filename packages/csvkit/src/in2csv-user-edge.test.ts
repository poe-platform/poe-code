import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { execute, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import { pythonCodecs } from './codecs/python.js';
import reference from '../../../docs/csvkit/in2csv-user-edge-reference.json' with { type: 'json' };

for (const [index, item] of reference.cases.entries()) test(`in2csv user reference ${index}: ${item.argv.join(' ')}`, async () => {
  const volume = Volume.fromJSON(item.files, '/work');
  volume.mkdirSync('/work', { recursive: true });
  for (const [name, bytes] of Object.entries(item.binaries)) volume.writeFileSync(`/work/${name}`, Buffer.from(bytes, 'base64'));
  const before = volume.toJSON();
  let stdout = ''; let stderr = '';
  const cleanups: (() => Promise<void>)[] = [];
  try {
    const status = await execute('in2csv', {
      argv: new OwnedArguments(item.argv.map(arg => new TextEncoder().encode(arg)), defaultLimits), cwd: '/work',
      fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer), writeFile: async (path, bytes) => { volume.writeFileSync(path, bytes); } },
      stdin: (async function* () { yield new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: {},
      codecs: [utf8Codec, ...pythonCodecs], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    });
    assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
    assert.deepEqual(volume.toJSON(), before);
  } finally { for (const cleanup of cleanups) await cleanup(); }
});
