import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem, scopeFileSystem } from '@poe-code/safe-fs/core';
import { createPrivateSqliteStorage } from './sqlite-private.js';
import { withPrivateSqliteSession } from './sqlite-session.js';
import { withSqliteStatement } from './sqlite-statement.js';

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const controller = new AbortController();
  return { fs, controller };
}

test('owns private native files and removes them after descriptor use', async () => {
  const { fs, controller } = await fixture();
  const storage = await createPrivateSqliteStorage({ fs, directory: '/work', signal: controller.signal, maxFiles: 4 });
  const path = `${storage.directory}/embeddings.db`;
  const file = await storage.fs.open!(path, { access: 'readwrite', creation: 'ifMissing' });
  await file.write(new Uint8Array([1, 2, 3]), 0);
  await file.close();
  assert.equal((await storage.fs.stat(path)).size, 3);
  const reopened = await storage.fs.open!(path, { access: 'readwrite', creation: 'ifMissing' });
  const bytes = new Uint8Array(3);
  assert.equal(await reopened.read(bytes, 0), 3);
  assert.deepEqual(bytes, new Uint8Array([1, 2, 3]));
  await reopened.close();
  await storage.close();
  await storage.close();
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('native deletion only removes files created by the private owner', async () => {
  const { fs, controller } = await fixture();
  const storage = await createPrivateSqliteStorage({ fs, directory: '/work', signal: controller.signal, maxFiles: 4 });
  const path = `${storage.directory}/embeddings.db-journal`;
  const file = await storage.fs.open!(path, { access: 'readwrite', creation: 'ifMissing' });
  await file.close();
  await storage.fs.unlink!(path);
  await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
  await storage.close();
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('cleanup preserves a foreign replacement of a private filename', async () => {
  const { fs, controller } = await fixture();
  const storage = await createPrivateSqliteStorage({ fs, directory: '/work', signal: controller.signal, maxFiles: 4 });
  const path = `${storage.directory}/embeddings.db`;
  const file = await storage.fs.open!(path, { access: 'readwrite', creation: 'ifMissing' });
  await file.close();
  await fs.unlink(path);
  await fs.writeFile(path, new Uint8Array([9]));
  await assert.rejects(storage.fs.unlink!(path), { code: 'EAGAIN' });
  await assert.rejects(storage.close());
  assert.deepEqual(await fs.readFile(path), new Uint8Array([9]));
});

test('private cleanup survives shell-scope cancellation', async () => {
  const { fs, controller } = await fixture();
  const scoped = scopeFileSystem(fs, () => {}, controller.signal);
  const storage = await createPrivateSqliteStorage({ fs: scoped, directory: '/work', signal: controller.signal, maxFiles: 4 });
  const file = await storage.fs.open!(`${storage.directory}/embeddings.db`, { access: 'readwrite', creation: 'ifMissing' });
  await file.write(new Uint8Array([1]), 0);
  await file.close();
  controller.abort(new Error('stop'));
  await storage.close();
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('private storage refuses path escapes and bounded file-count overflow', async () => {
  const { fs, controller } = await fixture();
  const storage = await createPrivateSqliteStorage({ fs, directory: '/work', signal: controller.signal, maxFiles: 1 });
  try {
    for (const path of ['/outside', `${storage.directory}/../escape`, `${storage.directory}/nested/file`, `${storage.directory}/.owner`]) {
      await assert.rejects(storage.fs.open!(path, { access: 'readwrite', creation: 'ifMissing' }), { code: 'EACCES' });
    }
    const file = await storage.fs.open!(`${storage.directory}/one`, { access: 'readwrite', creation: 'ifMissing' });
    await file.close();
    await assert.rejects(storage.fs.open!(`${storage.directory}/two`, { access: 'readwrite', creation: 'ifMissing' }), { code: 'EMFILE' });
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir('/work'), []);
});


test('native transactions create and retire journals inside owned private storage', async () => {
  const { fs, controller } = await fixture();
  const storage = await createPrivateSqliteStorage({ fs, directory: '/work', signal: controller.signal, maxFiles: 8 });
  try {
    const result = await withPrivateSqliteSession({ fs: storage.fs, directory: storage.directory,
      path: `${storage.directory}/embeddings.db`, signal: controller.signal, maxFileBytes: 1048576, maxOpenFiles: 8,
    }, async session => {
      await session.execute("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('committed'); BEGIN; INSERT INTO sample VALUES ('rolled back'); ROLLBACK;");
      return withSqliteStatement(session.module, { ...session, sql: 'SELECT value FROM sample', signal: controller.signal }, async statement => {
        const rows = [];
        for await (const row of statement.rows([], ['text'])) rows.push(row);
        return rows;
      });
    });
    assert.deepEqual(result, [['committed']]);
    await assert.rejects(fs.lstat(`${storage.directory}/embeddings.db-journal`), { code: 'ENOENT' });
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('cancelled native transactions leave no owned scratch files', async () => {
  const { fs, controller } = await fixture();
  const scoped = scopeFileSystem(fs, () => {}, controller.signal);
  const storage = await createPrivateSqliteStorage({ fs: scoped, directory: '/work', signal: controller.signal, maxFiles: 8 });
  try {
    await assert.rejects(withPrivateSqliteSession({ fs: storage.fs, directory: storage.directory,
      path: `${storage.directory}/embeddings.db`, signal: controller.signal, maxFileBytes: 1048576, maxOpenFiles: 8,
    }, async session => {
      await session.execute('CREATE TABLE sample(value); BEGIN; INSERT INTO sample VALUES (1);');
      controller.abort(new Error('cancel transaction'));
      controller.signal.throwIfAborted();
    }));
  } finally { await storage.close(); }
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('reserves file admission while another exclusive creation is pending', async () => {
  const { fs, controller } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'writeFileConditional') return async (...args: Parameters<typeof fs.writeFileConditional>) => {
      await gate;
      return target.writeFileConditional(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const storage = await createPrivateSqliteStorage({ fs: view, directory: '/work', signal: controller.signal, maxFiles: 1 });
  const first = storage.fs.open!(`${storage.directory}/one`, { access: 'readwrite', creation: 'ifMissing' });
  try {
    await assert.rejects(storage.fs.open!(`${storage.directory}/two`, { access: 'readwrite', creation: 'ifMissing' }), { code: 'EMFILE' });
  } finally { release(); }
  await (await first).close();
  await storage.close();
  assert.deepEqual(await fs.readdir('/work'), []);
});

test('closing storage cancels a cooperative pending file creation', { timeout: 1000 }, async () => {
  const { fs, controller } = await fixture();
  const view = new Proxy(fs, { get(target, key) {
    if (key === 'writeFileConditional') return async (...args: Parameters<typeof fs.writeFileConditional>) => {
      const signal = args[2].signal!;
      signal.throwIfAborted();
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const storage = await createPrivateSqliteStorage({ fs: view, directory: '/work', signal: controller.signal, maxFiles: 1 });
  const creation = assert.rejects(storage.fs.open!(`${storage.directory}/one`, { access: 'readwrite', creation: 'ifMissing' }), { code: 'EBADF' });
  await storage.close();
  await creation;
  assert.deepEqual(await fs.readdir('/work'), []);
});
