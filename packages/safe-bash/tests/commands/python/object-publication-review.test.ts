import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { FileDescriptor, FileStat, FileSystem, FsOptions } from '../../../../safe-fs/src/contracts/filesystem.js';
import type { ByteSource } from '../../../../safe-fs/src/contracts/io.js';
import { MemoryFileSystem } from '../../../../safe-fs/src/fs/memory/index.js';
import { DeviceFileSystem } from '../../../../safe-fs/src/fs/devices/index.js';
import { MountFileSystem } from '../../../../safe-fs/src/fs/mount/index.js';
import { withFileSystemQuota } from '../../../../safe-fs/src/fs/quota/index.js';
import { ReadOnlyFileSystem } from '../../../../safe-fs/src/fs/readonly/index.js';
import { scopeFileSystem } from '../../../../safe-fs/src/fs/scoped.js';
import {
  withObjectFileDescriptors,
  type ObjectFilePublicationStore,
  type ObjectFileVersion,
} from '../../../../safe-fs/src/fs/object-publication/index.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function collect(source: ByteSource): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(Uint8Array.from(chunk));
  return Buffer.concat(chunks);
}

async function fixture() {
  const namespace = new MemoryFileSystem();
  for (const path of ['/file', '/other']) {
    await namespace.writeFile(path, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  }
  const leases: { version: ObjectFileVersion; closes: number }[] = [];
  const bindings = new Map<string, FileStat>();
  const parent = await namespace.stat('/');
  let publications = 0;
  const lease = (bytes: Uint8Array, stat: FileStat): ObjectFileVersion => {
    const owned = Uint8Array.from(bytes);
    const revision = `${stat.ino}:${stat.revision}`;
    bindings.set(revision, stat);
    const entry = {
      closes: 0,
      version: {
        revision, stat: { ...stat },
        async read(position: number, length: number, options?: FsOptions) {
          options?.signal?.throwIfAborted();
          assert.equal(entry.closes, 0, 'range read after lease retirement');
          return owned.slice(position, position + length);
        },
        async close() { entry.closes++; },
      },
    };
    leases.push(entry);
    return entry.version;
  };
  const store: ObjectFilePublicationStore = {
    async acquire(path, options) {
      return lease(await namespace.readFile(path, options), await namespace.stat(path, options));
    },
    async publish(path, revision, source, options) {
      publications++;
      const bytes = await collect(source);
      assert.equal(bytes.length, options.size);
      const expected = revision === null ? null : bindings.get(revision);
      assert.notEqual(expected, undefined);
      const stat = await namespace.writeFileConditional(path, bytes, { ...options, parent, expected: expected! });
      return lease(bytes, stat);
    },
  };
  return { namespace, store, leases, lease, get publications() { return publications; } };
}

test('cancelled acquisition drains late lease cleanup before releasing descriptor admission', async () => {
  const host = await fixture();
  const acquired = deferred();
  const releaseAcquire = deferred();
  const closing = deferred();
  const releaseClose = deferred();
  const controller = new AbortController();
  const acquire = host.store.acquire;
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    acquired.resolve();
    await releaseAcquire.promise;
    return { ...version, async close() {
      closing.resolve();
      await releaseClose.promise;
      await version.close();
    } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1 });
  const opening = fs.open!('/file', { access: 'read', signal: controller.signal });
  const outcome = Promise.allSettled([opening]);
  let competing: FileDescriptor | undefined;
  let settled = false;
  void outcome.then(() => { settled = true; });
  try {
    await acquired.promise;
    controller.abort(0);
    releaseAcquire.resolve();
    await closing.promise;
    await nextTurn();
    assert.equal(settled, false, 'open must await its late lease cleanup');
    const [admission] = await Promise.allSettled([fs.open!('/other', { access: 'read' })]);
    if (admission!.status === 'fulfilled') competing = admission!.value;
    assert.equal(admission!.status, 'rejected', 'pending lease retirement still consumes maxOpenFiles');
    if (admission!.status === 'rejected') assert.equal(admission!.reason.code, 'EMFILE');
  } finally {
    releaseAcquire.resolve();
    releaseClose.resolve();
    await outcome;
    await competing?.close();
  }
  assert.deepEqual(await outcome, [{ status: 'rejected', reason: 0 }]);
  host.store.acquire = acquire;
  await (await fs.open!('/other', { access: 'read' })).close();
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('malformed acquired metadata retires its lease despite cleanup failure and restores admission', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, stat: { ...version.stat, size: NaN }, async close() {
      await version.close();
      throw new Error('secondary cleanup failure');
    } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1 });
  await assert.rejects(fs.open!('/file', { access: 'read' }), { code: 'EIO' });
  host.store.acquire = acquire;
  await (await fs.open!('/file', { access: 'read' })).close();
  assert.deepEqual(host.leases.map(entry => entry.closes), [1, 1]);
});

test('cancelled page preparation reserves capacity while pending then rolls back without dirty bytes', async () => {
  const host = await fixture();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const acquire = host.store.acquire;
  let delayed = true;
  host.store.acquire = async (path, options) => {
    const version = (await acquire(path, options))!;
    return { ...version, async read(position, length, forwarded) {
      if (path === '/file' && delayed) {
        delayed = false;
        entered.resolve();
        await release.promise;
      }
      return version.read(position, length, forwarded);
    } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const first = await fs.open!('/file', { access: 'readwrite' });
  const other = await fs.open!('/other', { access: 'write' });
  const writing = first.write(new Uint8Array([99]), 0, { signal: controller.signal });
  const outcome = Promise.allSettled([writing]);
  try {
    await entered.promise;
    await assert.rejects(other.write(new Uint8Array([42]), 0), { code: 'ENOSPC' });
    controller.abort(false);
    release.resolve();
    assert.deepEqual(await outcome, [{ status: 'rejected', reason: false }]);
    const bytes = new Uint8Array(8);
    await first.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    await other.write(new Uint8Array([42]), 0);
  } finally {
    release.resolve();
    await outcome;
    await Promise.all([first.close(), other.close()]);
  }
  assert.equal(host.publications, 1, 'cancelled preparation must not dirty its descriptor');
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('successful open stops borrowing its acquisition signal before later read write sync and close', async () => {
  const host = await fixture();
  const controller = new AbortController();
  const descriptor = await withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4 })
    .open!('/file', { access: 'readwrite', signal: controller.signal });
  await descriptor.write(new Uint8Array([90]), 1);
  controller.abort(0);
  const bytes = new Uint8Array(8);
  const operationOptions = { signal: new AbortController().signal };
  const results = await Promise.allSettled([
    descriptor.stat().then(stat => stat.size),
    descriptor.read(bytes, 0, operationOptions),
    descriptor.write(new Uint8Array([91]), 0, operationOptions),
    descriptor.sync(false, operationOptions),
    descriptor.write(new Uint8Array([92]), 4),
    descriptor.close(),
  ]);
  assert.ok(host.leases.every(entry => entry.closes === 1));
  assert.deepEqual(results, [8, 8, 1, undefined, 1, undefined].map(value => ({ status: 'fulfilled', value })));
  assert.deepEqual(bytes, new Uint8Array([1, 90, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([91, 90, 3, 4, 92, 6, 7, 8]));
  assert.equal(host.publications, 2, 'sync and close both publish after the acquisition signal aborts');
});

test('publication failure retains its falsey reason across repeated sync write and close cleanup', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  let attempts = 0;
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, async close() {
      await version.close();
      throw new Error('secondary retirement error');
    } };
  };
  host.store.publish = async () => { attempts++; throw 0; };
  const descriptor = await withObjectFileDescriptors(host.namespace, host.store)
    .open!('/file', { access: 'write' });
  await descriptor.write(new Uint8Array([9]), null);
  const operations = [];
  for (const operation of [() => descriptor.sync(false), () => descriptor.sync(false), () => descriptor.write(new Uint8Array([8]), 0), () => descriptor.close()]) {
    operations.push((await Promise.allSettled([operation()]))[0]);
  }
  assert.equal(attempts, 1);
  assert.equal(host.leases[0]!.closes, 1);
  assert.deepEqual(operations, Array.from({ length: 4 }, () => ({ status: 'rejected', reason: 0 })));
});

test('invalid acquired mode cannot be coerced into mode-000 publication', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  const publish = host.store.publish!;
  const publishedModes: number[] = [];
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, stat: { ...version.stat, mode: NaN } };
  };
  host.store.publish = async (path, revision, source, options) => {
    publishedModes.push(options.mode);
    return publish(path, revision, source, options);
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store);
  const [opening] = await Promise.allSettled([fs.open!('/file', { access: 'write' })]);
  if (opening!.status === 'fulfilled') {
    try {
      await opening!.value.write(new Uint8Array([9]), 0);
      await opening!.value.sync(false);
    } finally { await opening!.value.close(); }
  }
  assert.ok(host.leases.every(entry => entry.closes === 1));
  assert.deepEqual(publishedModes, [], 'invalid metadata must not silently become a permission mutation');
  assert.equal(opening!.status, 'rejected');
  if (opening!.status === 'rejected') assert.equal(opening!.reason.code, 'EIO');
});

for (const receipt of ['unread-tail', 'same-revision', 'wrong-size', 'invalid-version'] as const) {
  test(`rejects ${receipt} publication receipt, closes both leases once, and never retries`, async () => {
    const host = await fixture();
    let attempts = 0;
    let retainedSource: AsyncIterator<Uint8Array> | undefined;
    host.store.publish = async (_path, revision, source, options) => {
      attempts++;
      retainedSource = source[Symbol.asyncIterator]();
      if (receipt === 'unread-tail') await retainedSource.next();
      else await collect(source);
      const stat = await host.namespace.stat('/file');
      const returned = host.lease(new Uint8Array(options.size), stat);
      return {
        ...returned,
        revision: receipt === 'same-revision' ? revision! : receipt === 'invalid-version' ? '' : 'receipt-next',
        stat: { ...stat, size: receipt === 'wrong-size' ? options.size - 1 : options.size },
        async close() { await returned.close(); throw new Error('receipt cleanup failure'); },
      };
    };
    const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedPages: 1 });
    const descriptor = await fs.open!('/file', { access: 'write' });
    await descriptor.write(new Uint8Array([9]), 0);
    const [failure] = await Promise.allSettled([descriptor.sync(false)]);
    const [closed] = await Promise.allSettled([descriptor.close()]);
    assert.equal(failure!.status, 'rejected');
    if (failure!.status !== 'rejected') return;
    assert.equal(failure!.reason.code, 'EIO');
    assert.deepEqual(closed, failure);
    assert.equal(attempts, 1);
    assert.deepEqual(host.leases.map(entry => entry.closes), [1, 1]);
    assert.equal((await retainedSource!.next()).done, true, 'publisher cannot read after settlement');
    assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const other = await fs.open!('/other', { access: 'write' });
    await other.write(new Uint8Array([7]), 0);
    await Promise.allSettled([other.close()]);
  });
}

test('overlapping publication bodies still allow exactly one conditional commit', async () => {
  const host = await fixture();
  const bothBodies = deferred();
  const publish = host.store.publish!;
  let arrived = 0;
  host.store.publish = async (path, revision, source, options) => {
    const bytes = await collect(source);
    if (++arrived === 2) bothBodies.resolve();
    await bothBodies.promise;
    return publish(path, revision, (async function* () { yield bytes; })(), options);
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4 });
  const first = await fs.open!('/file', { access: 'write' });
  const second = await fs.open!('/file', { access: 'write' });
  await Promise.all([first.write(new Uint8Array([11]), 0), second.write(new Uint8Array([22]), 4)]);
  const results = await Promise.allSettled([first.sync(false), second.sync(false)]);
  const closes = await Promise.allSettled([first.close(), second.close()]);
  assert.equal(arrived, 2);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.equal(loser?.reason.code, 'EAGAIN');
  assert.deepEqual(closes, results);
  const winnerBytes = results[0]!.status === 'fulfilled'
    ? [11, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 22, 6, 7, 8];
  assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array(winnerBytes));
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('queued write cannot alter an in-flight publication and close drains both generations', async () => {
  const host = await fixture();
  const entered = deferred();
  const release = deferred();
  const publish = host.store.publish!;
  const bodies: Uint8Array[] = [];
  host.store.publish = async (path, revision, source, options) => {
    if (bodies.length === 0) { entered.resolve(); await release.promise; }
    const bytes = await collect(source);
    bodies.push(bytes);
    return publish(path, revision, (async function* () { yield bytes; })(), options);
  };
  const descriptor = await withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedPages: 1 })
    .open!('/file', { access: 'write' });
  await descriptor.write(new Uint8Array([11]), 0);
  const syncing = descriptor.sync(false);
  await entered.promise;
  const writing = descriptor.write(new Uint8Array([22]), 4);
  const closing = descriptor.close();
  const results = Promise.allSettled([syncing, writing, closing]);
  try {
    await assert.rejects(descriptor.write(new Uint8Array([33]), 0), { code: 'EBADF' });
    assert.equal(descriptor.close(), closing, 'concurrent close shares completion');
  } finally { release.resolve(); await results; }
  assert.deepEqual(await results, [
    { status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: 1 }, { status: 'fulfilled', value: undefined },
  ]);
  assert.deepEqual(bodies.map(bytes => Array.from(bytes)), [[11, 2, 3, 4, 5, 6, 7, 8], [11, 2, 3, 4, 22, 6, 7, 8]]);
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('cross-page ENOSPC leaves existing dirty bytes intact and truncate releases pages before flush', async () => {
  const host = await fixture();
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedPages: 1 });
  const first = await fs.open!('/file', { access: 'readwrite' });
  const other = await fs.open!('/other', { access: 'write' });
  try {
    await first.write(new Uint8Array([91]), 4);
    await assert.rejects(first.write(new Uint8Array([99, 99, 99, 99, 99]), 4), { code: 'ENOSPC' });
    const bytes = new Uint8Array(8);
    await first.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 91, 6, 7, 8]));
    assert.equal((await first.stat()).size, 8);
    await first.truncate(4);
    await other.write(new Uint8Array([42]), 0);
    assert.equal(host.publications, 0, 'truncate must free the page without a publication');
    await first.truncate(8);
    await first.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]));
  } finally { await Promise.all([first.close(), other.close()]); }
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('scope and readonly wrappers preserve conditional profile without restoring write authority', async () => {
  const host = await fixture();
  const controller = new AbortController();
  let charges = 0;
  const adapted = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4 });
  const fs = new ReadOnlyFileSystem(scopeFileSystem(adapted, () => { charges++; }, controller.signal));
  assert.equal(fs.capabilities.versionedDescriptors, true);
  assert.equal((await fs.capabilitiesFor('/file')).versionedDescriptors, true);
  await assert.rejects(fs.open('/file', { access: 'write' }), { code: 'EROFS' });
  assert.equal(host.leases.length, 0, 'readonly admission must precede store acquisition');
  const descriptor = await fs.open('/file', { access: 'read' });
  try {
    assert.equal(descriptor.capabilities.publication, 'conditional');
    assert.equal(descriptor.capabilities.position, true);
    assert.equal(descriptor.capabilities.positionedWrite, false);
    assert.equal(descriptor.capabilities.truncate, false);
    assert.equal(descriptor.capabilities.synchronization, 'none');
    await descriptor.read(new Uint8Array(3), null);
    assert.equal(await descriptor.getPosition!(), 3);
    await assert.rejects(descriptor.write(new Uint8Array([9]), 0), { code: 'EBADF' });
    const beforeAbort = charges;
    controller.abort(false);
    assert.deepEqual(await Promise.allSettled([descriptor.getPosition!(), descriptor.stat()]), [
      { status: 'rejected', reason: false }, { status: 'rejected', reason: false },
    ]);
    assert.equal(charges, beforeAbort);
  } finally { await descriptor.close(); }
  assert.equal(host.publications, 0);
  assert.equal(host.leases[0]!.closes, 1);
});

test('reused range buffers and caller write buffers cannot alias staged pages or publication chunks', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  const publish = host.store.publish!;
  const scratch = Buffer.alloc(4);
  const retained: Uint8Array[] = [];
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, async read(position, length, options) {
      scratch.set(await version.read(position, length, options));
      return scratch.subarray(0, length);
    } };
  };
  host.store.publish = async (path, revision, source, options) => {
    for await (const chunk of source) retained.push(chunk);
    scratch.fill(255);
    return publish(path, revision, (async function* () { yield* retained; })(), options);
  };
  const descriptor = await withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4 })
    .open!('/file', { access: 'readwrite' });
  try {
    const bytes = new Uint8Array(8);
    await descriptor.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const input = Buffer.from([91]);
    await descriptor.write(input, 0);
    input.fill(99);
    await descriptor.sync(false);
    assert.deepEqual(retained.map(chunk => Array.from(chunk)), [[91, 2, 3, 4], [5, 6, 7, 8]]);
    await descriptor.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([91, 2, 3, 4, 5, 6, 7, 8]));
  } finally { await descriptor.close(); }
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('device over mixed mounts preserves selected object profile without promoting native or device paths', async () => {
  const host = await fixture();
  const root = new MemoryFileSystem();
  await root.writeFile('/native', new Uint8Array([31]));
  const acquire = host.store.acquire;
  const acquiredPaths: string[] = [];
  host.store.acquire = async (path, options) => {
    acquiredPaths.push(path);
    return acquire(path, options);
  };
  const adapted = withObjectFileDescriptors(host.namespace, host.store);
  const fs = new DeviceFileSystem(new MountFileSystem({ root, mounts: {
    '/objects': adapted, '/readonly': new ReadOnlyFileSystem(adapted),
  } }));
  assert.equal((await fs.capabilitiesFor('/objects/file')).versionedDescriptors, true);
  assert.equal((await fs.capabilitiesFor('/readonly/file')).versionedDescriptors, true);
  assert.notEqual((await fs.capabilitiesFor('/native')).versionedDescriptors, true);
  assert.notEqual((await fs.capabilitiesFor('/dev/null')).versionedDescriptors, true);
  await assert.rejects(fs.open('/dev/null', { access: 'write' }), { code: 'ENOTSUP' });
  await assert.rejects(fs.open('/readonly/file', { access: 'write' }), { code: 'EROFS' });
  assert.deepEqual(acquiredPaths, []);
  const controller = new AbortController();
  const descriptor = await fs.open('/objects/file', { access: 'readwrite', signal: controller.signal });
  controller.abort(false);
  try {
    assert.equal(descriptor.capabilities.publication, 'conditional');
    assert.equal(descriptor.capabilities.position, true);
    await descriptor.write(new Uint8Array([42]), null);
    await descriptor.sync(false);
    assert.equal(await descriptor.getPosition!(), 1);
    const bytes = new Uint8Array(1);
    await descriptor.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([42]));
  } finally { await descriptor.close(); }
  assert.deepEqual(acquiredPaths, ['/file'], 'mount prefix must not reach the object store');
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('readonly mount preserves global as well as selected-path versioned descriptor profile', async () => {
  const host = await fixture();
  const root = new ReadOnlyFileSystem(withObjectFileDescriptors(host.namespace, host.store));
  const fs = new MountFileSystem({ root });
  const descriptor = await fs.open('/file', { access: 'read' });
  try {
    assert.equal(descriptor.capabilities.publication, 'conditional');
    assert.equal(descriptor.capabilities.positionedWrite, false);
    assert.equal((await fs.capabilitiesFor('/file')).versionedDescriptors, true);
    assert.equal(fs.capabilities.versionedDescriptors, true, 'readonly must not erase versioned read semantics');
  } finally { await descriptor.close(); }
  assert.equal(host.leases[0]!.closes, 1);
});

test('quota forwards conditional profile and rejects excess private growth before publication', async () => {
  const host = await fixture();
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 17 });
  assert.equal(fs.capabilities.versionedDescriptors, true);
  assert.equal((await fs.capabilitiesFor!('/file')).versionedDescriptors, true);
  const descriptor = await fs.open!('/file', { access: 'readwrite' });
  try {
    assert.equal(descriptor.capabilities.publication, 'conditional');
    assert.equal(descriptor.capabilities.position, true);
    await descriptor.write(new Uint8Array([91]), 8);
    await assert.rejects(descriptor.write(new Uint8Array([92]), 9), { code: 'ENOSPC' });
    assert.equal(host.publications, 0);
    await descriptor.sync(false);
    await descriptor.truncate(8);
    await descriptor.sync(false);
    await descriptor.write(new Uint8Array([93]), 8);
  } finally { await descriptor.close(); }
  assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 93]));
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('quota cannot admit independent private writers whose later publications exceed its ceiling', async () => {
  const host = await fixture();
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 17 });
  const first = await fs.open!('/file', { access: 'write' });
  const second = await fs.open!('/other', { access: 'write' });
  const writes = await Promise.allSettled([
    first.write(new Uint8Array([91]), 8), second.write(new Uint8Array([92]), 8),
  ]);
  const closes = await Promise.allSettled([first.close(), second.close()]);
  assert.ok(host.leases.every(entry => entry.closes === 1));
  const total = (await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size;
  assert.ok(total <= 17, `quota admitted ${total} bytes with a 17-byte ceiling`);
  assert.ok([...writes, ...closes].some(result => result.status === 'rejected'), 'over-limit growth must be refused before publication');
  for (const result of [...writes, ...closes]) {
    if (result.status === 'rejected') assert.equal(result.reason.code, 'ENOSPC');
  }
});

test('quota refuses identityless object writers but keeps versioned reads and releases refused leases', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    const { identityScope: ignoredScope, ino: ignoredInode, dev: ignoredDevice, ...stat } = version.stat;
    return { ...version, stat };
  };
  const adapted = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1 });
  const fs = withFileSystemQuota(adapted, { maxBytes: 16 });
  await assert.rejects(fs.open!('/file', { access: 'write' }), { code: 'ENOTSUP' });
  const reader = await fs.open!('/file', { access: 'read' });
  try {
    assert.equal(reader.capabilities.publication, 'conditional');
    const bytes = new Uint8Array(1);
    await reader.read(bytes, 0);
    assert.deepEqual(bytes, new Uint8Array([1]));
  } finally { await reader.close(); }
  assert.equal(host.publications, 0);
  assert.deepEqual(host.leases.map(entry => entry.closes), [1, 1]);
});

test('acquire rejection preserves falsey identity and restores the open slot without a lease', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  host.store.acquire = async () => { throw false; };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1 });
  assert.deepEqual(await Promise.allSettled([fs.open!('/file', { access: 'read' })]), [
    { status: 'rejected', reason: false },
  ]);
  assert.equal(host.leases.length, 0);
  host.store.acquire = acquire;
  await (await fs.open!('/file', { access: 'read' })).close();
  assert.equal(host.leases[0]!.closes, 1);
});

test('failed final lease close drains before freeing admission and shares the same failed completion', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  const entered = deferred();
  const release = deferred();
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, async close() {
      entered.resolve();
      await release.promise;
      await version.close();
      throw 0;
    } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1 });
  const descriptor = await fs.open!('/file', { access: 'read' });
  const closing = descriptor.close();
  const result = Promise.allSettled([closing]);
  try {
    await entered.promise;
    assert.equal(descriptor.close(), closing);
    await assert.rejects(descriptor.stat(), { code: 'EBADF' });
    await assert.rejects(fs.open!('/other', { access: 'read' }), { code: 'EMFILE' });
  } finally { release.resolve(); await result; }
  assert.deepEqual(await result, [{ status: 'rejected', reason: 0 }]);
  assert.equal(descriptor.close(), closing);
  host.store.acquire = acquire;
  await (await fs.open!('/other', { access: 'read' })).close();
  assert.deepEqual(host.leases.map(entry => entry.closes), [1, 1]);
});

test('old-version retirement error after commit retains the new lease and does not republish on close', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    return { ...version, async close() { await version.close(); throw false; } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxOpenFiles: 1, chunkBytes: 4, maxStagedPages: 1 });
  const descriptor = await fs.open!('/file', { access: 'write' });
  await descriptor.write(new Uint8Array([91]), 0);
  const synced = await Promise.allSettled([descriptor.sync(false)]);
  const retired = await Promise.allSettled([descriptor.close()]);
  assert.deepEqual(synced, [{ status: 'rejected', reason: false }]);
  assert.deepEqual(retired, synced);
  assert.equal(host.publications, 1);
  assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([91, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(host.leases.map(entry => entry.closes), [1, 1]);
  host.store.acquire = acquire;
  const other = await fs.open!('/other', { access: 'write' });
  await other.write(new Uint8Array([92]), 0);
  await other.close();
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('quota reserves pending private growth against namespace writeFile on another path', async () => {
  const host = await fixture();
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 17 });
  const descriptor = await fs.open!('/file', { access: 'write' });
  try {
    await descriptor.write(new Uint8Array([91]), 8);
    assert.equal((await host.namespace.stat('/file')).size, 8, 'growth is still descriptor-private');
    await assert.rejects(fs.writeFile('/other', new Uint8Array(9)), { code: 'ENOSPC' });
    assert.deepEqual(await host.namespace.readFile('/other'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  } finally { await descriptor.close(); }
  assert.equal((await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size, 17);
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

test('quota releases synced growth reservations instead of charging both the receipt and namespace', async () => {
  const host = await fixture();
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 18 });
  const descriptor = await fs.open!('/file', { access: 'write' });
  try {
    await descriptor.write(new Uint8Array([91]), 8);
    await descriptor.sync(false);
    assert.equal((await host.namespace.stat('/file')).size, 9);
    await fs.writeFile('/other', new Uint8Array(9));
    await assert.rejects(descriptor.write(new Uint8Array([92]), 9), { code: 'ENOSPC' });
  } finally { await descriptor.close(); }
  assert.equal(host.publications, 1);
  assert.equal((await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size, 18);
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

for (const committed of [false, true]) {
  test(`quota releases reservations after close fails ${committed ? 'after' : 'before'} publication commit`, async () => {
    const host = await fixture();
    if (committed) {
      const acquire = host.store.acquire;
      host.store.acquire = async (...args) => {
        const version = (await acquire(...args))!;
        return { ...version, async close() { await version.close(); throw 0; } };
      };
    } else host.store.publish = async () => { throw 0; };
    const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 18 });
    const descriptor = await fs.open!('/file', { access: 'write' });
    await descriptor.write(new Uint8Array([91]), 8);
    const closing = descriptor.close();
    assert.deepEqual(await Promise.allSettled([closing]), [{ status: 'rejected', reason: 0 }]);
    assert.equal(descriptor.close(), closing);
    assert.ok(host.leases.every(entry => entry.closes === 1));
    assert.equal((await host.namespace.stat('/file')).size, committed ? 9 : 8);
    await fs.writeFile('/other', new Uint8Array(committed ? 9 : 10));
    assert.equal((await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size, 18);
    await assert.rejects(fs.writeFile('/extra', new Uint8Array([1])), { code: 'ENOSPC' });
    assert.equal(host.publications, committed ? 1 : 0);
  });
}

test('quota accepts truthful complete identity changes after conditional sync and meters later growth', async () => {
  const host = await fixture();
  const acquire = host.store.acquire;
  const bindings = new Map<string, FileStat>();
  host.store.acquire = async (...args) => {
    const version = (await acquire(...args))!;
    bindings.set(version.revision, version.stat);
    return version;
  };
  host.store.publish = async (path, revision, source, options) => {
    const bytes = await collect(source);
    assert.equal(bytes.length, options.size);
    const expected = bindings.get(revision!);
    assert.ok(expected);
    const parent = await host.namespace.stat('/');
    const staged = await host.namespace.createStagedFile('/publication-stage', 'next', { type: 'file', data: bytes }, {
      ...options, parent,
    });
    try {
      await host.namespace.publishStagedFile(staged, path, { ...options, parent, destination: expected });
    } finally { await host.namespace.removeStagedFile(staged); }
    const version = host.lease(bytes, await host.namespace.stat(path));
    bindings.set(version.revision, version.stat);
    return version;
  };
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 18 });
  const descriptor = await fs.open!('/file', { access: 'readwrite' });
  try {
    const initial = await descriptor.stat();
    await descriptor.write(new Uint8Array([91]), 8);
    await descriptor.sync(false);
    const replaced = await descriptor.stat();
    assert.notEqual(replaced.ino, initial.ino, 'publication really replaces the memory inode');
    assert.equal(replaced.ino, (await host.namespace.stat('/file')).ino);
    assert.equal(replaced.dev, initial.dev);
    assert.equal(replaced.identityScope, initial.identityScope);
    await descriptor.write(new Uint8Array([92]), 9);
    await assert.rejects(descriptor.write(new Uint8Array([93]), 10), { code: 'ENOSPC' });
    await descriptor.sync(false);
    assert.notEqual((await descriptor.stat()).ino, replaced.ino);
    await descriptor.truncate(9);
    await descriptor.sync(false);
    await fs.writeFile('/other', new Uint8Array(9));
  } finally { await descriptor.close(); }
  assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 91]));
  assert.equal((await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size, 18);
  assert.deepEqual((await host.namespace.readdir('/')).map(entry => entry.name).sort(), ['file', 'other']);
  assert.ok(host.leases.every(entry => entry.closes === 1));
});

for (const failure of ['cancellation', 'backend error'] as const) {
  test(`quota retains private growth when shrink fails with ${failure} after size admission`, async context => {
    const host = await fixture();
    const controller = new AbortController();
    const reason = failure === 'cancellation' ? false : new Error('injected truncate failure');
    const adapted = withObjectFileDescriptors(host.namespace, host.store);
    const intercepted: FileSystem = Object.create(adapted);
    let shrinkAttempts = 0;
    intercepted.open = async (path, options) => {
      const descriptor = await adapted.open!(path, options);
      const truncate = descriptor.truncate.bind(descriptor);
      context.mock.method(descriptor, 'truncate', async (length: number, forwarded: FsOptions = {}) => {
        if (length === 8) {
          shrinkAttempts++;
          if (failure === 'cancellation') controller.abort(reason);
          else throw reason;
        }
        return truncate(length, forwarded);
      });
      return descriptor;
    };
    const fs = withFileSystemQuota(intercepted, { maxBytes: 17 });
    const descriptor = await fs.open!('/file', { access: 'write' });
    let namespaceWrite: PromiseSettledResult<void> | undefined;
    try {
      await descriptor.write(new Uint8Array([91]), 8);
      assert.deepEqual(await Promise.allSettled([descriptor.truncate(8, { signal: controller.signal })]), [
        { status: 'rejected', reason },
      ]);
      assert.equal(shrinkAttempts, 1, 'failure must occur after quota forwards the admitted shrink');
      assert.equal((await descriptor.stat()).size, 9, 'failed shrink must leave private growth intact');
      assert.equal((await host.namespace.stat('/file')).size, 8);
      [namespaceWrite] = await Promise.allSettled([fs.writeFile('/other', new Uint8Array(9))]);
    } finally { await descriptor.close(); }
    assert.ok(host.leases.every(entry => entry.closes === 1));
    assert.deepEqual(await host.namespace.readFile('/file'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 91]));
    const total = (await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size;
    assert.equal(total, 17, 'failed shrink must not release growth and permit 18 published bytes');
    assert.equal(namespaceWrite!.status, 'rejected');
    if (namespaceWrite!.status === 'rejected') assert.equal(namespaceWrite!.reason.code, 'ENOSPC');
    assert.deepEqual(await host.namespace.readFile('/other'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });
}

test('quota releases private growth after a successful shrink before publication', async () => {
  const host = await fixture();
  const fs = withFileSystemQuota(withObjectFileDescriptors(host.namespace, host.store), { maxBytes: 17 });
  const descriptor = await fs.open!('/file', { access: 'write' });
  try {
    await descriptor.write(new Uint8Array([91]), 8);
    await descriptor.truncate(8);
    assert.equal((await descriptor.stat()).size, 8);
    assert.equal(host.publications, 0);
    await fs.writeFile('/other', new Uint8Array(9));
  } finally { await descriptor.close(); }
  assert.equal((await host.namespace.stat('/file')).size + (await host.namespace.stat('/other')).size, 17);
  assert.ok(host.leases.every(entry => entry.closes === 1));
});
