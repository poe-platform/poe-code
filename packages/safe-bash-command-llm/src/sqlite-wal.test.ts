import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import fixture from './fixtures/sqlite-wal-records.json' with { type: 'json' };
import { createSqliteWalSnapshot } from './sqlite-wal.js';
import { scanSqliteRecords } from './sqlite-scan.js';
import { readSqliteValues } from './sqlite-values.js';

async function setup(wal = fixture.variants[7]!.wal) {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/db', Buffer.from(fixture.database, 'base64'));
  await fs.writeFile('/wal', Buffer.from(wal, 'base64'));
  const database = await fs.openReadFile('/db'), journal = await fs.openReadFile('/wal');
  const index = await fs.open('/index', { access: 'readwrite', creation: 'exclusive' });
  const controller = new AbortController();
  return { fs, database, journal, index, controller, async close() { await database.close(); await journal.close(); await index.close(); } };
}

test('WAL snapshots match native SQLite committed rows through corruption and partial tails', async () => {
  for (const variant of fixture.variants) {
    const state = await setup(variant.wal);
    let largestRead = 0;
    for (const file of [state.database, state.journal]) {
      const read = file.read.bind(file);
      file.read = (position, length, options) => { largestRead = Math.max(largestRead, length); return read(position, Math.min(length, 113), options); };
    }
    try {
      const snapshot = await createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 });
      const rows: string[][] = [];
      for await (const record of scanSqliteRecords(snapshot, 2, state.controller.signal)) {
        const row: string[] = [];
        for (const value of await readSqliteValues(record, 2, state.controller.signal)) {
          assert.ok(value !== null && typeof value === 'object');
          assert.equal(value.type, 'text');
          const parts: Uint8Array[] = [];
          for await (const bytes of value.bytes) parts.push(bytes);
          row.push(Buffer.concat(parts).toString('utf8'));
        }
        rows.push(row);
      }
      rows.sort((a, b) => a[0]!.localeCompare(b[0]!));
      assert.deepEqual(rows, variant.rows, variant.name);
      assert.ok(largestRead <= 512);
      await snapshot.close();
      await assert.rejects(snapshot.read(0, 1), { code: 'EBADF' });
      assert.ok((await state.database.stat()).size > 0, 'caller retains source ownership');
    } finally { await state.close(); }
  }
});

test('WAL index quota and scratch ownership are checked before mutation', async () => {
  const state = await setup();
  try {
    await assert.rejects(createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 8 }), { code: 'EFBIG' });
    assert.equal((await state.index.stat()).size, 0);
    await state.index.write(new Uint8Array([1]), 0);
    await assert.rejects(createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 }), { code: 'EINVAL' });
    assert.equal((await state.index.stat()).size, 1);
  } finally { await state.close(); }
});

test('WAL snapshots reject source and index changes, invalid ranges and cancellation', async () => {
  for (const changed of ['database', 'journal', 'index', 'cancel'] as const) {
    const state = await setup();
    try {
      const snapshot = await createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 });
      await assert.rejects(snapshot.read(-1, 1), RangeError);
      await assert.rejects(snapshot.read(0, 65537), RangeError);
      if (changed === 'cancel') state.controller.abort(new Error('cancel WAL'));
      else if (changed === 'index') await state.index.write(new Uint8Array([1]), 0);
      else {
        const file = state[changed], stat = file.stat.bind(file);
        file.stat = async options => ({ ...await stat(options), size: 1 });
      }
      await assert.rejects(snapshot.read(0, 1), changed === 'cancel' ? /cancel WAL/ : { code: 'EBUSY' });
      await snapshot.close();
    } finally { await state.close(); }
  }
});

test('WAL acquisition observes cancellation and source changes before writing scratch', async () => {
  for (const reason of ['cancel', 'change'] as const) {
    const state = await setup();
    try {
      const read = state.journal.read.bind(state.journal);
      state.journal.read = async (...args) => {
        const bytes = await read(...args);
        if (reason === 'cancel') state.controller.abort(new Error('cancel acquisition'));
        else {
          const stat = state.journal.stat.bind(state.journal);
          state.journal.stat = async options => ({ ...await stat(options), size: 1 });
        }
        return bytes;
      };
      await assert.rejects(createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 }), reason === 'cancel' ? /cancel acquisition/ : { code: 'EBUSY' });
      assert.equal((await state.index.stat()).size, 0);
    } finally { await state.close(); }
  }
});

test('WAL scratch cannot alias an empty journal and individual reads observe cancellation', async () => {
  const state = await setup('');
  const alias = await state.fs.open('/wal', { access: 'readwrite', creation: 'never' });
  try {
    await assert.rejects(createSqliteWalSnapshot(state.database, state.journal, alias, { signal: state.controller.signal, maxIndexBytes: 32 }), { code: 'EINVAL' });
    const snapshot = await createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 });
    await assert.rejects(snapshot.read(0, 1, { signal: AbortSignal.abort(new Error('cancel read')) }), /cancel read/);
    assert.equal((await snapshot.read(0, 1)).length, 1);
    await snapshot.close();
  } finally { await alias.close(); await state.close(); }
});

test('a checksum-valid unsupported WAL format fails instead of silently reading stale rows', async () => {
  assert.equal(fixture.unsupportedVersionError, 'unable to open database file');
  const state = await setup(fixture.unsupportedVersionWal);
  try {
    await assert.rejects(createSqliteWalSnapshot(state.database, state.journal, state.index, { signal: state.controller.signal, maxIndexBytes: 32 }), { code: 'EIO', message: 'EIO: Unsupported SQLite WAL format version' });
    assert.equal((await state.index.stat()).size, 0);
  } finally { await state.close(); }
});
