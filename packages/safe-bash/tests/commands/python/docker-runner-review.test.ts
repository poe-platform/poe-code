import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import workerThreads from 'node:worker_threads';
import { runDockerPythonExecutor } from '../../../src/commands/python/docker-runner.js';
import type { PythonWorkerStart } from '../../../src/commands/python/index.js';

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

const startup = {
  type: 'start', maxTransferBytes: 1024, maxFrameBytes: 65536,
  invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/runtime',
};

function line(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + '\n');
}

function fixture(context: TestContext, controls: {
  holdOutput?: (value: Record<string, unknown>) => boolean;
  outputError?: Error;
  terminateError?: Error;
  retirement?: Promise<number>;
} = {}) {
  const input = new PassThrough();
  const messages: Record<string, unknown>[] = [];
  const heldWrites: (() => void)[] = [];
  const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
    const message = JSON.parse(chunk.toString()) as Record<string, unknown>;
    messages.push(message);
    if (controls.holdOutput?.(message)) heldWrites.push(() => callback());
    else callback(controls.outputError);
  } });
  const posted = deferred<PythonWorkerStart>();
  const allocated = deferred<FakeWorker>();
  const terminated = deferred();
  let workers = 0;
  let terminations = 0;
  class FakeWorker extends EventEmitter {
    constructor() { super(); workers++; allocated.resolve(this); }
    postMessage(value: PythonWorkerStart) { posted.resolve(value); }
    async terminate() {
      terminations++;
      terminated.resolve();
      if (controls.terminateError) throw controls.terminateError;
      return controls.retirement ?? 0;
    }
  }
  const constructor = context.mock.method(workerThreads, 'Worker', function () {
    return new FakeWorker();
  } as unknown as typeof workerThreads.Worker);
  syncBuiltinESMExports();
  context.after(() => { constructor.mock.restore(); syncBuiltinESMExports(); });
  context.mock.getter(process, 'stdin', () => input);
  context.mock.getter(process, 'stdout', () => output);
  const state = { settled: false };
  const result = Promise.allSettled([runDockerPythonExecutor({
    isolatedContainer: true, runtimeModuleURL: 'file:///not-accessed/review-runtime.mjs',
  })]);
  void result.then(() => { state.settled = true; });
  return {
    input, output, messages, posted, allocated, terminated, result, state,
    get workers() { return workers; },
    get terminations() { return terminations; },
    async boot() {
      input.write(line(startup));
      const worker = await allocated.promise;
      await posted.promise;
      return worker;
    },
    async finish() {
      input.emit('end');
      await nextTurn();
      while (heldWrites.length) { heldWrites.shift()!(); await nextTurn(); }
      await result;
    },
  };
}

test('review: fragmented startup and reply publish exact shared-memory bytes and retire listeners', async context => {
  const engine = fixture(context);
  try {
    const bytes = line(startup);
    for (const byte of bytes) engine.input.write(Buffer.from([byte]));
    const worker = await engine.allocated.promise;
    const started = await engine.posted.promise;
    worker.emit('message', { op: 'read', args: [3, 4] });
    const reply = line({ id: 1, status: 1, value: [0, 255, 13, 10] });
    for (const byte of reply) engine.input.write(Buffer.from([byte]));
    const control = new Int32Array(started.shared, 0, 2);
    assert.equal(Atomics.load(control, 0), 1);
    const payload = new Uint8Array(started.shared, 8, Atomics.load(control, 1));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(payload)), [0, 255, 13, 10]);
    worker.emit('message', { type: 'exit', exitCode: 0 });
    assert.deepEqual(await engine.result, [{ status: 'fulfilled', value: undefined }]);
    assert.deepEqual(engine.messages, [
      { type: 'request', id: 1, op: 'read', args: [3, 4] }, { type: 'exit', exitCode: 0 },
    ]);
    assert.equal(engine.terminations, 1);
    assert.equal(engine.input.destroyed, true);
    assert.equal(engine.input.listenerCount('data'), 0);
    assert.equal(engine.output.listenerCount('error'), 0);
    for (const event of ['message', 'error', 'exit']) assert.equal(worker.listenerCount(event), 0);
  } finally { await engine.finish(); }
});

test('review: EOF before startup reports transport failure without allocating a worker', async context => {
  const engine = fixture(context);
  engine.input.end();
  await engine.result;
  assert.equal(engine.workers, 0);
  assert.deepEqual(engine.messages, [{ type: 'error', category: 'transport-unavailable' }]);
  assert.equal(engine.input.listenerCount('data'), 0);
});

test('review: EOF with an outstanding request retires its worker and rejects late replies', async context => {
  const engine = fixture(context);
  const worker = await engine.boot();
  const started = await engine.posted.promise;
  worker.emit('message', { op: 'stat', args: ['/pending'] });
  engine.input.end();
  await engine.result;
  engine.input.emit('data', line({ id: 1, status: 1, value: 9 }));
  assert.equal(Atomics.load(new Int32Array(started.shared, 0, 2), 0), 0);
  assert.equal(engine.terminations, 1);
  assert.deepEqual(engine.messages.at(-1), { type: 'error', category: 'transport-unavailable' });
});

test('review: failure retirement cannot wait behind a backpressured diagnostic write', async context => {
  const engine = fixture(context, { holdOutput: value => value.type === 'error' });
  try {
    const worker = await engine.boot();
    worker.emit('message', { op: 'stat', args: ['/pending'] });
    engine.input.end();
    await nextTurn();
    assert.equal(engine.terminations, 1, 'EOF must terminate the blocked worker before awaiting error-output drain');
  } finally { await engine.finish(); }
});

for (const stream of ['input', 'output'] as const) {
  test(`review: ${stream} close without end or error retires the worker`, async context => {
    const engine = fixture(context);
    try {
      await engine.boot();
      engine[stream].destroy();
      await nextTurn();
      assert.equal(engine.terminations, 1, 'a closed pipe must not strand the worker and runner completion');
      assert.equal(engine.state.settled, true);
    } finally { await engine.finish(); }
  });
}

test('review: coalesced startup cannot retain an oversized tail after negotiating a smaller frame bound', async context => {
  const engine = fixture(context);
  try {
    engine.input.write(Buffer.concat([line(startup), Buffer.alloc(startup.maxFrameBytes + 2, 32)]));
    await nextTurn();
    assert.equal(engine.state.settled, true, 'buffered tail must be rechecked against the newly negotiated limit without another data event');
    assert.equal(engine.terminations, engine.workers);
    assert.deepEqual(engine.messages.at(-1), { type: 'error', category: 'transport-unavailable' });
  } finally { await engine.finish(); }
});

const invalidReplies: readonly [string, unknown][] = [
  ['wrong request id', { id: 2, status: 1, value: 0 }],
  ['invalid status', { id: 1, status: 3, value: 0 }],
  ['null frame', null],
];

for (const [name, reply] of invalidReplies) {
  test(`review: ${name} never wakes the waiting worker with unvalidated bytes`, async context => {
    const engine = fixture(context);
    const worker = await engine.boot();
    const started = await engine.posted.promise;
    worker.emit('message', { op: 'stat', args: ['/pending'] });
    engine.input.write(line(reply));
    await engine.result;
    assert.equal(Atomics.load(new Int32Array(started.shared, 0, 2), 0), 0);
    assert.equal(engine.terminations, 1);
    assert.deepEqual(engine.messages.at(-1), { type: 'error', category: 'transport-unavailable' });
  });
}

test('review: a replayed reply cannot overwrite already published shared memory', async context => {
  const engine = fixture(context);
  const worker = await engine.boot();
  const started = await engine.posted.promise;
  worker.emit('message', { op: 'read', args: [1, 1] });
  engine.input.write(line({ id: 1, status: 1, value: 7 }));
  engine.input.write(line({ id: 1, status: 2, value: 99 }));
  await engine.result;
  const control = new Int32Array(started.shared, 0, 2);
  assert.equal(Atomics.load(control, 0), 1);
  assert.equal(new TextDecoder().decode(new Uint8Array(started.shared, 8, Atomics.load(control, 1))), '7');
  assert.equal(engine.terminations, 1);
});

test('review: concurrent worker requests fail instead of allocating a second protocol request', async context => {
  const engine = fixture(context);
  const worker = await engine.boot();
  worker.emit('message', { op: 'stat', args: ['/first'] });
  worker.emit('message', { op: 'stat', args: ['/second'] });
  await engine.result;
  assert.equal(engine.messages.filter(message => message.type === 'request').length, 1);
  assert.deepEqual(engine.messages.at(-1), { type: 'error', category: 'transport-unavailable' });
  assert.equal(engine.terminations, 1);
});

test('review: malformed worker messages cannot escape the callback and bypass owned cleanup', async context => {
  const engine = fixture(context);
  try {
    const worker = await engine.boot();
    assert.doesNotThrow(() => worker.emit('message', null));
    await nextTurn();
    assert.equal(engine.terminations, 1);
    assert.deepEqual(engine.messages.at(-1), { type: 'error', category: 'transport-unavailable' });
  } finally { await engine.finish(); }
});

test('review: failed stdout also failing diagnostic output still terminates exactly once', async context => {
  const engine = fixture(context, { outputError: new Error('synthetic broken output') });
  const worker = await engine.boot();
  worker.emit('message', { op: 'stat', args: ['/pending'] });
  const outcome = (await engine.result)[0]!;
  assert.equal(outcome.status, 'rejected');
  assert.equal(engine.terminations, 1);
  assert.equal(engine.input.destroyed, true);
  assert.equal(worker.listenerCount('message'), 0);
});

test('review: successful guest exit waits for worker retirement confirmation', async context => {
  const retirement = deferred<number>();
  const engine = fixture(context, { retirement: retirement.promise });
  try {
    const worker = await engine.boot();
    worker.emit('message', { type: 'exit', exitCode: 0 });
    await engine.terminated.promise;
    await nextTurn();
    assert.equal(engine.state.settled, false);
    assert.equal(worker.listenerCount('message'), 0);
  } finally { retirement.resolve(0); await engine.finish(); }
  assert.deepEqual(await engine.result, [{ status: 'fulfilled', value: undefined }]);
});

test('review: failed worker retirement remains observable after a successful guest exit', async context => {
  const failure = new Error('synthetic worker retirement failure');
  const engine = fixture(context, { terminateError: failure });
  const worker = await engine.boot();
  worker.emit('message', { type: 'exit', exitCode: 0 });
  assert.deepEqual(await engine.result, [{ status: 'rejected', reason: failure }]);
  assert.equal(engine.terminations, 1);
  assert.equal(worker.listenerCount('message'), 0);
});

test('review: output close during a backpressured terminal frame still retires the worker', async context => {
  const engine = fixture(context, { holdOutput: value => value.type === 'exit' });
  try {
    const worker = await engine.boot();
    worker.emit('message', { type: 'exit', exitCode: 0 });
    assert.deepEqual(engine.messages, [{ type: 'exit', exitCode: 0 }]);
    assert.equal(engine.state.settled, false);
    engine.output.destroy();
    await nextTurn();
    assert.equal(engine.terminations, 1, 'terminal receipt must not suppress output-close failure while its write is pending');
    assert.equal(engine.state.settled, true);
    assert.equal((await engine.result)[0]!.status, 'rejected');
  } finally { await engine.finish(); }
});

test('review: failed retirement releases owned pipe listeners while preserving caller listeners', async context => {
  const failure = new Error('synthetic retirement failure with live pipe listeners');
  const engine = fixture(context, { terminateError: failure });
  const observer = () => {};
  engine.input.on('end', observer);
  engine.output.on('error', observer);
  try {
    const worker = await engine.boot();
    worker.emit('message', { type: 'exit', exitCode: 0 });
    assert.deepEqual(await engine.result, [{ status: 'rejected', reason: failure }]);
    assert.equal(engine.terminations, 1);
    assert.deepEqual(engine.input.listeners('end'), [observer], 'retirement rejection must not skip input listener release');
    assert.deepEqual(engine.output.listeners('error'), [observer], 'retirement rejection must not skip output listener release');
    assert.equal(engine.input.listenerCount('error'), 0);
    assert.equal(engine.output.listenerCount('close'), 0);
    assert.equal(worker.listenerCount('message'), 0);
  } finally { await engine.finish(); }
});
