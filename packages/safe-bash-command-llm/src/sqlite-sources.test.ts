import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { FsError, type FileSystem } from 'safe-bash-contracts';
import { acquireSqliteSources } from './sqlite-sources.js';
import { createSqliteWalSnapshot } from './sqlite-wal.js';
import { scanSqliteRecords } from './sqlite-scan.js';
import { readSqliteValues } from './sqlite-values.js';
import fixtureWal from './fixtures/sqlite-wal-records.json' with { type: 'json' };

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/db');
  await fs.writeFile('/db/logs.db', new Uint8Array([1, 2]));
  await fs.writeFile('/db/logs.db-wal', new Uint8Array([3, 4]));
  return { fs, signal: new AbortController().signal };
}

test('retains a consistent SQLite source set including absent sidecars', async () => {
  const { fs, signal } = await fixture();
  const sources = await acquireSqliteSources(fs, '/db/logs.db', signal);
  try {
    assert.equal(sources.path, '/db/logs.db');
    assert.equal(sources.journal, null);
    assert.equal(sources.shm, null);
    assert.deepEqual(await sources.database!.file.read(0, 2), new Uint8Array([1, 2]));
    assert.deepEqual(await sources.wal!.file.read(0, 2), new Uint8Array([3, 4]));
    assert.equal(sources.validate(), true);
  } finally { await sources.close(); }
  await assert.rejects(sources.database!.file.read(0, 1), { code: 'EBADF' });
  await sources.close();
});

test('preserves missing database identity for a new transaction', async () => {
  const fs = new MemoryFileSystem();
  const sources = await acquireSqliteSources(fs, '/logs.db', new AbortController().signal);
  try {
    assert.equal(sources.database, null);
    assert.equal(sources.wal, null);
    assert.equal(sources.validate(), true);
    await fs.writeFile('/logs.db', new Uint8Array([9]));
    assert.throws(() => sources.validate(), { code: 'EAGAIN' });
  } finally { await sources.close(); }
});

for (const suffix of ['', '-wal', '-journal', '-shm']) test(`rejects source-set changes at ${suffix || 'database'} before further reads`, async () => {
  const { fs, signal } = await fixture();
  const sources = await acquireSqliteSources(fs, '/db/logs.db', signal);
  try {
    await fs.writeFile(`/db/logs.db${suffix}`, new Uint8Array([9]));
    await assert.rejects(sources.database!.file.read(0, 2), { code: 'EAGAIN' });
  } finally { await sources.close(); }
});

test('closes every acquired handle when a concurrent write invalidates acquisition', async () => {
  const { fs, signal } = await fixture();
  const open = fs.openReadFile.bind(fs);
  let acquired = 0, closed = 0;
  const intercepted: NonNullable<FileSystem['openReadFile']> = async (path, options) => {
    const handle = await open(path, options);
    acquired++;
    if (path.endsWith('-wal')) await fs.writeFile('/db/logs.db', new Uint8Array([9]));
    return { ...handle, close: async () => { closed++; await handle.close(); } };
  };
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'openReadFile') return intercepted;
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(acquireSqliteSources(view, '/db/logs.db', signal), { code: 'EAGAIN' });
  assert.equal(closed, acquired);
  assert.ok(acquired > 0);
});

test('closes prior handles if opening a later source fails', async () => {
  const { fs, signal } = await fixture();
  const open = fs.openReadFile.bind(fs);
  let closed = 0;
  const intercepted: NonNullable<FileSystem['openReadFile']> = async (path, options) => {
    if (path.endsWith('-wal')) throw new FsError('EACCES');
    const handle = await open(path, options);
    return { ...handle, close: async () => { closed++; await handle.close(); } };
  };
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'openReadFile') return intercepted;
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(acquireSqliteSources(view, '/db/logs.db', signal), { code: 'EACCES' });
  assert.equal(closed, 1);
});

test('revalidates sidecars after a pending database read', async () => {
  const { fs, signal } = await fixture();
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'openReadFile') return async (path: string) => {
      const handle = await target.openReadFile(path);
      return { ...handle, read: async (position: number, count: number) => {
        const bytes = await handle.read(position, count);
        await target.writeFile('/db/logs.db-journal', new Uint8Array([9]));
        return bytes;
      } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const sources = await acquireSqliteSources(view, '/db/logs.db', signal);
  try { await assert.rejects(sources.database!.file.read(0, 2), { code: 'EAGAIN' }); }
  finally { await sources.close(); }
});

test('honors per-read cancellation after the retained host returns', async () => {
  const { fs, signal } = await fixture();
  const operation = new AbortController();
  const reason = new Error('cancel read');
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'openReadFile') return async (path: string) => {
      const handle = await target.openReadFile(path);
      return { ...handle, read: async (position: number, count: number) => {
        const bytes = await handle.read(position, count);
        operation.abort(reason);
        return bytes;
      } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const sources = await acquireSqliteSources(view, '/db/logs.db', signal);
  try { await assert.rejects(sources.database!.file.read(0, 2, { signal: operation.signal }), error => error === reason); }
  finally { await sources.close(); }
});

test('caps individual retained reads independently of the database size', async () => {
  const { fs, signal } = await fixture();
  await fs.writeFile('/db/logs.db', new Uint8Array(65536));
  const sources = await acquireSqliteSources(fs, '/db/logs.db', signal);
  try { assert.equal((await sources.database!.file.read(0, 65536)).length, 16384); }
  finally { await sources.close(); }
});

test('requires an authoritative source-set guard before acquiring handles', async () => {
  const { fs, signal } = await fixture();
  let opened = false;
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'capabilities') return { ...target.capabilities, synchronousStagingResolution: false };
    if (key === 'openReadFile') return () => { opened = true; throw new Error('unexpected acquisition'); };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(acquireSqliteSources(view, '/db/logs.db', signal), { code: 'ENOTSUP' });
  assert.equal(opened, false);
});


test('acquired source sets reproduce native committed WAL rows', async () => {
  const fs = new MemoryFileSystem();
  const variant = fixtureWal.variants[7]!;
  await fs.writeFile('/logs.db', Buffer.from(fixtureWal.database, 'base64'));
  await fs.writeFile('/logs.db-wal', Buffer.from(variant.wal, 'base64'));
  const signal = new AbortController().signal;
  const sources = await acquireSqliteSources(fs, '/logs.db', signal);
  const index = await fs.open('/index', { access: 'readwrite', creation: 'exclusive' });
  try {
    const snapshot = await createSqliteWalSnapshot(sources.database!.file, sources.wal!.file, index, { signal, maxIndexBytes: 32 });
    try {
      const rows: string[][] = [];
      for await (const record of scanSqliteRecords(snapshot, 2, signal)) {
        const row: string[] = [];
        for (const value of await readSqliteValues(record, 2, signal)) {
          assert.ok(value !== null && typeof value === 'object');
          const parts: Uint8Array[] = [];
          for await (const bytes of value.bytes) parts.push(bytes);
          row.push(Buffer.concat(parts).toString('utf8'));
        }
        rows.push(row);
      }
      rows.sort((a, b) => a[0]!.localeCompare(b[0]!));
      assert.deepEqual(rows, variant.rows);
      sources.validate();
    } finally { await snapshot.close(); }
  } finally { await sources.close(); await index.close(); }
});
