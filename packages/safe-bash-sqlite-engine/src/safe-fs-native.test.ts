import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createSqliteRuntime, FacadeVFS} from './index.js';
import {createSqliteVfs} from './safe-fs.js';

test('native SQLite commits and rolls back on caller-owned files and reopens the database', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/private');
  let reads = 0, writes = 0, maxTransfer = 0, opened = 0, closed = 0;
  const openFile = fs.open.bind(fs);
  fs.open = async (...args) => {
    assert.ok(args[0].startsWith('/private/'));
    const file = await openFile(...args);
    opened++;
    const read = file.read.bind(file), write = file.write.bind(file), close = file.close.bind(file);
    file.read = async (bytes, ...rest) => { reads++; maxTransfer = Math.max(maxTransfer, bytes.length); return read(bytes, ...rest); };
    file.write = async (bytes, ...rest) => { writes++; maxTransfer = Math.max(maxTransfer, bytes.length); return write(bytes, ...rest); };
    file.close = async (...rest) => { closed++; await close(...rest); };
    return file;
  };
  for (const sql of [
    'PRAGMA journal_mode=DELETE; CREATE TABLE vectors(id TEXT PRIMARY KEY, value BLOB); BEGIN; INSERT INTO vectors VALUES(\'one\', zeroblob(40001)); COMMIT; BEGIN; DELETE FROM vectors; ROLLBACK;',
    'CREATE TABLE verified(ok INTEGER CHECK(ok=1)); INSERT INTO verified SELECT count(*)=1 AND max(length(value))=40001 FROM vectors;',
  ]) {
    const {module} = await createSqliteRuntime();
    const vfs = createSqliteVfs({fs, directory: '/private', signal: new AbortController().signal, maxOpenFiles: 4, maxFileBytes: 1024 * 1024});
    assert.equal(module.vfs_register(Object.assign(new FacadeVFS('caller', module), vfs), true), 0);
    const open = module.cwrap('sqlite3_open_v2', 'number', ['string', 'number', 'number', 'string'], {async: true}) as (path: string, pointer: number, flags: number, vfs: string) => Promise<number>;
    const exec = module.cwrap('sqlite3_exec', 'number', ['number', 'string', 'number', 'number', 'number'], {async: true}) as (db: number, sql: string, callback: number, context: number, error: number) => Promise<number>;
    const close = module.cwrap('sqlite3_close', 'number', ['number'], {async: true}) as (db: number) => Promise<number>;
    const pointer = module._malloc(4);
    let db = 0;
    try {
      assert.equal(await open('/private/embeddings.db', pointer, 6, 'caller'), 0);
      db = new DataView(module.HEAPU8.buffer).getInt32(pointer, true);
      assert.equal(await exec(db, 'PRAGMA cache_size=-64; PRAGMA temp_store=FILE; ' + sql, 0, 0, 0), 0);
      vfs.throwIfFailed();
    } finally {
      if (db) assert.equal(await close(db), 0);
      module._free(pointer);
      await vfs.dispose();
    }
  }
  assert.ok(reads > 0 && writes > 0);
  assert.ok(maxTransfer <= 16384);
  assert.equal(opened, closed);
  assert.deepEqual((await fs.readdir('/private')).map(entry => entry.name), ['embeddings.db']);
});
