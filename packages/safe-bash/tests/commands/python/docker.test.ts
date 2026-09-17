import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Duplex, Readable } from 'node:stream';
import { createDockerPythonExecutorPool } from '../../../src/commands/python/docker.js';
import type { PythonExecutorStart } from '../../../src/commands/python/index.js';

const image = 'sha256:' + 'a'.repeat(64);
const options = { socketPath: '/explicit/docker.sock', image, memoryBytes: 268435456,
  cpus: 0.5, deadlineMs: 10000, maxConcurrentExecutors: 1 };

function fixture(context: { mock: { method: (...args: any[]) => unknown } }, controls: { supported?: boolean; securityOptions?: string[]; onStart?: () => void } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  const input: string[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { input.push(chunk.toString()); callback(); } });
  const send = (message: unknown) => {
    const payload = Buffer.from(JSON.stringify(message) + '\n');
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(payload.length, 4);
    socket.push(Buffer.concat([header, payload]));
  };
  context.mock.method(http, 'request', (configuration: any, callback?: (response: any) => void) => {
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.destroy = (error?: Error) => { if (error) queueMicrotask(() => request.emit('error', error)); };
    request.end = (body?: string) => {
      calls.push({ method: configuration.method, path: configuration.path, body: body ? JSON.parse(body) : undefined });
      queueMicrotask(() => {
        if (configuration.path.includes('/attach?')) { request.emit('upgrade', {}, socket, Buffer.alloc(0)); return; }
        let statusCode = 200;
        let value: unknown;
        if (configuration.path.endsWith('/info')) value = { OSType: 'linux', MemoryLimit: controls.supported !== false, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, SecurityOptions: controls.securityOptions ?? ['name=seccomp,profile=builtin'] };
        else if (configuration.path.startsWith('/v1.45/images/')) value = { Id: image, Config: { Labels: { 'org.poe-platform.python-executor': '1' } } };
        else if (configuration.path.startsWith('/v1.45/containers/create')) { statusCode = 201; value = { Id: 'owned-container' }; }
        else if (configuration.path.endsWith('/start')) { statusCode = 204; setImmediate(() => controls.onStart?.()); }
        else if (configuration.method === 'DELETE') { statusCode = 204; socket.push(null); }
        else { statusCode = 404; value = {}; }
        const response = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]) as any;
        response.statusCode = statusCode;
        callback?.(response);
      });
    };
    return request;
  });
  return { calls, input, send, socket };
}

function start(signal = new AbortController().signal): PythonExecutorStart {
  return { signal, invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/runtime',
    maxTransferBytes: 65536, async dispatch() { return 0; }, onReady() {} };
}

test('Docker isolation refuses missing host resource enforcement', async context => {
  const engine = fixture(context, { supported: false });
  await assert.rejects(createDockerPythonExecutorPool(options), /isolation.*unavailable/i);
  assert.equal(engine.calls.length, 1);
});

test('Docker isolation refuses hosts without the built-in seccomp profile', async context => {
  const engine = fixture(context, { securityOptions: ['name=apparmor', 'name=seccomp,profile=unconfined'] });
  await assert.rejects(createDockerPythonExecutorPool(options), /isolation.*unavailable/i);
  assert.equal(engine.calls.length, 1);
});

test('Docker isolation rejects mutable images and invalid bounds before contacting the daemon', async context => {
  const engine = fixture(context);
  for (const invalid of [{ image: 'node:latest' }, { memoryBytes: 0 }, { cpus: 0 }, { deadlineMs: 0 }, { socketPath: 'relative.sock' }]) {
    await assert.rejects(createDockerPythonExecutorPool({ ...options, ...invalid }));
  }
  assert.equal(engine.calls.length, 0);
});

test('Docker execution owns a confined container and removes it before releasing admission', async context => {
  let ready = 0;
  const engine = fixture(context, { onStart() { engine.send({ type: 'ready' }); engine.send({ type: 'exit', exitCode: 0 }); } });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  try {
    assert.equal(await endpoint.run({ ...start(), onReady() { ready++; } }), 0);
    assert.equal(ready, 1);
    assert.equal(pool.inspect().active, 1);
    const created = engine.calls.find(call => call.path.startsWith('/v1.45/containers/create'))!.body;
    assert.equal(created.Image, image);
    assert.equal(created.User, '65534:65534');
    assert.deepEqual(created.Env, []);
    assert.equal(created.HostConfig.NetworkMode, 'none');
    assert.equal(created.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(created.HostConfig.CapDrop, ['ALL']);
    assert.deepEqual(created.HostConfig.SecurityOpt, ['no-new-privileges']);
    assert.equal(created.HostConfig.Memory, options.memoryBytes);
    assert.equal(created.HostConfig.MemorySwap, options.memoryBytes);
    assert.equal(created.HostConfig.NanoCpus, options.cpus * 1e9);
    assert.ok(created.HostConfig.PidsLimit > 0);
    assert.equal(created.HostConfig.Binds, undefined);
    assert.equal(created.HostConfig.Mounts, undefined);
    await endpoint.terminate();
    assert.ok(engine.calls.some(call => call.method === 'DELETE' && call.path.includes('owned-container')));
    assert.equal(pool.inspect().active, 0);
  } finally { await pool.dispose(); }
});

test('Docker guest protocol dispatches bounded canonical operations without provider credentials', async context => {
  const engine = fixture(context, { onStart() { engine.send({ type: 'request', id: 1, op: 'stdout', args: [[0, 255, 42]] }); } });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  let dispatches = 0;
  try {
    const running = endpoint.run({ ...start(), async dispatch(request) {
      dispatches++;
      assert.deepEqual(request, { op: 'stdout', args: [[0, 255, 42]] });
      setImmediate(() => engine.send({ type: 'exit', exitCode: 0 }));
      return 3;
    } });
    assert.equal(await running, 0);
    assert.equal(dispatches, 1);
    assert.ok(engine.input.some(text => text.includes('"value":3')));
  } finally { await endpoint.terminate(); await pool.dispose(); }
});

test('Docker retirement closes a backpressured startup socket before awaiting initialization', async context => {
  const engine = fixture(context);
  let written!: () => void;
  const entered = new Promise<void>(resolve => { written = resolve; });
  let finishWrite!: (error?: Error | null) => void;
  context.mock.method(engine.socket, 'write', (_chunk: any, callback: any) => {
    finishWrite = callback;
    written();
    return false;
  });
  const pool = await createDockerPythonExecutorPool(options);
  const endpoint = pool.createExecutor();
  const controller = new AbortController();
  const running = Promise.allSettled([endpoint.run(start(controller.signal))]);
  await entered;
  controller.abort('cancelled');
  const retirement = endpoint.terminate();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(engine.socket.destroyed, true);
  } finally {
    finishWrite(new Error('startup socket closed'));
    await running; await retirement; await pool.dispose();
  }
});

for (const [code, expected] of [['EACCES', 'EACCES'], ['HOST_SECRET_CODE', 'EIO']]) {
  test(`Docker protocol exposes only known error codes for ${expected}`, async context => {
    const engine = fixture(context, { onStart() { engine.send({ type: 'request', id: 1, op: 'open', args: ['/input', { access: 'read' }] }); } });
    const pool = await createDockerPythonExecutorPool(options);
    const endpoint = pool.createExecutor();
    try {
      await endpoint.run({ ...start(), async dispatch() {
        setImmediate(() => engine.send({ type: 'exit', exitCode: 0 }));
        throw Object.assign(new Error('HOST_SECRET_MESSAGE'), { code });
      } });
      const replies = engine.input.flatMap(text => text.trim().split('\n').map(line => JSON.parse(line)));
      assert.deepEqual(replies.find(reply => reply.id === 1)?.value, { code: expected });
      assert.ok(!engine.input.join('').includes('HOST_SECRET'));
    } finally { await endpoint.terminate(); await pool.dispose(); }
  });
}
