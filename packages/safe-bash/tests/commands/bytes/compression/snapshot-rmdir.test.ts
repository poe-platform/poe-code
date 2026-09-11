import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { deferred } from './helpers.js';
import { Shell } from '../../../../src/shell/shell.js';
import { CommandRegistry } from '../../../../src/contracts/index.js';
import { createCompressionCommands } from '../../../../src/commands/bytes/compression/index.js';
import { run, wrap } from './helpers.js';
import { createMemoryFileSystem } from '../../../../src/fs/memory/index.js';
import { FsError } from '../../../../src/contracts/index.js';

for (const profile of ['global-snapshot', 'destination-strict-stage-snapshot'] as const) {
  test(`strong staging cleanup refuses ${profile} marker semantics`, async context => {
    const memory = createMemoryFileSystem();
    const original = Uint8Array.of(65, 10), foreign = Uint8Array.of(70, 10);
    await memory.writeFile('/input', original);
    const explicitMarkers = new Set<string>();
    const capabilityPaths: string[] = [];
    let directory = '', markerDeletes = 0, foreignPath = '';
    const capabilities = { ...memory.capabilities, snapshotRmdir: true };
    const fs = wrap(memory, {
      capabilities,
      async capabilitiesFor(path) {
        capabilityPaths.push(path);
        return { ...capabilities, snapshotRmdir: profile === 'global-snapshot' || path.includes('/.virtual-bash-gzip-') };
      },
      async mkdir(path, options) {
        await memory.mkdir(path, options);
        explicitMarkers.add(path); directory = path;
      },
      async rmdir(path, options) {
        options?.signal?.throwIfAborted();
        if (path === '/') throw new FsError('EBUSY', {path});
        const stat = await memory.lstat(path, options);
        if (stat.type !== 'directory') throw new FsError('ENOTDIR', {path});
        if (!explicitMarkers.has(path)) throw new FsError('ENOTSUP', {path});
        if ((await memory.readdir(path, options)).length) throw new FsError('ENOTEMPTY', {path});
        foreignPath = path + '/foreign';
        await memory.writeFile(foreignPath, foreign);
        options?.signal?.throwIfAborted();
        assert.equal(explicitMarkers.delete(path), true);
        markerDeletes++;
      },
    });
    const outcome = await run('gzip', ['input'], undefined, {fs});
    const inputSurvives = await memory.lstat('/input').then(() => true, () => false);
    const directorySurvives = directory ? await memory.lstat(directory).then(() => true, () => false) : false;
    const foreignSurvives = foreignPath ? await memory.lstat(foreignPath).then(() => true, () => false) : false;
    context.diagnostic(JSON.stringify({profile,exitCode:outcome.exitCode,markerDeletes,inputSurvives,directorySurvives,foreignSurvives,capabilityPaths,directory}));
    if (markerDeletes) {
      assert.equal(explicitMarkers.has(directory), false);
      assert.equal(directorySurvives, true);
      assert.deepEqual(await memory.readFile(foreignPath), foreign);
    }
    assert.equal(outcome.exitCode, 1, 'strong cleanup must refuse explicitly weaker marker-only removal');
    assert.equal(inputSurvives, true, 'source must not be removed following unsupported strong cleanup');
    assert.equal(markerDeletes, 0, 'do not admit marker removal as strong directory cleanup');
  });
}

test('aggregate snapshot profile admits the actual strong staging route', async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile('/input', Uint8Array.of(65, 10));
  const queried = new Set<string>();
  let acquisitions = 0;
  const fs = wrap(memory, {
    capabilities: { ...memory.capabilities, snapshotRmdir: true },
    async capabilitiesFor(path, options) {
      if (path.includes('/.virtual-bash-gzip-')) {
        assert.equal(options?.create, true);
        assert.equal(options?.allowDirectory, true);
        queried.add(path);
      }
      return { ...memory.capabilities, snapshotRmdir: false };
    },
    async mkdir(path, options) {
      assert.equal(queried.has(path), true);
      acquisitions++;
      await memory.mkdir(path, options);
    },
  });
  const outcome = await run('gzip', ['input'], undefined, { fs });
  assert.equal(outcome.exitCode, 0);
  assert.equal(acquisitions, 1);
  assert.deepEqual(await memory.readdir('/'), [{ name: 'input.gz', type: 'file' }]);
});

test('actual staging snapshot getter preserves falsey cancellation before acquisition', async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile('/input', Uint8Array.of(65, 10));
  const controller = new AbortController();
  let reads = 0, acquisitions = 0;
  const fs = wrap(memory, {
    async capabilitiesFor(path) {
      if (!path.includes('/.virtual-bash-gzip-')) return memory.capabilities;
      return { ...memory.capabilities, get snapshotRmdir() { reads++; controller.abort(false); return false; } };
    },
    async mkdir(path, options) { acquisitions++; await memory.mkdir(path, options); },
  });
  const outcome = await run('gzip', ['input'], undefined, { fs, signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  assert.deepEqual(outcome, { reason: false });
  assert.equal(reads, 1);
  assert.equal(acquisitions, 0);
  assert.deepEqual(await memory.readdir('/'), [{ name: 'input', type: 'file' }]);
});

test('actual Shell exec/dispose drains an admitted staging capability query', { timeout: 3000 }, async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile('/input', Uint8Array.of(65, 10));
  const entered = deferred(), release = deferred();
  let acquisitions = 0;
  const fs = wrap(memory, {
    async capabilitiesFor(path) {
      if (path.includes('/.virtual-bash-gzip-')) { entered.resolve(); await release.promise; }
      return memory.capabilities;
    },
    async mkdir(path, options) { acquisitions++; await memory.mkdir(path, options); },
  });
  const shell = new Shell({ fs, cwd: '/', commands: new CommandRegistry(createCompressionCommands()) });
  const controller = new AbortController();
  let settled = false, disposed = false;
  const executing = shell.exec('gzip input', { signal: controller.signal }).then(value => ({ value }), reason => ({ reason }));
  void executing.then(() => { settled = true; });
  let disposing: Promise<void> | undefined;
  try {
    await Promise.race([entered.promise, executing.then(() => { throw new Error('staging query was not admitted'); })]);
    controller.abort(false);
    disposing = shell.dispose();
    void disposing.then(() => { disposed = true; }, () => { disposed = true; });
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    assert.deepEqual({ settled, disposed }, { settled: false, disposed: false });
    release.resolve();
    assert.deepEqual(await executing, { reason: false });
    await disposing;
    assert.equal(acquisitions, 0);
    assert.deepEqual(await memory.readdir('/'), [{ name: 'input', type: 'file' }]);
  } finally { release.resolve(); await executing; await (disposing ?? shell.dispose()).catch(() => {}); }
});
