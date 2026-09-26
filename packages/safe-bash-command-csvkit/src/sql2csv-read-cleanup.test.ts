import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execute, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext, DatabaseProvider } from './contracts.js';

for (const readFails of [false, true]) test(`sql2csv cancellation drains admitted ${readFails ? 'rejected' : 'successful'} row reads before driver disposal`, async () => {
  const effects: string[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  const caller = new AbortController();
  let started!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const provider: DatabaseProvider = { schemes: ['bound'], profile: 'in-memory-pending-read',
    async connect() {
      return { profile: 'in-memory-pending-read', async begin() { assert.fail('unexpected transaction begin'); }, async commit() { assert.fail('unexpected commit'); },
        async rollback() { effects.push('rollback'); }, async close() { effects.push('session-close'); },
        async query() { return { columns: ['value'], async close() { effects.push('result-close'); },
          rows: { [Symbol.asyncIterator]() { return {
            async next() { effects.push('next-start'); started(); await pending; effects.push('next-settled'); if (readFails) throw new Error('late read failure'); return { done: true as const, value: undefined }; },
            async return() { effects.push('iterator-return'); return { done: true as const, value: undefined }; }
          }; } }
        }; }
      };
    }
  };
  let stdout = '';
  const context: CsvkitContext = {
    argv: new OwnedArguments(['--db', 'bound://owned', '--query', 'SELECT pending'].map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/work',
    fs: { async readFile() { assert.fail('explicit SQL cannot read query files'); }, async writeFile() { assert.fail('unexpected file write'); } },
    stdin: { [Symbol.asyncIterator]() { assert.fail('explicit SQL cannot acquire stdin'); } }, stdinIsDefault: false,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() { assert.fail('cancellation cannot emit diagnostics'); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider], locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' },
    clock: { now: () => 0 }, limits: defaultLimits, signal: caller.signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  const execution = execute('sql2csv', context);
  const rejected = assert.rejects(execution, reason => reason === false);
  try {
    await admitted; caller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.ok(effects.includes('iterator-return'), 'return must be requested immediately to unblock cooperative reads');
    assert.ok(!effects.includes('result-close'), 'owned result must remain open while its admitted read is pending');
    assert.ok(!effects.includes('session-close'), 'owned connection must remain open while its admitted read is pending');
    release(); await rejected;
    assert.equal(stdout, 'value\n');
    assert.deepEqual(effects, ['next-start', 'iterator-return', 'next-settled', 'result-close', 'rollback', 'session-close']);
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.equal(effects.length, 6);
  } finally { release(); await rejected; await Promise.all(cleanups.map(cleanup => cleanup())); }
});
