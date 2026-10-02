import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createSqliteVfs } from './safe-fs.js';

async function setup(configure?: (fs: MemoryFileSystem) => void) {
  const fs = new MemoryFileSystem(); await fs.mkdir('/private');
  configure?.(fs);
  const controller = new AbortController();
  const vfs = createSqliteVfs({ fs, directory: '/private', signal: controller.signal, maxOpenFiles: 4, maxFileBytes: 1024 });
  return { fs, controller, vfs };
}

test('native SQLite callbacks use bounded owned descriptor transfers and retain short-read semantics', async () => {
  const { fs, vfs } = await setup();
  const flags = new DataView(new ArrayBuffer(4));
  assert.equal(await vfs.jOpen('/private/db', 1, 6, flags), 0);
  assert.equal(flags.getInt32(0, true), 6);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await vfs.jWrite(1, bytes, 0), 0);
  const result = new Uint8Array(5).fill(9);
  assert.equal(await vfs.jRead(1, result, 0), 522);
  assert.deepEqual(result, new Uint8Array([1, 2, 3, 0, 0]));
  const size = new DataView(new ArrayBuffer(8));
  assert.equal(await vfs.jFileSize(1, size), 0); assert.equal(size.getBigInt64(0, true), 3n);
  assert.equal(await vfs.jTruncate(1, 2), 0);
  assert.equal(await vfs.jSync(1, 0), 0);
  assert.equal(await vfs.jClose(1), 0);
  assert.deepEqual(await fs.readFile('/private/db'), new Uint8Array([1, 2]));
  vfs.throwIfFailed(); await vfs.dispose();
});

test('native callback failures preserve the original error and release every descriptor', async () => {
  let closed = 0;
  const { vfs, controller } = await setup(fs => {
    const open = fs.open.bind(fs);
    fs.open = async (...args) => { const fd = await open(...args); const close = fd.close.bind(fd); fd.close = async (...options) => { closed++; await close(...options); }; return fd; };
  });
  assert.equal(await vfs.jOpen('/private/db', 1, 6, new DataView(new ArrayBuffer(4))), 0);
  const error = new Error('cancel native IO'); controller.abort(error);
  assert.equal(await vfs.jWrite(1, new Uint8Array([1]), 0), 10);
  assert.throws(() => vfs.throwIfFailed(), value => value === error);
  await vfs.dispose(); assert.equal(closed, 1);
  await vfs.dispose(); assert.equal(closed, 1);
});

test('private native VFS refuses escaped paths and file growth before mutation', async () => {
  for (const path of ['/outside', '/private/../outside', '/private/nested/db']) {
    const { vfs } = await setup();
    assert.equal(await vfs.jOpen(path, 1, 6, new DataView(new ArrayBuffer(4))), 14);
    assert.throws(() => vfs.throwIfFailed(), { code: 'EACCES' });
    await vfs.dispose();
  }
  const { fs, vfs } = await setup();
  assert.equal(await vfs.jOpen('/private/db', 1, 6, new DataView(new ArrayBuffer(4))), 0);
  assert.equal(await vfs.jWrite(1, new Uint8Array(1025), 0), 10);
  assert.throws(() => vfs.throwIfFailed(), { code: 'EFBIG' });
  await vfs.dispose(); assert.equal((await fs.stat('/private/db')).size, 0);
});

test('temporary native files are exclusively created and deleted on close', async () => {
  const { fs, vfs } = await setup();
  assert.equal(await vfs.jOpen(null, 1, 14, new DataView(new ArrayBuffer(4))), 0);
  assert.equal((await fs.readdir('/private')).length, 1);
  assert.equal(await vfs.jClose(1), 0);
  assert.equal((await fs.readdir('/private')).length, 0);
  await vfs.dispose();
});

test('native VFS disposal waits for pending opens and releases their late descriptors', async () => {
  let release!: () => void, entered!: () => void, closed = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const { vfs } = await setup(fs => {
    const open = fs.open.bind(fs);
    fs.open = async (...args) => {
      const fd = await open(...args), close = fd.close.bind(fd);
      fd.close = async (...options) => { closed++; await close(...options); };
      entered(); await gate; return fd;
    };
  });
  const opening = vfs.jOpen('/private/db', 1, 6, new DataView(new ArrayBuffer(4)));
  await admitted;
  let finished = false;
  const disposal = vfs.dispose().then(() => { finished = true; });
  await Promise.resolve();
  const finishedEarly = finished;
  release();
  assert.equal(await opening, 14);
  await disposal;
  assert.equal(finishedEarly, false);
  assert.equal(closed, 1);
});

test('falsey filesystem failures survive native return codes and do not prevent close', async () => {
  const { vfs } = await setup(fs => {
    const open = fs.open.bind(fs);
    fs.open = async (...args) => { const fd = await open(...args); fd.read = async () => { throw undefined; }; return fd; };
  });
  assert.equal(await vfs.jOpen('/private/db', 1, 6, new DataView(new ArrayBuffer(4))), 0);
  assert.equal(await vfs.jRead(1, new Uint8Array(1), 0), 10);
  let caught = false;
  try { vfs.throwIfFailed(); } catch (error) { caught = true; assert.equal(error, undefined); }
  assert.equal(caught, true);
  assert.equal(await vfs.jClose(1), 0);
  await vfs.dispose();
});

test('native disposal drains all handles after cleanup errors and shares completion', async () => {
  let closed = 0;
  const { vfs } = await setup(fs => {
    const open = fs.open.bind(fs);
    fs.open = async (...args) => {
      const fd = await open(...args), close = fd.close.bind(fd);
      fd.close = async (...options) => { closed++; await close(...options); throw new Error('close failed'); };
      return fd;
    };
  });
  for (let id = 1; id <= 2; id++) assert.equal(await vfs.jOpen(`/private/db${id}`, id, 6, new DataView(new ArrayBuffer(4))), 0);
  const first = vfs.dispose();
  assert.equal(vfs.dispose(), first);
  await assert.rejects(first, AggregateError);
  assert.equal(closed, 2);
  assert.throws(() => vfs.throwIfFailed(), /close failed/);
});

test('pending native opens reserve the file budget before acquiring descriptors', async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir('/private');
  const open = fs.open.bind(fs);
  let release!: () => void, acquired = 0, closed = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fs.open = async (...args) => {
    acquired++;
    const fd = await open(...args), close = fd.close.bind(fd);
    fd.close = async () => { closed++; await close(); };
    await gate; return fd;
  };
  const vfs = createSqliteVfs({ fs, directory: '/private', signal: new AbortController().signal, maxOpenFiles: 1, maxFileBytes: 1024 });
  const first = vfs.jOpen('/private/first', 1, 6, new DataView(new ArrayBuffer(4)));
  const second = vfs.jOpen('/private/second', 2, 6, new DataView(new ArrayBuffer(4)));
  const admitted = acquired;
  release();
  await Promise.all([first, second]);
  await vfs.dispose();
  assert.equal(admitted, 1);
  assert.equal(closed, 1);
  assert.throws(() => vfs.throwIfFailed(), { code: 'EMFILE' });
});
