import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource, type FileSystem } from 'safe-bash-contracts';
import fixture from './fixtures/sqlite-page-records.json' with { type: 'json' };
import { publishSqliteSnapshot } from './sqlite-publication.js';

async function setup() {
  const backing = new MemoryFileSystem();
  // Test host: authoritative conditional commit backed by MemoryFileSystem.
  const publish: NonNullable<FileSystem['publishFileConditional']> = async (path, source, options) => {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of source) {
      size += chunk.length;
      assert.ok(chunk.length <= 16384);
      if (size > options.maxBytes) throw new RangeError('Publication quota exceeded');
      chunks.push(chunk.slice());
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return backing.writeFileConditional(path, bytes, options);
  };
  const fs = new Proxy(backing, { get(target, key) {
    if (key === 'capabilities') return { ...target.capabilities, atomicFilePublication: true };
    if (key === 'publishFileConditional') return publish;
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const original = new Uint8Array(Buffer.from(fixture.database, 'base64'));
  await fs.writeFile('/base.db', original);
  await fs.writeFile('/logs.db', original);
  const snapshot = await fs.openReadFile('/base.db');
  return { fs, original, snapshot, parent: await fs.stat('/'), expected: await fs.stat('/logs.db'), signal: new AbortController().signal };
}

test('SQLite snapshot patches publish atomically with bounded short reads', async () => {
  const input = await setup();
  let peak = 0;
  const read = input.snapshot.read.bind(input.snapshot);
  input.snapshot.read = async (position, size, options) => { peak = Math.max(peak, size); return read(position, Math.min(size, 101), options); };
  try {
    await publishSqliteSnapshot({ ...input, path: '/logs.db', patches: [{ offset: 60, length: 4, bytes: toByteSource(new Uint8Array([0, 0, 0, 7])) }] });
    const expected = input.original.slice(); new DataView(expected.buffer).setUint32(60, 7);
    assert.deepEqual(await input.fs.readFile('/logs.db'), expected);
    assert.ok(peak <= 16384);
    assert.deepEqual((await input.fs.readdir('/')).map(entry => entry.name), ['base.db', 'logs.db']);
  } finally { await input.snapshot.close(); }
});

test('failed, overlapping and wrong-length patches preserve the published database', async () => {
  for (const patches of [
    [{ offset: 60, length: 4, bytes: toByteSource('x') }],
    [{ offset: 60, length: 1, bytes: toByteSource('xx') }],
    [{ offset: 60, length: 4, bytes: toByteSource('xxxx') }, { offset: 61, length: 1, bytes: toByteSource('x') }],
    [{ offset: 60, length: 4, bytes: { async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); throw new Error('failed input'); } } }],
  ]) {
    const input = await setup();
    try {
      await assert.rejects(publishSqliteSnapshot({ ...input, path: '/logs.db', patches }));
      assert.deepEqual(await input.fs.readFile('/logs.db'), input.original);
    } finally { await input.snapshot.close(); }
  }
});

test('concurrent destination replacement is not overwritten', async () => {
  const input = await setup();
  try {
    await input.fs.writeFile('/logs.db', new Uint8Array([9]));
    await assert.rejects(publishSqliteSnapshot({ ...input, path: '/logs.db', patches: [] }));
    assert.deepEqual(await input.fs.readFile('/logs.db'), new Uint8Array([9]));
  } finally { await input.snapshot.close(); }
});

test('source changes and cancellation preserve the destination', async () => {
  for (const cancel of [false, true]) {
    const input = await setup();
    const controller = new AbortController();
    const bytes = { async *[Symbol.asyncIterator]() {
      if (cancel) controller.abort(new Error('cancel snapshot'));
      else await input.fs.appendFile('/base.db', new Uint8Array([1]));
      yield new Uint8Array([0, 0, 0, 7]);
    } };
    try {
      await assert.rejects(publishSqliteSnapshot({ ...input, signal: controller.signal, path: '/logs.db', patches: [{ offset: 60, length: 4, bytes }] }));
      assert.deepEqual(await input.fs.readFile('/logs.db'), input.original);
    } finally { await input.snapshot.close(); }
  }
});

test('unsupported publication fails before reading the source', async () => {
  const input = await setup();
  let reads = 0;
  input.snapshot.read = async () => { reads++; throw new Error('unexpected read'); };
  try {
    await assert.rejects(publishSqliteSnapshot({ ...input, fs: new MemoryFileSystem(), path: '/logs.db', patches: [] }), { code: 'ENOTSUP' });
    assert.equal(reads, 0);
  } finally { await input.snapshot.close(); }
});

test('cancellation interrupts a pending patch source and closes its iterator', async () => {
  const input = await setup();
  const controller = new AbortController();
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  let returned = 0;
  const bytes = { [Symbol.asyncIterator]() { return {
    next() { started(); return new Promise<IteratorResult<Uint8Array>>(() => undefined); },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  try {
    const publication = publishSqliteSnapshot({ ...input, signal: controller.signal, path: '/logs.db', patches: [{ offset: 0, length: 4, bytes }] });
    await pending;
    controller.abort(new Error('cancel pending patch'));
    await assert.rejects(publication, { message: 'cancel pending patch' });
    assert.equal(returned, 1);
    assert.deepEqual(await input.fs.readFile('/logs.db'), input.original);
  } finally { await input.snapshot.close(); }
});

test('invalid patch ranges are rejected before consuming sources', async () => {
  const input = await setup();
  let reads = 0;
  const bytes = { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array(); } };
  try {
    for (const [offset, length] of [[-1, 1], [0, -1], [0.5, 1], [0, Infinity], [input.original.length, 1]]) {
      await assert.rejects(publishSqliteSnapshot({ ...input, path: '/logs.db', patches: [{ offset: offset!, length: length!, bytes }] }), RangeError);
    }
    assert.equal(reads, 0);
  } finally { await input.snapshot.close(); }
});

test('SQLite source-set publication streams into caller staging and retires sidecars atomically', async () => {
  const fs = new MemoryFileSystem();
  const original = new Uint8Array(Buffer.from(fixture.database, 'base64'));
  await fs.writeFile('/base.db', original);
  await fs.writeFile('/logs.db', original);
  await fs.writeFile('/logs.db-wal', new Uint8Array([1, 2]));
  const parent = await fs.lstat('/');
  const staged = await fs.createStagedFile('/.stage', 'database', { type: 'file', data: new Uint8Array() }, { parent, retainCleanup: true });
  const snapshot = await fs.openReadFile('/base.db');
  try {
    const result = await publishSqliteSnapshot({
      fs, snapshot, parent, expected: await fs.lstat('/logs.db'), signal: new AbortController().signal, path: '/logs.db',
      patches: [{ offset: 60, length: 4, bytes: toByteSource(new Uint8Array([0, 0, 0, 7])) }],
      sourceSet: { staging: staged, wal: await fs.lstat('/logs.db-wal'), journal: null, shm: null },
    });
    assert.deepEqual(await fs.lstat('/logs.db'), result);
    const expected = original.slice(); new DataView(expected.buffer).setUint32(60, 7);
    assert.deepEqual(await fs.readFile('/logs.db'), expected);
    await assert.rejects(fs.lstat('/logs.db-wal'), { code: 'ENOENT' });
  } finally {
    await snapshot.close();
    await staged.cleanup!.remove();
  }
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['base.db', 'logs.db']);
});

for (const conflict of ['wal', 'journal', 'shm'] as const) test(`SQLite ${conflict} changes during staging preserve the canonical database`, async () => {
  const fs = new MemoryFileSystem();
  const original = new Uint8Array(Buffer.from(fixture.database, 'base64'));
  await fs.writeFile('/base.db', original);
  await fs.writeFile('/logs.db', original);
  const parent = await fs.lstat('/');
  const staged = await fs.createStagedFile('/.stage', 'database', { type: 'file', data: new Uint8Array() }, { parent, retainCleanup: true });
  const snapshot = await fs.openReadFile('/base.db');
  try {
    await assert.rejects(publishSqliteSnapshot({
      fs, snapshot, parent, expected: await fs.lstat('/logs.db'), signal: new AbortController().signal, path: '/logs.db',
      patches: [{ offset: 60, length: 4, bytes: { async *[Symbol.asyncIterator]() {
        await fs.writeFile(`/logs.db-${conflict}`, new Uint8Array([9]));
        yield new Uint8Array([0, 0, 0, 7]);
      } } }],
      sourceSet: { staging: staged, wal: null, journal: null, shm: null },
    }), { code: 'EAGAIN' });
    assert.deepEqual(await fs.readFile('/logs.db'), original);
    assert.deepEqual(await fs.readFile(`/logs.db-${conflict}`), new Uint8Array([9]));
  } finally {
    await snapshot.close();
    await staged.cleanup!.remove();
  }
});

test('SQLite publication refuses previously written retained staging', async () => {
  const fs = new MemoryFileSystem();
  const original = new Uint8Array(Buffer.from(fixture.database, 'base64'));
  await fs.writeFile('/base.db', original);
  await fs.writeFile('/logs.db', original);
  const parent = await fs.lstat('/');
  const staging = await fs.createStagedFile('/.stage', 'database', { type: 'file', data: new Uint8Array() }, { parent, retainCleanup: true });
  await staging.writer!.write(new Uint8Array([9]));
  const snapshot = await fs.openReadFile('/base.db');
  try {
    await assert.rejects(publishSqliteSnapshot({ fs, snapshot, path: '/logs.db', parent,
      expected: await fs.lstat('/logs.db'), signal: new AbortController().signal, patches: [],
      sourceSet: { staging, wal: null, journal: null, shm: null },
    }), { code: 'EIO' });
    assert.deepEqual(await fs.readFile('/logs.db'), original);
  } finally { await snapshot.close(); await staging.cleanup!.remove(); }
});
