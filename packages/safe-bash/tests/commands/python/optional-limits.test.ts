import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { Shell } from '../../../src/core.js';
import { createPythonExecutorPool, pythonCommands } from '../../../src/commands/python/index.js';

test('executor pool capacity is optional', async () => {
  const pool = createPythonExecutorPool({ createExecutor: () => ({ async run() { return 0; }, terminate() {} }) });
  const executors = Array.from({ length: 70 }, () => pool.createExecutor());
  assert.equal(pool.inspect().active, 70);
  await Promise.all(executors.map(executor => executor.terminate()));
  await pool.dispose();
});

for (const maxConcurrentWorkers of [undefined, 70]) test(`Python accepts concurrent executions without an implicit ceiling: ${maxConcurrentWorkers}`, async () => {
  let count = 0;
  let entered!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const done = new Promise<void>(resolve => { finish = resolve; });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ ...maxConcurrentWorkers === undefined ? {} : { maxConcurrentWorkers },
    createExecutor: () => ({ async run() { if (++count === 5) entered(); await done; return 0; }, terminate() { finish(); } }),
  }));
  const pending = Array.from({ length: 5 }, () => shell.exec('python -c pass').then(result => { if (result.exitCode !== 0) entered(); return result; }));
  try {
    await Promise.race([ready, Promise.all(pending)]);
    assert.equal(count, 5);
  } finally { finish(); await Promise.all(pending); await shell.dispose(); }
});

test('package downloads have no implicit total byte cap', async () => {
  const { createPythonPackageEnvironment } = await import('../../../src/commands/python/provisioning.js');
  const env = createPythonPackageEnvironment({ authorize: () => true, transport: async () => ({
    status: 200, statusText: 'OK', headers: [['content-length', String(64 * 1024 * 1024 + 1)]],
    body: (async function* () { yield new Uint8Array([1]); })(), async dispose() {},
  }) });
  const context = { fs: new MemoryFileSystem(), cwd: '/', signal: new AbortController().signal };
  const start = await env.prepare(context);
  try {
    const result = await env.dispatch('package-open', [start.session, 'https://example.org/demo.whl'], context) as { size: number };
    assert.equal(result.size, 1);
  } finally { env.finish(start); await env.dispose(); }
});

for (const maxDirectoryEntries of [undefined, 1]) test(`Python command forwards only an explicit directory quota: ${maxDirectoryEntries}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/data');
  await fs.writeFile('/data/one', new Uint8Array());
  await fs.writeFile('/data/two', new Uint8Array());
  let checked = false;
  const shell = new Shell({ fs }).use(pythonCommands({ ...maxDirectoryEntries === undefined ? {} : { maxDirectoryEntries },
    createExecutor: () => ({ async run(start) {
      start.onReady();
      if (maxDirectoryEntries === undefined) assert.deepEqual(await start.dispatch({ op: 'readdir', args: ['/data'] }), [{ name: 'one', type: 'file' }, { name: 'two', type: 'file' }]);
      else await assert.rejects(start.dispatch({ op: 'readdir', args: ['/data'] }), error => typeof error === 'object' && error !== null && 'code' in error && error.code === 'EFBIG');
      checked = true;
      return 0;
    }, terminate() {} }),
  }));
  try { assert.equal((await shell.exec('python -c pass')).exitCode, 0); assert(checked); }
  finally { await shell.dispose(); }
});

test('a download budget does not impose a requirements or manifest budget', async () => {
  const { createPythonPackageEnvironment } = await import('../../../src/commands/python/provisioning.js');
  const fs = new MemoryFileSystem();
  await fs.writeFile('/requirements.txt', new TextEncoder().encode('demo==1.0'));
  const env = createPythonPackageEnvironment({ maxDownloadBytes: 1, requirementFiles: ['/requirements.txt'] });
  const context = { fs, cwd: '/', signal: new AbortController().signal };
  const start = await env.prepare(context);
  try {
    assert.deepEqual(start.requirements, ['demo==1.0']);
    await env.dispatch('package-commit', [start.session, start.requirements], context);
    env.finish(start);
    const replay = await env.prepare(context);
    assert.deepEqual(replay.requirements, ['demo==1.0']);
    env.finish(replay);
  } finally { await env.dispose(); }
});
