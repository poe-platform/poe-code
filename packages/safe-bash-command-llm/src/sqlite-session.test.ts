import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import type {FileSystem} from 'safe-bash-contracts';
import {withPrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';

test('runs native queries using only caller-owned private files and closes descriptors', async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir('/private');
  let opened = 0, closed = 0;
  const fs = new Proxy(memory, {get(target, key) {
    if (key === 'open') return async (...args: Parameters<NonNullable<FileSystem['open']>>) => {
      const file = await target.open(...args); opened++;
      return new Proxy(file, {get(descriptor, member) {
        if (member === 'close') return async () => {closed++; await descriptor.close();};
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === 'function' ? value.bind(descriptor) : value;
      }});
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }}) as FileSystem;
  const signal = new AbortController().signal;
  const result = await withPrivateSqliteSession({fs, directory: '/private', path: '/private/logs.db', signal, maxFileBytes: 1024 * 1024, maxOpenFiles: 8}, async session => {
    await session.execute('CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES (\'hello\');');
    return withSqliteStatement(session.module, {...session, sql: 'SELECT value FROM sample', signal}, async statement => {
      const rows = [];
      for await (const row of statement.rows([], ['text'])) rows.push(row);
      return rows;
    });
  });
  assert.deepEqual(result, [['hello']]);
  assert.ok(opened > 0);
  assert.equal(closed, opened);
  assert.ok((await memory.stat('/private/logs.db')).size > 0);
});

test('closes caller descriptors after an operation failure and preserves the error', async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir('/private');
  const failure = new Error('transaction failed');
  await assert.rejects(withPrivateSqliteSession({fs, directory: '/private', path: '/private/logs.db', signal: new AbortController().signal, maxFileBytes: 1048576, maxOpenFiles: 8}, async session => {
    await session.execute('CREATE TABLE sample(value); BEGIN; INSERT INTO sample VALUES (1);');
    throw failure;
  }), error => error === failure);
  await assert.rejects(fs.stat('/private/logs.db-journal'), {code: 'ENOENT'});
});

test('rejects a canonical path outside private storage before invoking the operation', async () => {
  const fs = new MemoryFileSystem();
  await assert.rejects(withPrivateSqliteSession({fs, directory: '/private', path: '/logs.db', signal: new AbortController().signal, maxFileBytes: 1048576, maxOpenFiles: 8}, async () => assert.fail('unexpected operation')), {code: 'EACCES'});
});

test('rejects pre-cancelled sessions before acquiring caller resources', async () => {
  const controller = new AbortController(), reason = new Error('cancelled');
  controller.abort(reason);
  const fs = new Proxy(new MemoryFileSystem(), {get() {assert.fail('filesystem accessed after cancellation');}});
  await assert.rejects(withPrivateSqliteSession({fs, directory: '/private', path: '/private/logs.db', signal: controller.signal, maxFileBytes: 1048576, maxOpenFiles: 8}, async () => assert.fail('unexpected operation')), error => error === reason);
});
