import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import reference from '../../../docs/csvkit/csvsql-reference.json' with { type: 'json' };
import sqliteReference from '../../../docs/csvkit/sqlite-engine-reference.json' with { type: 'json' };
import { execute, defaultLimits } from './engine.js';
import { OwnedArguments } from './argv.js';
import { utf8Codec } from './codecs/utf8.js';
import type { CsvkitContext } from './contracts.js';

// Read an existing infrastructure asset, never create files or call native SQL.
const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const provider = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
const signal = new AbortController().signal;

test('SQLAlchemy empty-path SQLite URLs identify isolated in-memory databases', async () => {
  for (const url of ['sqlite://', 'sqlite:///', 'sqlite:///:memory:', 'sqlite+pysqlite:///']) {
    const session = await provider.connect(url, {}, signal);
    try {
      const result = await session.query('select 1 AS value', [], {}, signal);
      const rows = []; for await (const row of result.rows) rows.push(row);
      assert.deepEqual(rows, [[1n]]); await result.close();
    } finally { await session.close(); }
  }
});

test('SQLite refuses authority components with the frozen SQLAlchemy diagnostic', async () => {
  await assert.rejects(provider.connect('sqlite://host/file', {}, signal), error => error instanceof Error && error.message === 'Invalid SQLite URL: sqlite://host/file\nValid SQLite URL forms are:\n sqlite:///:memory: (or, sqlite://)\n sqlite:///relative/path/to/file.db\n sqlite:////absolute/path/to/file.db');
});

test('provider disposal closes connection admission before its cleanup microtask', async () => {
  const owned = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const closing = owned.dispose();
  const late = owned.connect('sqlite://', {}, signal);
  await assert.rejects(late, /disposed/);
  await closing;
});

// These original cases remain blockers, separately tested as explicit refusals.
const blockedQueries = new Set(['PRAGMA encoding', "SELECT CAST(x'80' AS TEXT) AS invalid",
  'CREATE VIRTUAL TABLE docs USING fts3(content)', 'CREATE VIRTUAL TABLE docs4 USING fts4(content)', 'CREATE VIRTUAL TABLE geo USING geopoly(a,b,c)',
  "SELECT 'abc' REGEXP '^a' AS matches"]);
const differentials = [
  ...reference.cases.flatMap((item, index) => item.argv.includes('--query') ? [{ ...item, command: 'csvsql', label: `csvsql ${index}` }] : []),
  ...sqliteReference.executables.filter(item => !blockedQueries.has(item.argv[1]!)).map((item, index) => ({ ...item, stdin: '', label: `sql2csv ${index}` }))
];
for (const item of differentials) {
  test(`bound SQLite 3.50.4 original differential ${item.label}`, async () => {
    let stdout = '', stderr = '';
    const cleanups: (() => Promise<void>)[] = [];
    const context: CsvkitContext = {
      argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: '/',
      fs: { readFile: async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }, writeFile: async () => assert.fail('write') },
      stdin: (async function* () { yield new TextEncoder().encode(item.stdin); })(), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [provider],
      locale: { profile: 'C', timezone: 'UTC', formatNumber: () => '' }, clock: { now: () => 0 },
      limits: defaultLimits, signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    const status = await execute(item.command, context);
    await Promise.all(cleanups.map(cleanup => cleanup()));
    assert.deepEqual({ stdout, stderr, status }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
  });
}

for (const item of sqliteReference.executables.filter(item => item.argv[1]!.startsWith('CREATE VIRTUAL TABLE'))) {
  test(`explicit absent-module blocker, not parity: ${item.argv[1]}`, async () => {
    assert.equal(item.status, 0); // Original reference succeeds; product remains blocked.
    const session = await provider.connect('sqlite://', {}, signal);
    try { await assert.rejects(session.query(item.argv[1]!, [], {}, signal), /host divergence.*virtual table module/); }
    finally { await session.close(); }
  });
}

test('bound SQLite executes recursive CTE, window, join, aggregation and exact scalar types', async () => {
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    const result = await session.query(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4)
      SELECT a.x, sum(b.x), row_number() OVER (ORDER BY a.x), 1.0, NULL, date('2000-01-01','+1 day')
      FROM n a JOIN n b ON b.x<=a.x GROUP BY a.x ORDER BY a.x DESC`, [], {}, signal);
    const rows = []; for await (const row of result.rows) rows.push(row);
    await result.close();
    assert.deepEqual(rows, [4, 3, 2, 1].map(x => [BigInt(x), BigInt(x * (x + 1) / 2), BigInt(x), { kind: 'float', value: '1.0' }, null, '2000-01-02']));
  } finally { await session.close(); }
});

test('bound SQLite rejects unbound file, ATTACH, extension loading and oversized VM work', async () => {
  await assert.rejects(provider.connect('sqlite:////private.db', {}, signal), /SQLite file VFS/);
  const bounded = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7), limits: { maxWork: 500 } });
  const session = await bounded.connect('sqlite://', {}, signal);
  try {
    for (const sql of ["ATTACH ':memory:' AS unbound", "SELECT load_extension('unbound')", "VACUUM INTO '/private.db'"])
      await assert.rejects(session.query(sql, [], {}, signal), /host divergence/);
    await assert.rejects(session.query('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n', [], {}, signal), /SQLite VM work budget/);
  } finally { await session.close(); }
});

test('bound provider disposal closes sessions/results and unregisters its VFS', async () => {
  const owned = createSqliteDatabaseProvider({ sqlite, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const session = await owned.connect('sqlite://', {}, signal);
  const result = await session.query('SELECT 1 UNION ALL SELECT 2', [], {}, signal);
  await owned.dispose(); await owned.dispose(); await result.close(); await session.close();
  await assert.rejects(owned.connect('sqlite://', {}, signal), /disposed/);
  await assert.rejects(session.commit(signal), /session closed/);
  await assert.rejects(session.hasTable!('any', 'other', signal), /session closed/);
});

test('partially failed VFS installation unregisters resources and preserves falsey failure identity', () => {
  let name = '';
  const failing = { ...sqlite, vfs: { ...sqlite.vfs, installVfs(options: Parameters<typeof sqlite.vfs.installVfs>[0]) {
    name = options.vfs!.name!;
    sqlite.vfs.installVfs(options);
    throw false;
  } } };
  assert.throws(() => createSqliteDatabaseProvider({ sqlite: failing, cwd: '/', clock: { now: () => 0 }, random: bytes => bytes.fill(7) }), error => error === false);
  assert.equal(sqlite.capi.sqlite3_vfs_find(name), 0);
});

test('SQLite reflection matches SQLAlchemy case, temporary-table and view visibility', async () => {
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    for (const sql of ['CREATE TABLE Owned(x)', 'CREATE TEMP TABLE Temporary(x)', 'CREATE VIEW Visible AS SELECT x FROM Owned']) {
      const result = await session.query(sql, [], {}, signal); await result.close();
    }
    for (const item of sqliteReference.reflection) assert.equal(await session.hasTable!(item.name, item.schema, signal), item.exists, JSON.stringify(item));
  } finally { await session.close(); }
});

test('SQLite preserves reference double-quoted string literals and exposes compile-profile blockers', async () => {
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    const result = await session.query('SELECT "unknown" AS x', [], {}, signal);
    const rows = []; for await (const row of result.rows) rows.push(row);
    assert.deepEqual(rows, [['unknown']]); await result.close();
    await assert.rejects(session.query('PRAGMA encoding', [], {}, signal), /SQLite host divergence: PRAGMA encoding/);
    await assert.rejects(session.query('PRAGMA busy_timeout=1000000', [], {}, signal), /SQLite host divergence: PRAGMA busy_timeout/);
    await assert.rejects(session.query("SELECT 'abc' REGEXP '^a'", [], {}, signal), /host divergence.*regexp/);
    const invalid = await session.query("SELECT CAST(x'80' AS TEXT)", [], {}, signal);
    await assert.rejects(async () => { for await (const ignoredRow of invalid.rows) assert.fail(`invalid UTF-8 was replaced: ${String(ignoredRow)}`); }, /SQLite invalid UTF-8 TEXT/);
  } finally { await session.close(); }
});

test('SQLite injected parameters preserve Boolean and typed scalar bind conversions', async () => {
  const session = await provider.connect('sqlite://', {}, signal);
  try {
    const result = await session.query('select ?, ?, ?, ?', [true, { kind: 'decimal', value: '1.25' }, { kind: 'date', value: '2026-09-18' }, { kind: 'timedelta', microseconds: -1n }], {}, signal);
    const rows = []; for await (const row of result.rows) rows.push(row);
    assert.deepEqual(rows, [[1n, { kind: 'float', value: '1.25' }, '2026-09-18', '1969-12-31 23:59:59.999999']]);
    await result.close();
  } finally { await session.close(); }
});
