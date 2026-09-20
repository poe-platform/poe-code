import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import { createPythonExecutorPool, pythonCommands, type PythonAsyncExecutor, type PythonExecutorStart } from '../../../src/commands/python/index.js';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

test('shared executor admission bounds independent shells and both Python aliases', async () => {
  const entered = deferred<void>();
  const finish = deferred<number>();
  let created = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor() {
    created++;
    return { async run() { entered.resolve(); return finish.promise; }, terminate() { finish.resolve(0); } };
  } });
  const first = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  const second = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createExecutor: pool.createExecutor }));
  try {
    const pending = first.exec('python -c pass');
    await entered.promise;
    const rejected = await second.exec('python3 -c pass');
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /capacity exhausted/);
    assert.equal(created, 1);
    assert.deepEqual(pool.inspect(), { active: 1, capacity: 1, closed: false });
    finish.resolve(0);
    assert.equal((await pending).exitCode, 0);
    assert.equal((await second.exec('python3 -c pass')).exitCode, 0);
    assert.equal(created, 2);
  } finally { await first.dispose(); await second.dispose(); await pool.dispose(); }
});

test('admission remains occupied until confirmed retirement, not run completion', async () => {
  const retiring = deferred<void>();
  const retired = deferred<void>();
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1,
    createExecutor: () => ({ async run() { return 0; }, terminate() { terminations++; retiring.resolve(); return retired.promise; } }),
  });
  const endpoint = pool.createExecutor();
  assert.equal(await endpoint.run({} as PythonExecutorStart), 0);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  const first = endpoint.terminate();
  const second = endpoint.terminate();
  await retiring.promise;
  assert.equal(terminations, 1);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  retired.resolve();
  await Promise.all([first, second]);
  assert.equal(pool.inspect().active, 0);
  await pool.dispose();
});

test('failed retirement holds admission and remains observable to disposal', async () => {
  const failure = new Error('host retirement rejected');
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1,
    createExecutor: () => ({ async run() { return 0; }, async terminate() { terminations++; throw failure; } }),
  });
  const endpoint = pool.createExecutor();
  await assert.rejects(Promise.resolve(endpoint.terminate()), error => error === failure);
  assert.equal(pool.inspect().active, 1);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  await assert.rejects(pool.dispose(), error => error === failure);
  assert.equal(terminations, 1);
  assert.equal(pool.inspect().closed, true);
});

test('factory exceptions release reservations and reentrant acquisition is bounded', async () => {
  let calls = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor() {
    calls++;
    assert.throws(() => pool.createExecutor(), /capacity exhausted/);
    if (calls === 1) throw new Error('factory failed');
    return { async run() { return 0; }, terminate() {} };
  } });
  assert.throws(() => pool.createExecutor(), /factory failed/);
  assert.equal(pool.inspect().active, 0);
  const endpoint = pool.createExecutor();
  await endpoint.terminate();
  await pool.dispose();
});

test('pool disposal retires every owned endpoint without releasing a borrowed host', async () => {
  const firstRetired = deferred<void>();
  const secondRetired = deferred<void>();
  let created = 0;
  let terminated = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 2, createExecutor() {
    const retirement = created++ === 0 ? firstRetired : secondRetired;
    return { async run() { return 0; }, terminate() { terminated++; return retirement.promise; } };
  } });
  const first = pool.createExecutor();
  pool.createExecutor();
  const disposal = pool.dispose();
  assert.throws(() => pool.createExecutor(), /unavailable/);
  await assert.rejects(first.run({} as PythonExecutorStart), /unavailable/);
  await Promise.resolve();
  assert.equal(terminated, 2);
  firstRetired.resolve();
  secondRetired.resolve();
  await disposal;
  await pool.dispose();
  assert.deepEqual(pool.inspect(), { active: 0, capacity: 2, closed: true });
});

test('an endpoint cannot start a second invocation or run after retirement', async () => {
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1,
    createExecutor: () => ({ async run() { return 0; }, terminate() {} }),
  });
  const endpoint = pool.createExecutor();
  await endpoint.run({} as PythonExecutorStart);
  await assert.rejects(endpoint.run({} as PythonExecutorStart), /unavailable/);
  await endpoint.terminate();
  await assert.rejects(endpoint.run({} as PythonExecutorStart), /unavailable/);
  await pool.dispose();
});

test('invalid pool options fail before acquiring a runtime', () => {
  const createExecutor = () => ({ async run() { return 0; }, terminate() {} });
  for (const maxConcurrentExecutors of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => createPythonExecutorPool({ maxConcurrentExecutors, createExecutor }), RangeError);
  }
  assert.throws(() => createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: null as unknown as () => PythonAsyncExecutor }), TypeError);
});
