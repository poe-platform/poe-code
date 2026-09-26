import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { createMemorySqliteFileSystem } from './sqlite-memory.js';
import { execute, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext, DatabaseSession } from './contracts.js';
import reference from '../../../docs/csvkit/sql2csv-reference.json' with { type: 'json' };

// Existing engine infrastructure only: no file creation, native processes or host DB.
const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const signal = new AbortController().signal;
async function sql(session: DatabaseSession, statement: string) {
  const result = await session.query(statement, [], {}, signal);
  try { const rows = []; for await (const row of result.rows) rows.push(row); return rows; }
  finally { await result.close(); }
}
for (const item of reference.databaseEffects) test(`sql2csv frozen SQLite DML effects: ${item.isolation ?? 'default rollback'}`, async () => {
  const volume = Volume.fromJSON({ '/db/.keep': '' });
  const provider = createSqliteDatabaseProvider({ sqlite,
    vfs: createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith('/db/'), maxBytes: 1_000_000 }),
    cwd: '/db', clock: { now: () => 0 }, random: bytes => bytes.fill(7)
  });
  const cleanups: (() => Promise<void>)[] = []; let stdout = '', stderr = '';
  try {
    const setup = await provider.connect('sqlite:///effect.db', {}, signal);
    try { await sql(setup, 'CREATE TABLE t (a INTEGER)'); await sql(setup, 'INSERT INTO t VALUES (1)'); await setup.commit(signal); }
    finally { await setup.close(); }
    const argv = ['--db', 'sqlite:///effect.db', '--query', 'INSERT INTO t VALUES (2)',
      ...(item.isolation ? ['--execution-option', 'isolation_level', item.isolation] : [])];
    const context: CsvkitContext = {
      argv: new OwnedArguments(argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/db',
      fs: { readFile: async () => { assert.fail('query overrides files'); }, writeFile: async () => { assert.fail('unexpected write'); } },
      stdin: { [Symbol.asyncIterator]() { assert.fail('query overrides stdin'); } }, stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
      locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' }, clock: { now: () => 0 },
      limits: defaultLimits, signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    const status = await execute('sql2csv', context);
    assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
    await Promise.all(cleanups.map(cleanup => cleanup()));
    const verify = await provider.connect('sqlite:///effect.db', {}, signal);
    try { assert.deepEqual(await sql(verify, 'SELECT a FROM t'), item.rows.map(row => row.map(value => BigInt(value)))); }
    finally { await verify.close(); }
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); await provider.dispose(); }
});
