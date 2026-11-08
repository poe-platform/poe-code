import { test } from 'vitest';
import assert from 'node:assert/strict';
import { run, defaultLimits, type InvocationContext } from './engine.js';
import { utf8Codec } from './codecs/utf8.js';
import reference from '../../../docs/csvkit/sql-url-reference.json' with { type: 'json' };
import networkReference from '../../../docs/csvkit/sql-network-source-reference.json' with { type: 'json' };

for (const command of ['sql2csv', 'csvsql'] as const) for (const item of [...reference.cli, ...networkReference.commands.filter(item => item.command === command).map(item => ({ ...item, raw: item.argv[1]! }))]) test(`${command} SDK exact frozen driver diagnostic: ${item.raw}`, async () => {
  let stdout = '', stderr = '';
  const context: InvocationContext = {
    cwd: '/work', fs: { readFile: async () => { assert.fail('no file access'); }, writeFile: async () => { assert.fail('no file write'); } },
    stdin: { [Symbol.asyncIterator]() { assert.fail('no stdin access'); } }, stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: () => {}
  };
  const status = await run({ command, settings: { connection_string: item.raw, ...(command === 'sql2csv' ? { query: 'select 1' } : { queries: ['select 1'] }) } }, context);
  assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
});
