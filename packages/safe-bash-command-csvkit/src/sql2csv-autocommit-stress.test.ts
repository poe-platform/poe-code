import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Volume } from 'memfs';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { createMemorySqliteFileSystem } from './sqlite-memory.js';
import { CsvkitBlocked, CsvkitDiagnostic } from './errors.js';
import type { DatabaseSession, SqlValue } from './contracts.js';

// Read the installed engine bytes; all database files/effects remain in memfs.
const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const signal = new AbortController().signal;

async function statement(session: DatabaseSession, sql: string, options: Readonly<Record<string, unknown>> = {}) {
  const result = await session.query(sql, [], options, signal);
  try {
    const rows = [];
    for await (const row of result.rows) rows.push(row);
    return rows;
  } finally { await result.close(); }
}

function fixture() {
  const volume = Volume.fromJSON({ '/db/.keep': '' });
  return createSqliteDatabaseProvider({ sqlite,
    vfs: createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith('/db/'), maxBytes: 1_000_000 }),
    cwd: '/db', clock: { now: () => 0 }, random: bytes => bytes.fill(9)
  });
}

for (const level of ['SERIALIZABLE', 'READ UNCOMMITTED', 'autocommit', null, 0] satisfies SqlValue[]) {
  test(`SQLite sql2csv unqualified isolation level remains an explicit blocker: ${level}`, async () => {
    const provider = fixture();
    try {
      const session = await provider.connect('sqlite:///effects.db', {}, signal);
      try {
        await assert.rejects(statement(session, 'CREATE TABLE blocked (a INTEGER)', { isolation_level: level }), error => error instanceof CsvkitBlocked && error.status === 78 && error.message === 'csvkit: unsupported or unqualified: SQLite isolation level profile');
        assert.deepEqual(await statement(session, "SELECT name FROM sqlite_master WHERE name='blocked'"), []);
      } finally { await session.close(); }
    } finally { await provider.dispose(); }
  });
}

test('SQLite refuses changing isolation after a previous SELECT before executing DML', async () => {
  const provider = fixture();
  try {
    const session = await provider.connect('sqlite:///effects.db', {}, signal);
    try {
      await statement(session, 'CREATE TABLE t (a INTEGER)');
      await statement(session, 'SELECT 1');
      await assert.rejects(statement(session, 'INSERT INTO t VALUES (2)', { isolation_level: 'AUTOCOMMIT' }), error => error instanceof CsvkitBlocked);
      assert.deepEqual(await statement(session, 'SELECT a FROM t'), []);
    } finally { await session.close(); }
  } finally { await provider.dispose(); }
});

test('SQLite explicit BEGIN under first-statement AUTOCOMMIT still rolls back owned DML', async () => {
  const provider = fixture();
  try {
    const setup = await provider.connect('sqlite:///effects.db', {}, signal);
    try { await statement(setup, 'CREATE TABLE t (a INTEGER)'); }
    finally { await setup.close(); }
    const session = await provider.connect('sqlite:///effects.db', {}, signal);
    try {
      await statement(session, 'BEGIN', { isolation_level: 'AUTOCOMMIT' });
      await statement(session, 'INSERT INTO t VALUES (2)');
      assert.deepEqual(await statement(session, 'SELECT a FROM t'), [[2n]]);
      await session.rollback();
    } finally { await session.close(); }
    const verify = await provider.connect('sqlite:///effects.db', {}, signal);
    try { assert.deepEqual(await statement(verify, 'SELECT a FROM t'), []); }
    finally { await verify.close(); }
  } finally { await provider.dispose(); }
});

test('SQLite AUTOCOMMIT integrity failure closes cleanly and leaves previously persisted DML intact', async () => {
  const provider = fixture();
  try {
    const setup = await provider.connect('sqlite:///effects.db', {}, signal);
    try { await statement(setup, 'CREATE TABLE t (a INTEGER UNIQUE)'); }
    finally { await setup.close(); }
    const session = await provider.connect('sqlite:///effects.db', {}, signal);
    try {
      await statement(session, 'INSERT INTO t VALUES (2)', { isolation_level: 'AUTOCOMMIT' });
      await assert.rejects(statement(session, 'INSERT INTO t VALUES (2)'), error => error instanceof CsvkitDiagnostic && error.message.includes('IntegrityError'));
      await session.rollback();
    } finally { await session.close(); await session.close(); }
    const verify = await provider.connect('sqlite:///effects.db', {}, signal);
    try { assert.deepEqual(await statement(verify, 'SELECT a FROM t'), [[2n]]); }
    finally { await verify.close(); }
  } finally { await provider.dispose(); }
});
