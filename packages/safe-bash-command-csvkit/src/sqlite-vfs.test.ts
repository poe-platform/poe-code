import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Volume } from 'memfs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import init from '@sqlite.org/sqlite-wasm';
import { createSqliteDatabaseProvider } from './sqlite.js';
import { createMemorySqliteFileSystem } from './sqlite-memory.js';
import { CsvkitBlocked } from './errors.js';

const wasmBinary = await readFile(createRequire(import.meta.url).resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'));
const sqlite = await init({ wasmBinary, print: () => {}, printErr: () => {} } as Parameters<typeof init>[0]);
const signal = new AbortController().signal;
const volume = Volume.fromJSON({ '/authorized/.keep': '' });
const vfs = createMemorySqliteFileSystem(volume, { authorize: path => path.startsWith('/authorized/'), maxBytes: 1_000_000 });
const provider = createSqliteDatabaseProvider({ sqlite, vfs, cwd: '/authorized', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
async function exec(session: Awaited<ReturnType<typeof provider.connect>>, sql: string) {
  const result = await session.query(sql, [], {}, signal);
  const rows = []; for await (const row of result.rows) rows.push(row);
  await result.close(); return rows;
}

for (const operation of ['read', 'lock'] as const) test(`SQLite VFS preserves named authorization failures from injected ${operation}`, async () => {
  const denied = new CsvkitBlocked(`SQLite host divergence: revoked ${operation} authorization`);
  const failing = createSqliteDatabaseProvider({ sqlite, cwd: '/authorized', clock: { now: () => 0 }, random: bytes => bytes.fill(7),
    vfs: { ...vfs, open(path, flags) {
      const file = vfs.open(path, flags);
      return { ...file, [operation]() { throw denied; } };
    } }
  });
  try { await assert.rejects(failing.connect('sqlite:///revoked.db', {}, signal), error => error === denied); }
  finally { await failing.dispose(); }
});

test('SQLite commit preserves named VFS sync failure and rollback releases the transaction', async () => {
  const denied = new CsvkitBlocked('SQLite host divergence: revoked sync authorization');
  let deny = false;
  const failing = createSqliteDatabaseProvider({ sqlite, cwd: '/authorized', clock: { now: () => 0 }, random: bytes => bytes.fill(7),
    vfs: { ...vfs, open(path, flags) {
      const file = vfs.open(path, flags);
      return { ...file, sync() { if (deny) throw denied; file.sync(); } };
    } }
  });
  const session = await failing.connect('sqlite:///sync-failure.db', {}, signal);
  try {
    await exec(session, 'CREATE TABLE t(x)');
    await exec(session, 'INSERT INTO t VALUES(1)');
    deny = true;
    await assert.rejects(session.commit(signal), error => error === denied);
    deny = false;
    await session.rollback();
    assert.deepEqual(await exec(session, 'SELECT * FROM t'), []);
    await exec(session, 'INSERT INTO t VALUES(2)');
    await session.commit(signal);
    assert.deepEqual(await exec(session, 'SELECT * FROM t'), [[2n]]);
  } finally { deny = false; await session.close(); await failing.dispose(); }
});

test('SQLite VFS persists committed pages, rolls back DML and preserves literal URL paths in memfs', async () => {
  const session = await provider.connect('sqlite:///persistent%20.db', {}, signal);
  await exec(session, 'CREATE TABLE t(x INTEGER UNIQUE)');
  await exec(session, 'INSERT INTO t VALUES(1)'); await session.commit(signal);
  await exec(session, 'INSERT INTO t VALUES(2)'); await session.rollback(); await session.close();
  assert.ok(volume.existsSync('/authorized/persistent%20.db'));
  assert.ok(!volume.existsSync('/authorized/persistent .db'));
  const reopened = await provider.connect('sqlite:///persistent%20.db', {}, signal);
  try { assert.deepEqual(await exec(reopened, 'SELECT x FROM t'), [[1n]]); }
  finally { await reopened.close(); }
  assert.ok(!volume.existsSync('/authorized/persistent%20.db-journal'));
});

test('SQLite VFS enforces shared/reserved/exclusive transaction contention and release', async () => {
  const a = await provider.connect('sqlite:///locking.db', {}, signal);
  await exec(a, 'CREATE TABLE t(x)');
  const b = await provider.connect('sqlite:///locking.db', {}, signal);
  try {
    await exec(a, 'BEGIN EXCLUSIVE');
    await assert.rejects(exec(b, 'SELECT * FROM t'), /locked/);
    await a.rollback();
    assert.deepEqual(await exec(b, 'SELECT * FROM t'), []);
    await exec(a, 'BEGIN IMMEDIATE');
    await assert.rejects(exec(b, 'INSERT INTO t VALUES(1)'), /locked/);
    await b.rollback(); await a.rollback();
    await exec(b, 'INSERT INTO t VALUES(2)'); await b.commit(signal);
    assert.deepEqual(await exec(a, 'SELECT * FROM t'), [[2n]]);
  } finally { await a.close(); await b.close(); }
});

test('SQLite VFS denies unauthorized paths, requires parents and propagates write failure', async () => {
  await assert.rejects(provider.connect('sqlite:////private.db', {}, signal));
  await assert.rejects(provider.connect('sqlite:////authorized/missing/db', {}, signal));
  const bounded = createMemorySqliteFileSystem(Volume.fromJSON({ '/authorized/.keep': '' }), { authorize: path => path.startsWith('/authorized/'), maxBytes: 500 });
  const limited = createSqliteDatabaseProvider({ sqlite, vfs: bounded, cwd: '/authorized', clock: { now: () => 0 }, random: bytes => bytes.fill(7) });
  const session = await limited.connect('sqlite:///limit.db', {}, signal);
  try { await assert.rejects(exec(session, 'CREATE TABLE too_large(x)'), /SQLite memory file byte budget/); }
  finally { await session.close(); }
});

test('memory VFS denies authorized spellings that resolve through symlinks', async () => {
  volume.writeFileSync('/private.db', 'private');
  volume.symlinkSync('/private.db', '/authorized/link.db');
  await assert.rejects(provider.connect('sqlite:///link.db', {}, signal), /host divergence.*symbolic link/);
  assert.equal(volume.readFileSync('/private.db', 'utf8'), 'private');
});

test('memory VFS rejects dangling symlink creation without effects outside authorization', async () => {
  volume.symlinkSync('/private-new.db', '/authorized/dangling.db');
  await assert.rejects(provider.connect('sqlite:///dangling.db', {}, signal), /host divergence.*symbolic link/);
  assert.equal(volume.existsSync('/private-new.db'), false);
});

test('SQLite relative file URL uses the invocation cwd instead of provider fallback cwd', async () => {
  volume.mkdirSync('/authorized/sub');
  const session = await provider.connect('sqlite:///relative.db', {}, signal, { cwd: '/authorized/sub' });
  try { await exec(session, 'CREATE TABLE location(x)'); }
  finally { await session.close(); }
  assert.equal(volume.existsSync('/authorized/sub/relative.db'), true);
  assert.equal(volume.existsSync('/authorized/relative.db'), false);
});
