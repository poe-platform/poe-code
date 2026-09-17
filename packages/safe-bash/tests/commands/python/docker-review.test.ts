import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Duplex, Readable, Writable } from 'node:stream';
import { createDockerPythonExecutorPool } from '../../../src/commands/python/docker.js';
import { runDockerPythonExecutor } from '../../../src/commands/python/docker-runner.js';
import type { PythonExecutorStart } from '../../../src/commands/python/index.js';

const image = 'sha256:' + 'b'.repeat(64);
const options = {
  socketPath: '/explicit/review-docker.sock', image, memoryBytes: 134217728,
  cpus: 0.25, deadlineMs: 10000, maxConcurrentExecutors: 1, maxFrameBytes: 65536,
};

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

interface ControlCall {
  readonly method: string;
  readonly path: string;
  readonly configuration: http.RequestOptions;
  readonly body: Record<string, unknown> | undefined;
  respond(status: number, value?: unknown): void;
  upgrade(head?: Buffer): void;
  timeout(): void;
}

function multiplex(payload: Buffer, channel = 1): Buffer {
  const header = Buffer.alloc(8);
  header[0] = channel;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function frame(value: unknown): Buffer {
  return multiplex(Buffer.from(JSON.stringify(value) + '\n'));
}

function fixture(context: TestContext, controls: {
  volumes?: Record<string, object>;
  onCall?: (call: ControlCall) => boolean | void;
} = {}) {
  const calls: ControlCall[] = [];
  const input: Buffer[] = [];
  const startWritten = deferred();
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      input.push(Buffer.from(chunk));
      if (chunk.toString().includes('"type":"start"')) startWritten.resolve();
      callback();
    },
  });
  context.mock.method(http, 'request', (configuration: http.RequestOptions, callback?: (response: http.IncomingMessage) => void) => {
    const request = new EventEmitter() as http.ClientRequest;
    let timeout: (() => void) | undefined;
    request.setTimeout = (_milliseconds, listener) => { timeout = listener; return request; };
    request.destroy = (error?: Error) => {
      if (error) queueMicrotask(() => request.emit('error', error));
      return request;
    };
    request.end = ((body?: string) => {
      const call: ControlCall = {
        method: configuration.method!, path: configuration.path!, configuration,
        body: body ? JSON.parse(body) as Record<string, unknown> : undefined,
        respond(status, value) {
          const response = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]) as http.IncomingMessage;
          response.statusCode = status;
          if (callback) callback(response);
          else request.emit('response', response);
        },
        upgrade(head = Buffer.alloc(0)) { request.emit('upgrade', {}, socket, head); },
        timeout() { assert.ok(timeout); timeout(); },
      };
      calls.push(call);
      queueMicrotask(() => {
        if (controls.onCall?.(call)) return;
        if (call.path.endsWith('/info')) call.respond(200, {
          OSType: 'linux', MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: ['name=seccomp,profile=builtin'],
        });
        else if (call.path.includes('/images/')) call.respond(200, {
          Id: image, Config: { Labels: { 'org.poe-platform.python-executor': '1' }, Volumes: controls.volumes },
        });
        else if (call.path.includes('/create?')) call.respond(201, { Id: 'review-container' });
        else if (call.path.includes('/attach?')) call.upgrade();
        else if (call.path.endsWith('/start') || call.method === 'DELETE') call.respond(204);
        else call.respond(404);
      });
      return request;
    }) as http.ClientRequest['end'];
    return request;
  });
  return { calls, input, socket, startWritten, send(value: unknown) { socket.push(frame(value)); } };
}

function start(signal = new AbortController().signal): PythonExecutorStart {
  return {
    signal, invocation: { args: ['-c', 'pass'], cwd: '/', env: {} },
    runtimeMount: '/runtime', maxTransferBytes: 1024,
    async dispatch() { return 0; }, onReady() {},
  };
}

test('review: image-declared volumes are refused before any container allocation', async context => {
  const engine = fixture(context, { volumes: { '/image-volume': {} } });
  await assert.rejects(createDockerPythonExecutorPool(options), /isolation.*unavailable/i);
  assert.equal(engine.calls.length, 2);
  assert.equal(engine.calls.some(call => call.path.includes('/containers/')), false);
});

test('review: invocation environment travels only in protocol and control requests use the explicit socket', async context => {
  const engine = fixture(context);
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const invocation = { ...start().invocation, env: { REVIEW_GUEST_ONLY: 'synthetic-value' } };
  const execution = endpoint.run({ ...start(), invocation });
  try {
    await engine.startWritten.promise;
    const created = engine.calls.find(call => call.path.includes('/create?'))!.body!;
    assert.deepEqual(created.Env, []);
    assert.equal(JSON.stringify(created).includes('REVIEW_GUEST_ONLY'), false);
    const host = created.HostConfig as Record<string, unknown>;
    for (const name of ['Binds', 'Mounts', 'VolumesFrom', 'Devices', 'DeviceRequests', 'ExtraHosts']) assert.equal(host[name], undefined);
    assert.equal(created.Volumes, undefined);
    for (const call of engine.calls) {
      assert.equal(call.configuration.socketPath, options.socketPath);
      assert.equal(call.configuration.host, undefined);
      assert.equal(call.configuration.auth, undefined);
    }
    assert.deepEqual(JSON.parse(Buffer.concat(engine.input).toString()).invocation, invocation);
    engine.send({ type: 'exit', exitCode: 0 });
    assert.equal(await execution, 0);
  } finally { await endpoint.terminate(); await pool.dispose(); }
});

for (const stage of ['create', 'attach'] as const) {
  test(`review: abort during ${stage} keeps admission until the late allocation is removed`, async context => {
    const held = deferred<ControlCall>();
    const engine = fixture(context, { onCall(call) {
      if (call.path.includes(`/${stage}?`)) { held.resolve(call); return true; }
    } });
    const pool = await createDockerPythonExecutorPool(options);
    const endpoint = pool.createExecutor();
    const abort = new AbortController();
    const result = Promise.allSettled([endpoint.run(start(abort.signal))]);
    const call = await held.promise;
    abort.abort(false);
    assert.deepEqual(await result, [{ status: 'rejected', reason: false }]);
    const retirement = endpoint.terminate();
    let settled = false;
    void Promise.resolve(retirement).then(() => { settled = true; });
    try {
      await nextTurn();
      assert.equal(settled, false);
      assert.throws(() => pool.createExecutor(), /capacity exhausted/);
    } finally {
      if (stage === 'create') call.respond(201, { Id: 'late-container' });
      else call.upgrade();
      await retirement;
      await pool.dispose();
    }
    assert.equal(engine.calls.some(control => control.path.endsWith('/start')), false);
    assert.equal(engine.calls.filter(control => control.method === 'DELETE').length, 1);
    assert.equal(pool.inspect().active, 0);
    if (stage === 'attach') assert.equal(engine.socket.destroyed, true);
  });
}

test('review: deadline removes the container but retains admission until asynchronous dispatch drains', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = fixture(context);
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const entered = deferred();
  const release = deferred();
  const result = Promise.allSettled([endpoint.run({ ...start(), async dispatch() {
    entered.resolve(); await release.promise; return 0;
  } })]);
  try {
    await engine.startWritten.promise;
    engine.send({ type: 'request', id: 1, op: 'write', args: [] });
    await entered.promise;
    context.mock.timers.tick(options.deadlineMs);
    const outcome = (await result)[0]!;
    assert.equal(outcome.status, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.reason.category, 'deadline');
    const retirement = endpoint.terminate();
    await nextTurn();
    assert.equal(engine.calls.filter(call => call.method === 'DELETE').length, 1);
    assert.equal(pool.inspect().active, 1);
    assert.throws(() => pool.createExecutor(), /capacity exhausted/);
    release.resolve();
    await retirement;
    assert.equal(pool.inspect().active, 0);
  } finally { release.resolve(); await endpoint.terminate(); await result; await pool.dispose(); }
});

test('review: failed removal remains observable and permanently retains uncertain capacity', async context => {
  const engine = fixture(context, { onCall(call) {
    if (call.method === 'DELETE') { call.respond(500, { message: 'synthetic-private-daemon-error' }); return true; }
  } });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const result = Promise.allSettled([endpoint.run(start())]);
  await engine.startWritten.promise;
  engine.send({ type: 'exit', exitCode: 0 });
  await result;
  await assert.rejects(Promise.resolve(endpoint.terminate()), /cleanup failed/);
  assert.equal(pool.inspect().active, 1);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  await assert.rejects(pool.dispose(), /cleanup failed/);
  assert.equal(engine.calls.filter(call => call.method === 'DELETE').length, 1);
});

test('review: timed-out creation keeps capacity uncertain even after removal by unique name succeeds', async context => {
  const engine = fixture(context, { onCall(call) {
    if (call.path.includes('/create?')) { call.timeout(); return true; }
  } });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  await assert.rejects(endpoint.run(start()), error => (error as { category?: string }).category === 'startup');
  await assert.rejects(Promise.resolve(endpoint.terminate()), /cleanup failed/);
  const allocation = engine.calls.find(call => call.path.includes('/create?'))!;
  const name = new URL(allocation.path, 'http://test.invalid').searchParams.get('name');
  assert.ok(name);
  assert.equal(engine.calls.find(call => call.method === 'DELETE')!.path, `/v1.45/containers/${name}?force=1&v=1`);
  assert.equal(pool.inspect().active, 1);
  assert.throws(() => pool.createExecutor(), /capacity exhausted/);
  await assert.rejects(pool.dispose(), /cleanup failed/);
});

test('review: a queued request cannot dispatch after a coalesced protocol failure', async context => {
  const engine = fixture(context);
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  let dispatches = 0;
  const result = Promise.allSettled([endpoint.run({ ...start(), async dispatch() { dispatches++; } })]);
  try {
    await engine.startWritten.promise;
    engine.socket.push(Buffer.concat([
      frame({ type: 'request', id: 1, op: 'write', args: [] }),
      frame({ type: 'request', id: 2, op: 'write', args: [] }),
    ]));
    const outcome = (await result)[0]!;
    assert.equal(outcome.status, 'rejected');
    await nextTurn();
    assert.equal(dispatches, 0);
  } finally { await endpoint.terminate(); await pool.dispose(); }
});

test('review: attach-head requests cannot produce host effects before a failed start control response', async context => {
  const engine = fixture(context, { onCall(call) {
    if (call.path.includes('/attach?')) {
      call.upgrade(frame({ type: 'request', id: 1, op: 'write', args: [] }));
      return true;
    }
    if (call.path.endsWith('/start')) { call.respond(500); return true; }
  } });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  let dispatches = 0;
  try {
    await assert.rejects(endpoint.run({ ...start(), async dispatch() { dispatches++; return 0; } }));
    assert.equal(dispatches, 0, 'unstarted guest traffic must not acquire canonical filesystem effects');
  } finally { await endpoint.terminate(); await pool.dispose(); }
  assert.equal(engine.calls.filter(call => call.method === 'DELETE').length, 1);
});

test('review: abrupt attach socket close settles execution without waiting for its wall deadline', async context => {
  const engine = fixture(context);
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const result = Promise.allSettled([endpoint.run(start())]);
  let settled = false;
  void result.then(() => { settled = true; });
  try {
    await engine.startWritten.promise;
    engine.socket.destroy();
    await nextTurn();
    assert.equal(settled, true, 'close without end/error must not strand an admitted invocation');
    const outcome = (await result)[0]!;
    assert.equal(outcome.status, 'rejected');
  } finally { await endpoint.terminate(); await result; await pool.dispose(); }
});

const malformedFrames: readonly [string, () => Buffer][] = [
  ['invalid channel', () => multiplex(Buffer.from('{}\n'), 3)],
  ['reserved header bits', () => { const bytes = frame({ type: 'ready' }); bytes[2] = 1; return bytes; }],
  ['oversized declared payload', () => { const bytes = Buffer.alloc(8); bytes[0] = 1; bytes.writeUInt32BE(options.maxFrameBytes + 1, 4); return bytes; }],
  ['invalid UTF-8', () => multiplex(Buffer.from([0xff, 10]))],
  ['invalid JSON', () => multiplex(Buffer.from('{broken}\n'))],
  ['fragmented oversized line', () => Buffer.concat([multiplex(Buffer.alloc(options.maxFrameBytes, 32)), multiplex(Buffer.from(' \n'))])],
  ['cumulative stderr overflow', () => Buffer.concat([multiplex(Buffer.alloc(options.maxFrameBytes), 2), multiplex(Buffer.from('x'), 2)])],
];

for (const [name, bytes] of malformedFrames) {
  test(`review: malformed multiplex input refuses ${name} without dispatch`, async context => {
    const engine = fixture(context);
    const pool = await createDockerPythonExecutorPool(options);
    const endpoint = pool.createExecutor();
    let dispatches = 0;
    const result = Promise.allSettled([endpoint.run({ ...start(), async dispatch() { dispatches++; } })]);
    try {
      await engine.startWritten.promise;
      engine.socket.push(bytes());
      const outcome = (await result)[0]!;
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') assert.equal(outcome.reason.category, 'transport-unavailable');
      assert.equal(dispatches, 0);
    } finally { await endpoint.terminate(); await pool.dispose(); }
    assert.equal(pool.inspect().active, 0);
  });
}

test('review: oversized dispatch reply fails bounded transport without publishing a partial reply', async context => {
  const engine = fixture(context);
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const result = Promise.allSettled([endpoint.run({ ...start(), async dispatch() { return 'x'.repeat(options.maxFrameBytes); } })]);
  try {
    await engine.startWritten.promise;
    const writes = engine.input.length;
    engine.send({ type: 'request', id: 1, op: 'read', args: [] });
    const outcome = (await result)[0]!;
    assert.equal(outcome.status, 'rejected');
    if (outcome.status === 'rejected') assert.equal(outcome.reason.category, 'transport-unavailable');
    assert.equal(engine.input.length, writes);
  } finally { await endpoint.terminate(); await pool.dispose(); }
});

test('review: isolated runner rejects malformed startup bytes without importing a runtime', async context => {
  const output: Buffer[] = [];
  const malformed = Buffer.from([0xff, 10]);
  context.mock.getter(process, 'stdin', () => Readable.from([malformed]));
  context.mock.getter(process, 'stdout', () => new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); } }));
  await runDockerPythonExecutor({ isolatedContainer: true, runtimeModuleURL: 'file:///not-accessed/review-runtime.mjs' });
  assert.deepEqual(JSON.parse(Buffer.concat(output).toString()), { type: 'error', category: 'transport-unavailable' });
});
