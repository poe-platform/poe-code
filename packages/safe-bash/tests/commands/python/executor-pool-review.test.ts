import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Shell } from '../../../src/core.js';
import { MemoryFileSystem } from '../../../src/fs/memory/index.js';
import { pythonCommands, type PythonAsyncExecutor, type PythonExecutorStart } from '../../../src/commands/python/index.js';
import { createPythonExecutorPool } from '../../../src/commands/python/executor-pool.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function start(signal = new AbortController().signal): PythonExecutorStart {
  return {
    signal, invocation: { args: ['-c', 'pass'], cwd: '/', env: {} },
    runtimeMount: '/runtime', maxTransferBytes: 1024,
    async dispatch() { return null; }, onReady() {},
  };
}

test('review: shared shell admission stays full through retirement and shell disposal does not own the pool', async () => {
  const entered = deferred();
  const finish = deferred<number>();
  const retiring = deferred();
  const release = deferred();
  let factories = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor() {
    factories++;
    if (factories > 1) return { async run() { return 0; }, terminate() {} };
    return {
      async run() { entered.resolve(); return finish.promise; },
      async terminate() { retiring.resolve(); await release.promise; },
    };
  } });
  const shells = Array.from({ length: 5 }, () => new Shell({ fs: new MemoryFileSystem() })
    .use(pythonCommands({ createExecutor: pool.createExecutor })));
  const execution = shells[0]!.exec('python -c pass');
  try {
    await entered.promise;
    finish.resolve(0);
    await retiring.promise;
    const refusals = await Promise.all(shells.slice(1).map(shell => shell.exec('python3 -c pass')));
    for (const result of refusals) {
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /capacity exhausted/);
    }
    assert.equal(factories, 1);
    release.resolve();
    assert.equal((await execution).exitCode, 0);
    await shells[0]!.dispose();
    assert.deepEqual(pool.inspect(), { active: 0, capacity: 1, closed: false });
    assert.equal((await shells[1]!.exec('python -c pass')).exitCode, 0);
    assert.equal(factories, 2);
  } finally {
    finish.resolve(0);
    release.resolve();
    await execution;
    await Promise.all(shells.map(shell => shell.dispose()));
    await pool.dispose();
  }
});

test('review: reentrant disposal covers an endpoint returned after factory-triggered disposal', async () => {
  const retiring = deferred();
  const release = deferred();
  let disposal: Promise<void> | undefined;
  let terminated = 0;
  let runs = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 2, createExecutor() {
    assert.equal(pool.inspect().active, 1);
    disposal = pool.dispose();
    assert.throws(() => pool.createExecutor(), /unavailable/);
    return {
      async run() { runs++; return 0; },
      async terminate() { terminated++; retiring.resolve(); await release.promise; },
    };
  } });
  assert.throws(() => pool.createExecutor(), /unavailable/);
  assert.ok(disposal);
  let settled = false;
  void disposal.then(() => { settled = true; });
  try {
    await retiring.promise;
    await nextTurn();
    assert.equal(settled, false);
    assert.equal(terminated, 1);
    assert.equal(runs, 0);
    assert.equal(pool.inspect().active, 1);
    assert.equal(pool.dispose(), disposal);
  } finally { release.resolve(); await disposal; }
  assert.deepEqual(pool.inspect(), { active: 0, capacity: 2, closed: true });
});

test('review: reentrant disposal followed by a factory throw releases the unfinished acquisition', async () => {
  const failure = new Error('factory failed after closing pool');
  let disposal: Promise<void> | undefined;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor() {
    disposal = pool.dispose();
    throw failure;
  } });
  assert.throws(() => pool.createExecutor(), error => error === failure);
  assert.ok(disposal);
  await disposal;
  assert.deepEqual(pool.inspect(), { active: 0, capacity: 1, closed: true });
});

test('review: disposal attempts every endpoint and drains a slow sibling after synchronous retirement failure', async () => {
  const failure = new Error('first retirement failed');
  const entered = deferred();
  const release = deferred();
  const terminated: number[] = [];
  let factories = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 3, createExecutor() {
    const identity = factories++;
    return {
      async run() { return 0; },
      terminate() {
        terminated.push(identity);
        if (identity === 0) throw failure;
        if (identity === 1) { entered.resolve(); return release.promise; }
      },
    };
  } });
  for (let count = 0; count < 3; count++) pool.createExecutor();
  const disposal = pool.dispose();
  const result = Promise.allSettled([disposal]);
  let settled = false;
  void result.then(() => { settled = true; });
  try {
    await entered.promise;
    await nextTurn();
    assert.equal(settled, false);
    assert.deepEqual(terminated, [0, 1, 2]);
    assert.equal(pool.inspect().active, 2);
  } finally { release.resolve(); await result; }
  assert.deepEqual(await result, [{ status: 'rejected', reason: failure }]);
  assert.equal(pool.inspect().active, 1);
  await assert.rejects(pool.dispose(), error => error === failure);
  assert.deepEqual(terminated, [0, 1, 2]);
});

test('review: failed termination cannot settle pool disposal before its own admitted run drains', async () => {
  const failure = new Error('terminate failed while run was draining');
  const entered = deferred();
  const release = deferred<number>();
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    async run() { entered.resolve(); return release.promise; },
    terminate() { throw failure; },
  }) });
  const endpoint = pool.createExecutor();
  const execution = endpoint.run(start());
  await entered.promise;
  const result = Promise.allSettled([pool.dispose()]);
  let settled = false;
  void result.then(() => { settled = true; });
  try {
    await nextTurn();
    assert.equal(pool.inspect().active, 1);
    assert.equal(settled, false, 'disposal must cover the admitted run even when termination rejects');
  } finally { release.resolve(0); await execution; await result; }
  assert.deepEqual(await result, [{ status: 'rejected', reason: failure }]);
  assert.equal(pool.inspect().active, 1);
});

test('review: a termination accessor failure still drains the admitted run before disposal rejects', async () => {
  const failure = new Error('termination accessor failed after run started');
  const entered = deferred();
  const release = deferred<number>();
  let running = false;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    async run() { running = true; entered.resolve(); return release.promise; },
    get terminate(): PythonAsyncExecutor['terminate'] {
      if (running) throw failure;
      return () => {};
    },
  }) });
  const endpoint = pool.createExecutor();
  const execution = endpoint.run(start());
  await entered.promise;
  const result = Promise.allSettled([pool.dispose()]);
  let settled = false;
  void result.then(() => { settled = true; });
  try {
    await nextTurn();
    assert.equal(pool.inspect().active, 1);
    assert.equal(settled, false, 'termination method lookup must be inside the admitted-run drain barrier');
  } finally { release.resolve(0); await execution; await result; }
  assert.deepEqual(await result, [{ status: 'rejected', reason: failure }]);
  assert.equal(pool.inspect().active, 1);
});

test('review: successful termination does not admit another endpoint while the old run drains', async () => {
  const entered = deferred();
  const release = deferred<number>();
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    async run() { entered.resolve(); return release.promise; },
    terminate() { terminations++; },
  }) });
  const endpoint = pool.createExecutor();
  const execution = endpoint.run(start());
  await entered.promise;
  const retirement = endpoint.terminate();
  try {
    await nextTurn();
    assert.equal(terminations, 1);
    assert.equal(pool.inspect().active, 1);
    assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  } finally { release.resolve(0); await execution; await retirement; await pool.dispose(); }
  assert.equal(pool.inspect().active, 0);
});

test('review: retirement reentry shares completion and cannot reacquire its occupied slot', async () => {
  let reentered: void | Promise<void> = undefined;
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    async run() { return 0; },
    terminate() {
      terminations++;
      assert.throws(() => pool.createExecutor(), /capacity exhausted/);
      reentered = endpoint.terminate();
    },
  }) });
  const endpoint = pool.createExecutor();
  const retirement = endpoint.terminate();
  await retirement;
  assert.equal(reentered, retirement);
  assert.equal(terminations, 1);
  await pool.dispose();
});

test('review: a synchronous host run failure consumes the endpoint but not its retirement obligation', async () => {
  const failure = new Error('run threw before returning a promise');
  let runs = 0;
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    run() { runs++; throw failure; }, terminate() { terminations++; },
  }) });
  const endpoint = pool.createExecutor();
  const execution = endpoint.run(start());
  await assert.rejects(endpoint.run(start()), /unavailable/);
  await assert.rejects(execution, error => error === failure);
  await assert.rejects(endpoint.run(start()), /unavailable/);
  assert.equal(runs, 1);
  assert.equal(pool.inspect().active, 1);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  await endpoint.terminate();
  await pool.dispose();
  assert.equal(terminations, 1);
});

test('review: same-turn retirement prevents a queued host run from starting', async () => {
  let runs = 0;
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor: () => ({
    async run() { runs++; return 0; }, terminate() { terminations++; },
  }) });
  const endpoint = pool.createExecutor();
  const execution = endpoint.run(start());
  const retirement = endpoint.terminate();
  await assert.rejects(execution, /unavailable/);
  await retirement;
  await pool.dispose();
  assert.equal(runs, 0);
  assert.equal(terminations, 1);
});

test('review: borrowed invocation signals and callbacks are forwarded without cross-endpoint cancellation', async () => {
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();
  const requests = [start(firstAbort.signal), start(secondAbort.signal)];
  const seen: PythonExecutorStart[] = [];
  const entered = deferred();
  const releases = [deferred<number>(), deferred<number>()];
  let factories = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 2, createExecutor() {
    const identity = factories++;
    return {
      async run(request) {
        seen.push(request);
        if (seen.length === 2) entered.resolve();
        return releases[identity]!.promise;
      },
      terminate() { releases[identity]!.resolve(0); },
    };
  } });
  const endpoints = [pool.createExecutor(), pool.createExecutor()];
  const executions = endpoints.map((endpoint, index) => endpoint.run(requests[index]!));
  try {
    await entered.promise;
    assert.equal(seen[0], requests[0]);
    assert.equal(seen[1], requests[1]);
    firstAbort.abort(false);
    assert.equal(seen[0]!.signal.reason, false);
    assert.equal(seen[1]!.signal.aborted, false);
    await endpoints[0]!.terminate();
    assert.equal(pool.inspect().active, 1);
    assert.equal(secondAbort.signal.aborted, false);
    await pool.dispose();
    assert.equal(secondAbort.signal.aborted, false, 'pool must not own the caller AbortController');
  } finally { await pool.dispose(); await Promise.all(executions); }
});

test('review: a throwing endpoint run accessor must retire the already allocated host', async () => {
  const failure = new Error('run accessor failed');
  let terminations = 0;
  const pool = createPythonExecutorPool({ maxConcurrentExecutors: 1, createExecutor() {
    return {
      get run(): PythonAsyncExecutor['run'] { throw failure; },
      terminate() { terminations++; },
    };
  } });
  try {
    assert.throws(() => pool.createExecutor());
    await nextTurn();
    assert.equal(terminations, 1, 'failed endpoint validation must clean up the host not returned to its caller');
    assert.equal(pool.inspect().active, 0);
  } finally { await pool.dispose(); }
});
