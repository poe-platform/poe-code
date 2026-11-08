import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import init from '@sqlite.org/sqlite-wasm';
import { test } from 'vitest';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { defaultLimits, execute } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext } from './contracts.js';

const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const signal = new AbortController().signal;

for (const [sql, stdout, detail, kind, code] of [
  ['SELECT floor(1.5) AS floored', 'floored\n1\n'],
  ['SELECT floor(-1.5) AS negative, floor(-0.0) AS zero, typeof(floor(1.5)) AS type', 'negative,zero,type\n-2,0,integer\n'],
  ['SELECT floor(9223372036854775807) AS maximum, floor(-9223372036854775808) AS minimum', 'maximum,minimum\n9223372036854775807,-9223372036854775808\n'],
  ['SELECT floor(9007199254740992.0) AS exact, typeof(floor(9007199254740992.0)) AS type', 'exact,type\n9007199254740992,integer\n'],
  ['SELECT floor(NULL)', '', 'user-defined function raised exception', 'OperationalError', 'e3q8'],
  ["SELECT floor('2.5')", '', 'user-defined function raised exception', 'OperationalError', 'e3q8'],
  ["SELECT floor(x'32')", '', 'user-defined function raised exception', 'OperationalError', 'e3q8'],
  ['SELECT floor(1e999)', '', 'string or blob too big', 'DataError', '9h9h'],
  ['SELECT floor(-1e999)', '', 'string or blob too big', 'DataError', '9h9h'],
  ['SELECT floor(9223372036854775808.0)', '', 'string or blob too big', 'DataError', '9h9h'],
  ['SELECT floor(-9223372036854777856.0)', '', 'string or blob too big', 'DataError', '9h9h'],
  ['SELECT floor()', '', 'wrong number of arguments to function floor()', 'OperationalError', 'e3q8'],
  ['SELECT floor(1,2)', '', 'wrong number of arguments to function floor()', 'OperationalError', 'e3q8']
] as const) test(`native SQLAlchemy floor stdout/stderr/status: ${sql}`, async () => {
  const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  let stdoutActual = '', stderr = '';
  const cleanups: (() => Promise<void>)[] = [];
  const context: CsvkitContext = {
    argv: new OwnedArguments(['--query', sql].map(value => new TextEncoder().encode(value)), defaultLimits),
    cwd: '/', fs: { readFile: async () => assert.fail('unexpected file read'), writeFile: async () => assert.fail('unexpected file write') },
    stdin: { [Symbol.asyncIterator]() { assert.fail('query must not read stdin'); } }, stdinIsDefault: false,
    stdout: { write: async bytes => { stdoutActual += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
    locale: { profile: 'C', timezone: 'UTC', formatNumber: String }, clock: { now: () => 0 },
    limits: defaultLimits, signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
  };
  try {
    const status = await execute('sql2csv', context);
    assert.deepEqual({ status, stdout: stdoutActual, stderr }, {
      status: detail ? 1 : 0, stdout,
      stderr: detail ? `${kind}: (sqlite3.${kind}) ${detail}\n[SQL: ${sql}]\n(Background on this error at: https://sqlalche.me/e/20/${code})\n` : ''
    });
  } finally { await Promise.all(cleanups.map(cleanup => cleanup())); await provider.dispose(); }
});

test('floor callback error preserves rollback and subsequent statement admission', async () => {
  const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    for (const sql of ['CREATE TABLE t(x INTEGER)', 'INSERT INTO t VALUES (1)']) {
      const result = await session.query(sql, [], {}, signal); await result.close();
    }
    await session.commit(signal);
    const insert = await session.query('INSERT INTO t VALUES (2)', [], {}, signal); await insert.close();
    await assert.rejects(session.query('SELECT floor(NULL)', [], {}, signal), /user-defined function raised exception/);
    await session.rollback();
    const result = await session.query('SELECT x,floor(-1.5),typeof(floor(-1.5)) FROM t', [], {}, signal);
    try {
      const rows = []; for await (const row of result.rows) rows.push(row);
      assert.deepEqual(rows, [[1n, -2n, 'integer']]);
    } finally { await result.close(); }
  } finally { await session.close(); await provider.dispose(); }
});
