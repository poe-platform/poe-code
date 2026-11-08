import { test } from 'vitest';
import assert from 'node:assert/strict';
import { run, defaultLimits, type InvocationContext } from './engine.js';
import { utf8Codec } from './codecs/utf8.js';
import { createSqlTransportProvider } from './sql-transport.js';

for (const command of ['csvsql', 'sql2csv'] as const) test(`explicit PostgreSQL connection supports the actual ${command} SDK engine`, async () => {
  const effects: unknown[] = [];
  const provider = createSqlTransportProvider({ profile: 'postgresql-positional-v1', authorize: async () => true,
    connect: async () => ({
      transaction: async operation => { effects.push(operation); }, close: async () => { effects.push('close'); },
      execute: async ({ sql, values, options }) => {
        effects.push([sql, values]);
        if (sql === 'select 1') {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), { stream_results: true, no_parameters: true });
          let read = false;
          return { columns: ['value'], read: async () => { if (read) return null; read = true; return ['ok']; }, cancel: async () => {}, close: async () => {} };
        }
        return { columns: null, read: async () => null, cancel: async () => {}, close: async () => {} };
      }
    }) });
  let stdout = '', stderr = '';
  const context: InvocationContext = {
    cwd: '/', fs: { readFile: async () => { throw new Error('no files'); }, writeFile: async () => { throw new Error('no files'); } },
    stdin: (async function* () { yield new TextEncoder().encode('name\nalice\n'); })(), stdinIsDefault: false,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }, env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
    locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' }, clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal, registerCleanup: () => {}
  };
  const status = await run({ command, settings: { connection_string: 'postgresql://allowed/db', ...(command === 'csvsql' ? { insert: true, sniff_limit: 0 } : { query: 'select 1' }) } }, context);
  assert.deepEqual({ stdout, stderr, status }, { stdout: command === 'csvsql' ? '' : 'value\nok\n', stderr: '', status: 0 });
  assert.deepEqual(effects.slice(-3), command === 'csvsql' ? [['INSERT INTO stdin (name) VALUES ($1)', ['alice']], 'commit', 'close'] : [['select 1', []], 'rollback', 'close']);
});
