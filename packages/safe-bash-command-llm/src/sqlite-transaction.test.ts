import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { transactSqlite } from './sqlite-transaction.js';
import { withSqliteStatement } from './sqlite-statement.js';

const signal = new AbortController().signal;
const limits = { maxFileBytes: 1048576, maxIndexBytes: 1048576, maxOpenFiles: 8 };

test('canonical transactions persist native rows and clean private storage', async () => {
  const fs = new MemoryFileSystem();
  const options = { fs, path: '/logs.db', signal, ...limits };
  const first = await transactSqlite(options, async session => {
    await session.execute("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('one');");
    return 17;
  });
  assert.equal(first.value, 17);
  assert.deepEqual(first.cleanupErrors, []);
  assert.deepEqual(await fs.stat('/logs.db'), first.committed);
  const second = await transactSqlite(options, async session => withSqliteStatement(session.module,
    { ...session, signal, sql: 'SELECT value FROM sample' }, async statement => {
      const rows = [];
      for await (const row of statement.rows([], ['text'])) rows.push(row);
      return rows;
    }));
  assert.deepEqual(second.value, [['one']]);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
});

test('callback failure leaves the canonical database unchanged', async () => {
  const fs = new MemoryFileSystem();
  const options = { fs, path: '/logs.db', signal, ...limits };
  await transactSqlite(options, async session => session.execute('CREATE TABLE sample(value);'));
  const original = await fs.readFile('/logs.db');
  await assert.rejects(transactSqlite(options, async session => {
    await session.execute('INSERT INTO sample VALUES (1);');
    throw new Error('abort operation');
  }), { message: 'abort operation' });
  assert.deepEqual(await fs.readFile('/logs.db'), original);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
});

for (const suffix of ['', '-wal', '-journal', '-shm']) test(`concurrent canonical ${suffix || 'database'} changes reject publication`, async () => {
  const fs = new MemoryFileSystem();
  const options = { fs, path: '/logs.db', signal, ...limits };
  await transactSqlite(options, async session => session.execute('CREATE TABLE sample(value);'));
  const original = await fs.readFile('/logs.db');
  await assert.rejects(transactSqlite(options, async session => {
    await session.execute('INSERT INTO sample VALUES (1);');
    await fs.writeFile(`/logs.db${suffix}`, new Uint8Array([9]));
  }), { code: 'EAGAIN' });
  assert.deepEqual(await fs.readFile(`/logs.db${suffix}`), new Uint8Array([9]));
  if (suffix) assert.deepEqual(await fs.readFile('/logs.db'), original);
  assert.equal((await fs.readdir('/')).length, suffix ? 2 : 1);
});

test('cancellation before commit preserves canonical data and retires private resources', async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const options = { fs, path: '/logs.db', signal: controller.signal, ...limits };
  await assert.rejects(transactSqlite(options, async session => {
    await session.execute('CREATE TABLE sample(value);');
    controller.abort(new Error('cancel transaction'));
  }));
  assert.deepEqual(await fs.readdir('/'), []);
});

test('native WAL fixtures retain committed rows and WAL mode after canonical publication', async () => {
  const { default: fixture } = await import('./fixtures/sqlite-wal-records.json', { with: { type: 'json' } });
  for (const variant of fixture.variants) {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/logs.db', Buffer.from(fixture.database, 'base64'));
    await fs.writeFile('/logs.db-wal', Buffer.from(variant.wal, 'base64'));
    const options = { fs, path: '/logs.db', signal, ...limits };
    for (let pass = 0; pass < 2; pass++) {
      const result = await transactSqlite(options, async session => withSqliteStatement(session.module,
        { ...session, signal, sql: 'SELECT id, content FROM schemas ORDER BY id' }, async statement => {
          const rows = [];
          for await (const row of statement.rows([], ['text', 'text'])) rows.push(row);
          return rows;
        }));
      assert.deepEqual(result.value, variant.rows, variant.name);
      assert.deepEqual((await fs.readFile('/logs.db')).slice(18, 20), new Uint8Array([2, 2]));
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
    }
  }
});

test('oversized snapshots fail without changing canonical bytes', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/logs.db', new Uint8Array(2048));
  await assert.rejects(transactSqlite({ fs, path: '/logs.db', signal, ...limits, maxFileBytes: 1024 }, async () => {}), { code: 'EFBIG' });
  assert.deepEqual(await fs.readFile('/logs.db'), new Uint8Array(2048));
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
});

test('native hot rollback journals recover the last committed rows', async () => {
  const { withPrivateSqliteSession } = await import('./sqlite-session.js');
  const fs = new MemoryFileSystem();
  await fs.mkdir('/private');
  let database!: Uint8Array;
  let journal!: Uint8Array;
  await withPrivateSqliteSession({ fs, directory: '/private', path: '/private/database', signal, ...limits }, async session => {
    await session.execute("PRAGMA page_size=512; PRAGMA cache_size=2; CREATE TABLE sample(value); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100) INSERT INTO sample SELECT zeroblob(1000) FROM n;");
    await session.execute("BEGIN IMMEDIATE; UPDATE sample SET value=zeroblob(1100);");
    database = await fs.readFile('/private/database');
    journal = await fs.readFile('/private/database-journal');
    assert.deepEqual(journal.slice(0, 8), new Uint8Array([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]));
    await session.execute('ROLLBACK');
  });
  await fs.writeFile('/logs.db', database);
  await fs.writeFile('/logs.db-journal', journal);
  const result = await transactSqlite({ fs, path: '/logs.db', signal, ...limits }, async session => withSqliteStatement(session.module,
    { ...session, signal, sql: 'SELECT COUNT(*), SUM(length(value)) FROM sample' }, async statement => {
      const rows = [];
      for await (const row of statement.rows([], ['integer', 'integer'])) rows.push(row);
      return rows;
    }));
  assert.deepEqual(result.value, [[100n, 100000n]]);
  await assert.rejects(fs.stat('/logs.db-journal'), { code: 'ENOENT' });
});

test('a committed receipt survives cleanup failure and late cancellation', async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let sabotage = false;
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'publishStagedFileSet') return async (...args: Parameters<typeof fs.publishStagedFileSet>) => {
      const receipt = await target.publishStagedFileSet(...args);
      sabotage = true;
      controller.abort(new Error('cancel after commit'));
      return receipt;
    };
    if (key === 'createStagedFile') return async (...args: Parameters<typeof fs.createStagedFile>) => {
      const staging = await target.createStagedFile(...args);
      if (args[1] === 'database') {
        const remove = staging.cleanup!.remove.bind(staging.cleanup);
        return { ...staging, cleanup: { ...staging.cleanup!, async remove() {
          await remove();
          if (sabotage) throw new Error('cleanup report failed');
        } } };
      }
      return staging;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const result = await transactSqlite({ fs: view, path: '/logs.db', signal: controller.signal, ...limits }, async session => {
    await session.execute('CREATE TABLE sample(value);');
    return 'committed';
  });
  assert.equal(result.value, 'committed');
  assert.deepEqual(result.committed, await fs.stat('/logs.db'));
  assert.equal(result.cleanupErrors.length, 1);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['logs.db']);
});
