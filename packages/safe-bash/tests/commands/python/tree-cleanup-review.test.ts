import { strict as assert } from 'node:assert';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import {
  DeviceFileSystem, FsError, MemoryFileSystem, MountFileSystem, PythonFileSystem, ReadOnlyFileSystem,
  scopeFileSystem, withFileSystemQuota,
} from 'poe-code/safe-fs/core';
import type { ConditionalRemoveEntryOptions, FsOptions } from 'poe-code/safe-fs/core';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function assertPending(work: Promise<unknown>) {
  let settled = false;
  void work.then(() => { settled = true; }, () => { settled = true; });
  await nextTurn();
  assert.equal(settled, false, 'close must drain admitted cleanup before settling');
}

test('tree cleanup preserves symlink targets and external hardlinks', async context => {
  const fs = new MemoryFileSystem();
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  await fs.mkdir('/temporary/nested', { recursive: true });
  await fs.mkdir('/outside');
  await fs.writeFile('/outside/keep', new Uint8Array([1, 2, 3]));
  await fs.link('/outside/keep', '/temporary/nested/first');
  await fs.link('/outside/keep', '/temporary/second');
  await fs.symlink('/outside', '/temporary/nested/link');
  await fs.symlink('/temporary', '/temporary/cycle');
  await fs.symlink('/missing', '/temporary/dangling');
  await service.dispatch({ op: 'rmtree', args: ['/temporary'] });
  await assert.rejects(fs.lstat('/temporary'), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile('/outside/keep'), new Uint8Array([1, 2, 3]));
  assert.equal((await fs.stat('/outside/keep')).nlink, 1);
});

for (const replacement of ['directory', 'symlink', 'missing'] as const) {
  test(`tree identity race refuses a ${replacement} substituted after lstat`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/temporary');
    await fs.writeFile('/temporary/owned', new Uint8Array([1]));
    await fs.mkdir('/outside');
    await fs.writeFile('/outside/keep', new Uint8Array([2]));
    const lstat = fs.lstat.bind(fs);
    context.mock.method(fs, 'lstat', async (path: string, options?: FsOptions) => {
      const observed = await lstat(path, options);
      if (path === '/temporary') {
        await fs.rename('/temporary', '/retained');
        if (replacement === 'directory') {
          await fs.mkdir('/temporary');
          await fs.writeFile('/temporary/new', new Uint8Array([3]));
        } else if (replacement === 'symlink') await fs.symlink('/outside', '/temporary');
      }
      return observed;
    });
    const service = new PythonFileSystem(fs, { cwd: '/' });
    context.after(() => service.close());
    await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), { code: 'EAGAIN' });
    assert.deepEqual(await fs.readFile('/retained/owned'), new Uint8Array([1]));
    assert.deepEqual(await fs.readFile('/outside/keep'), new Uint8Array([2]));
    if (replacement === 'directory') assert.deepEqual(await fs.readFile('/temporary/new'), new Uint8Array([3]));
    if (replacement === 'symlink') assert.equal(await fs.readlink('/temporary'), '/outside');
    if (replacement === 'missing') await assert.rejects(lstat('/temporary'), { code: 'ENOENT' });
  });
}

test('parent replacement refuses deletion even when the selected tree inode is moved back', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/parent/tree', { recursive: true });
  await fs.writeFile('/parent/tree/keep', new Uint8Array([4]));
  const removeTree = fs.removeTreeConditional.bind(fs);
  context.mock.method(fs, 'removeTreeConditional', async (path: string, options: ConditionalRemoveEntryOptions) => {
    await fs.rename('/parent', '/old-parent');
    await fs.mkdir('/parent');
    await fs.rename('/old-parent/tree', '/parent/tree');
    return removeTree(path, options);
  });
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/parent/tree'] }), { code: 'EAGAIN' });
  assert.deepEqual(await fs.readFile('/parent/tree/keep'), new Uint8Array([4]));
});

test('an ancestor symlink retargeted at the mutation boundary cannot redirect cleanup', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/owned/tree', { recursive: true });
  await fs.mkdir('/outside/tree', { recursive: true });
  await fs.writeFile('/owned/tree/file', new Uint8Array([1]));
  await fs.writeFile('/outside/tree/file', new Uint8Array([2]));
  await fs.symlink('/owned', '/alias');
  const removeTree = fs.removeTreeConditional.bind(fs);
  context.mock.method(fs, 'removeTreeConditional', async (path: string, options: ConditionalRemoveEntryOptions) => {
    await fs.unlink('/alias');
    await fs.symlink('/outside', '/alias');
    return removeTree(path, options);
  });
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/alias/tree'] }), { code: 'EAGAIN' });
  assert.deepEqual(await fs.readFile('/owned/tree/file'), new Uint8Array([1]));
  assert.deepEqual(await fs.readFile('/outside/tree/file'), new Uint8Array([2]));
});

test('a child replaced by an outside symlink before atomic deletion is not traversed', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/temporary/child', { recursive: true });
  await fs.mkdir('/outside');
  await fs.writeFile('/temporary/child/keep', new Uint8Array([1]));
  await fs.writeFile('/outside/keep', new Uint8Array([2]));
  const removeTree = fs.removeTreeConditional.bind(fs);
  context.mock.method(fs, 'removeTreeConditional', async (path: string, options: ConditionalRemoveEntryOptions) => {
    await fs.rename('/temporary/child', '/retained');
    await fs.symlink('/outside', '/temporary/child');
    return removeTree(path, options);
  });
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  await service.dispatch({ op: 'rmtree', args: ['/temporary'] });
  await assert.rejects(fs.lstat('/temporary'), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile('/retained/keep'), new Uint8Array([1]));
  assert.deepEqual(await fs.readFile('/outside/keep'), new Uint8Array([2]));
});

for (const [path, code] of [
  ['/alias', 'ENOTDIR'], ['/alias/', 'ENOTDIR'], ['/temporary/.', 'EAGAIN'],
  ['/temporary/..', 'EAGAIN'], ['/', 'EBUSY'],
] as const) {
  test(`cleanup rejects dangerous final spelling ${path} without deleting data`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/temporary');
    await fs.writeFile('/temporary/keep', new Uint8Array([5]));
    await fs.symlink('/temporary', '/alias');
    const service = new PythonFileSystem(fs, { cwd: '/' });
    context.after(() => service.close());
    await assert.rejects(service.dispatch({ op: 'rmtree', args: [path] }), { code });
    assert.deepEqual(await fs.readFile('/temporary/keep'), new Uint8Array([5]));
    assert.equal(await fs.readlink('/alias'), '/temporary');
  });
}

for (const phase of ['lstat', 'stat', 'removeTreeConditional'] as const) {
  for (const reason of [new FsError('ENOENT'), null, false] as const) {
    test(`cancellation at ${phase} preserves reason ${String(reason)} and the entire tree`, async context => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('/temporary');
      await fs.writeFile('/temporary/keep', new Uint8Array([6]));
      const controller = new AbortController();
      const entered = deferred<AbortSignal>();
      const release = deferred();
      if (phase === 'removeTreeConditional') {
        const original = fs.removeTreeConditional.bind(fs);
        context.mock.method(fs, phase, async (path: string, options: ConditionalRemoveEntryOptions) => {
          assert.ok(options.signal);
          entered.resolve(options.signal);
          await release.promise;
          return original(path, options);
        });
      } else {
        const original = fs[phase].bind(fs);
        context.mock.method(fs, phase, async (path: string, options?: FsOptions) => {
          assert.ok(options?.signal);
          const observed = await original(path, options);
          entered.resolve(options.signal);
          await release.promise;
          return observed;
        });
      }
      const service = new PythonFileSystem(fs, { cwd: '/', signal: controller.signal });
      const operation = assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), error => error === reason);
      try {
        const signal = await entered.promise;
        controller.abort(reason);
        assert.equal(signal.aborted, true);
        assert.equal(signal.reason, reason);
        release.resolve();
        await operation;
        assert.deepEqual(await fs.readFile('/temporary/keep'), new Uint8Array([6]));
      } finally {
        release.resolve();
        await Promise.allSettled([operation, service.close()]);
      }
    });
  }
}

test('close drains admitted tree removal, rejects new work, and retires descriptors once', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/keep', new Uint8Array([7]));
  const descriptor = await fs.open('/temporary/keep', { access: 'read' });
  const closeDescriptor = descriptor.close.bind(descriptor);
  const closed = context.mock.method(descriptor, 'close', closeDescriptor);
  const entered = deferred<AbortSignal>();
  const release = deferred();
  const removeTree = fs.removeTreeConditional.bind(fs);
  context.mock.method(fs, 'removeTreeConditional', async (path: string, options: ConditionalRemoveEntryOptions) => {
    assert.ok(options.signal);
    entered.resolve(options.signal);
    await release.promise;
    return removeTree(path, options);
  });
  const service = new PythonFileSystem(fs, { cwd: '/', open: async () => descriptor });
  await service.dispatch({ op: 'open', args: ['/temporary/keep', { access: 'read' }] });
  const operation = assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), { code: 'ECANCELED' });
  try {
    const signal = await entered.promise;
    const closing = service.close();
    assert.equal(service.close(), closing);
    assert.equal(signal.aborted, true);
    await assertPending(closing);
    assert.equal(closed.mock.callCount(), 0);
    await assert.rejects(service.dispatch({ op: 'rmtreeSupported', args: ['/temporary'] }), { code: 'EBADF' });
    release.resolve();
    await Promise.all([operation, closing]);
    assert.equal(closed.mock.callCount(), 1);
    await assert.rejects(descriptor.stat(), { code: 'EBADF' });
    assert.deepEqual(await fs.readFile('/temporary/keep'), new Uint8Array([7]));
  } finally {
    release.resolve();
    await Promise.allSettled([operation, service.close(), descriptor.close()]);
  }
});

test('cancellation after deletion commits does not resurrect the tree or bypass close draining', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/file', new Uint8Array([1]));
  await fs.writeFile('/outside', new Uint8Array([2]));
  const committed = deferred();
  const release = deferred();
  const removeTree = fs.removeTreeConditional.bind(fs);
  context.mock.method(fs, 'removeTreeConditional', async (path: string, options: ConditionalRemoveEntryOptions) => {
    await removeTree(path, options);
    committed.resolve();
    await release.promise;
    options.signal?.throwIfAborted();
  });
  const service = new PythonFileSystem(fs, { cwd: '/' });
  const operation = assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), { code: 'ECANCELED' });
  try {
    await committed.promise;
    const closing = service.close();
    await assertPending(closing);
    await assert.rejects(fs.lstat('/temporary'), { code: 'ENOENT' });
    release.resolve();
    await Promise.all([operation, closing]);
    await assert.rejects(fs.lstat('/temporary'), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile('/outside'), new Uint8Array([2]));
  } finally {
    release.resolve();
    await Promise.allSettled([operation, service.close()]);
  }
});

for (const op of ['rmtreeSupported', 'rmtree'] as const) {
  test(`${op} observes cancellation after an uncooperative capability probe resolves`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/temporary');
    await fs.writeFile('/temporary/keep', new Uint8Array([3]));
    const entered = deferred();
    const release = deferred();
    Object.defineProperty(fs, 'capabilitiesFor', { value: async () => {
      entered.resolve();
      await release.promise;
      return fs.capabilities;
    } });
    const removed = context.mock.method(fs, 'removeTreeConditional', async () => { assert.fail('aborted capability probe must not authorize deletion'); });
    const controller = new AbortController();
    const reason = new FsError('ENOENT');
    const service = new PythonFileSystem(fs, { cwd: '/', signal: controller.signal });
    const operation = assert.rejects(service.dispatch({ op, args: ['/temporary'] }), error => error === reason);
    try {
      await entered.promise;
      controller.abort(reason);
      release.resolve();
      await operation;
      assert.equal(removed.mock.callCount(), 0);
      assert.deepEqual(await fs.readFile('/temporary/keep'), new Uint8Array([3]));
    } finally {
      release.resolve();
      await Promise.allSettled([operation, service.close()]);
    }
  });
}

test('successful deletion retains open file bytes until service retirement releases quota', async context => {
  const fs = new MemoryFileSystem({ maxBytes: 4 });
  await fs.mkdir('/temporary');
  await fs.writeFile('/temporary/file', new Uint8Array([1, 2, 3, 4]));
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  const descriptor = await service.dispatch({ op: 'open', args: ['/temporary/file', { access: 'readwrite' }] });
  assert.equal(typeof descriptor, 'number');
  await service.dispatch({ op: 'rmtree', args: ['/temporary'] });
  await assert.rejects(fs.lstat('/temporary'), { code: 'ENOENT' });
  assert.deepEqual(await service.dispatch({ op: 'read', args: [descriptor, 4, 0] }), new Uint8Array([1, 2, 3, 4]));
  assert.equal(await service.dispatch({ op: 'write', args: [descriptor, new Uint8Array([9]), 0] }), 1);
  assert.deepEqual(await service.dispatch({ op: 'read', args: [descriptor, 4, 0] }), new Uint8Array([9, 2, 3, 4]));
  await assert.rejects(fs.writeFile('/next', new Uint8Array([5])), { code: 'ENOSPC' });
  await service.close();
  await fs.writeFile('/next', new Uint8Array([5, 6, 7, 8]));
  assert.deepEqual(await fs.readFile('/next'), new Uint8Array([5, 6, 7, 8]));
});

test('repeated wide and deep tree retirement reclaims metadata and retained allocations', async context => {
  const fs = new MemoryFileSystem({ maxRetainedBytes: 2048, maxMetadataUnits: 100, maxBytes: 128 });
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  for (let iteration = 0; iteration < 40; iteration++) {
    const deepest = `/tree/${Array<string>(12).fill('child').join('/')}`;
    await fs.mkdir(deepest, { recursive: true });
    for (let index = 0; index < 8; index++) await fs.writeFile(`${deepest}/${index}`, new Uint8Array(16).fill(index));
    const retained = await fs.openReadFile(`${deepest}/0`);
    try {
      await service.dispatch({ op: 'rmtree', args: ['/tree'] });
      assert.deepEqual(await retained.read(0, 16), new Uint8Array(16));
      assert.deepEqual(await fs.readdir('/'), []);
    } finally { await retained.close(); }
  }
});

test('readonly path capability selection survives device forwarding over a writable mount root', async context => {
  const root = new MemoryFileSystem();
  const backing = new MemoryFileSystem();
  await backing.mkdir('/tree');
  await backing.writeFile('/tree/keep', new Uint8Array([8]));
  await root.symlink('/readonly/tree', '/alias');
  const mount = new MountFileSystem({ root, mounts: { '/readonly': new ReadOnlyFileSystem(backing) } });
  const service = new PythonFileSystem(new DeviceFileSystem(mount), { cwd: '/' });
  context.after(() => service.close());
  assert.equal(await service.dispatch({ op: 'rmtreeSupported', args: ['/readonly/tree'] }), true);
  await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/readonly/tree'] }), { code: 'EROFS' });
  await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/alias/'] }), { code: 'EACCES' });
  assert.deepEqual(await backing.readFile('/tree/keep'), new Uint8Array([8]));
});

test('device forwarding permits owned tree cleanup without admitting reserved device deletion', async context => {
  const backing = new MemoryFileSystem();
  await backing.mkdir('/temporary/nested', { recursive: true });
  await backing.writeFile('/temporary/nested/file', new Uint8Array([1]));
  await backing.mkdir('/dev');
  await backing.writeFile('/dev/keep', new Uint8Array([2]));
  const fs = new DeviceFileSystem(backing);
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  assert.equal(await service.dispatch({ op: 'rmtreeSupported', args: ['/temporary'] }), true);
  await service.dispatch({ op: 'rmtree', args: ['/temporary'] });
  await assert.rejects(backing.lstat('/temporary'), { code: 'ENOENT' });
  for (const path of ['/dev', '/dev/null']) {
    assert.equal(await service.dispatch({ op: 'rmtreeSupported', args: [path] }), false);
    await assert.rejects(service.dispatch({ op: 'rmtree', args: [path] }), { code: 'ENOTSUP' });
  }
  assert.equal((await fs.stat('/dev/null')).type, 'character');
  assert.deepEqual(await backing.readFile('/dev/keep'), new Uint8Array([2]));
});

for (const path of ['/temporary', '/temporary/nested', '/alias/temporary'] as const) {
  test(`nested mount boundary refuses cleanup of ${path} without partial deletion`, async context => {
    const root = new MemoryFileSystem();
    const mounted = new MemoryFileSystem();
    await root.mkdir('/temporary/nested', { recursive: true });
    await root.writeFile('/temporary/keep', new Uint8Array([1]));
    await root.symlink('/', '/alias');
    await mounted.writeFile('/keep', new Uint8Array([2]));
    const service = new PythonFileSystem(new MountFileSystem({ root, mounts: { '/temporary/nested': mounted } }), { cwd: '/' });
    context.after(() => service.close());
    await assert.rejects(service.dispatch({ op: 'rmtree', args: [path] }), { code: 'EBUSY' });
    assert.deepEqual(await root.readFile('/temporary/keep'), new Uint8Array([1]));
    assert.deepEqual(await mounted.readFile('/keep'), new Uint8Array([2]));
  });
}

test('scoped quota mount cleanup releases quota and leaves sibling prefixes untouched', async context => {
  const root = new MemoryFileSystem();
  const mounted = new MemoryFileSystem();
  await mounted.mkdir('/tree');
  await mounted.writeFile('/tree/file', new Uint8Array([1]));
  await root.mkdir('/mount-extra');
  await root.writeFile('/mount-extra/keep', new Uint8Array([2]));
  const quota = withFileSystemQuota(new MountFileSystem({ root, mounts: { '/mount': mounted } }), { maxBytes: 2 });
  const controller = new AbortController();
  let charged = 0;
  const scoped = scopeFileSystem(quota, () => { charged++; }, controller.signal);
  const service = new PythonFileSystem(scoped, { cwd: '/mount' });
  context.after(() => service.close());
  assert.equal(await service.dispatch({ op: 'rmtreeSupported', args: ['tree'] }), true);
  await service.dispatch({ op: 'rmtree', args: ['tree'] });
  assert.ok(charged >= 4);
  await assert.rejects(mounted.lstat('/tree'), { code: 'ENOENT' });
  await quota.writeFile('/mount/next', new Uint8Array([3]));
  await assert.rejects(quota.writeFile('/mount/overflow', new Uint8Array([4])), { code: 'ENOSPC' });
  assert.deepEqual(await root.readFile('/mount-extra/keep'), new Uint8Array([2]));
  assert.equal(controller.signal.aborted, false);
});

for (const missing of ['capability', 'method'] as const) {
  test(`cleanup refuses missing atomic ${missing} without falling back to recursive rm`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/temporary');
    await fs.writeFile('/temporary/keep', new Uint8Array([9]));
    if (missing === 'capability') Object.defineProperty(fs, 'capabilities', { value: { ...fs.capabilities, atomicTreeRemoval: false } });
    else Object.defineProperty(fs, 'removeTreeConditional', { value: undefined });
    const removed = context.mock.method(fs, 'rm', async () => { assert.fail('unchecked rm must not be called'); });
    const service = new PythonFileSystem(fs, { cwd: '/' });
    context.after(() => service.close());
    assert.equal(await service.dispatch({ op: 'rmtreeSupported', args: ['/temporary'] }), false);
    await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), { code: 'ENOTSUP' });
    assert.equal(removed.mock.callCount(), 0);
    assert.deepEqual(await fs.readFile('/temporary/keep'), new Uint8Array([9]));
  });
}

test('permission failure below the selected tree is atomic rather than partially deleting siblings', async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/temporary/allowed', { recursive: true });
  await fs.mkdir('/temporary/denied');
  await fs.writeFile('/temporary/allowed/file', new Uint8Array([1]));
  await fs.writeFile('/temporary/denied/file', new Uint8Array([2]));
  await fs.chmod('/temporary/denied', 0o555);
  const service = new PythonFileSystem(fs, { cwd: '/' });
  context.after(() => service.close());
  await assert.rejects(service.dispatch({ op: 'rmtree', args: ['/temporary'] }), { code: 'EACCES' });
  assert.deepEqual(await fs.readFile('/temporary/allowed/file'), new Uint8Array([1]));
  assert.deepEqual(await fs.readFile('/temporary/denied/file'), new Uint8Array([2]));
});
