import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createNodePythonWorker } from '../../../src/commands/python/node.js';
import { runPythonWorker, createPythonWorkerRequest } from '../../../src/commands/python/worker.js';

test('worker RPC owns shared replies and propagates backend errno', () => {
  const shared = new SharedArrayBuffer(1024);
  const control = new Int32Array(shared, 0, 2);
  const payload = new Uint8Array(shared, 8);
  let failure = false;
  const request = createPythonWorkerRequest(shared, message => {
    assert.deepEqual(message, { op: 'stat', args: ['/work'] });
    const bytes = new TextEncoder().encode(JSON.stringify(failure ? {code:'ENOENT'} : {size: 3}));
    payload.set(bytes); Atomics.store(control,1,bytes.length); Atomics.store(control,0,failure ? 2 : 1);
  }, code => Object.assign(new Error(code), {code}));
  assert.deepEqual(request('stat','/work'), {size:3});
  failure = true;
  assert.throws(() => request('stat','/work'), {code:'ENOENT'});
});

test('worker RPC rejects invalid response lengths', () => {
  const shared = new SharedArrayBuffer(16);
  const control = new Int32Array(shared, 0, 2);
  const request = createPythonWorkerRequest(shared, () => {
    Atomics.store(control,1,100); Atomics.store(control,0,1);
  }, code => new Error(code));
  assert.throws(() => request('stat','/'), /EIO/);
});

test('package RPC preserves installer diagnostics separately from filesystem errno', () => {
  const shared = new SharedArrayBuffer(1024);
  const control = new Int32Array(shared, 0, 2);
  const payload = new Uint8Array(shared, 8);
  const request = createPythonWorkerRequest(shared, () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ code: 'EPACKAGE', message: 'Package transport denied https://example.test/pkg.whl' }));
    payload.set(bytes); Atomics.store(control, 1, bytes.length); Atomics.store(control, 0, 2);
  }, code => new Error(code));
  assert.throws(() => request('package-open', 'pkg'), /Package transport denied/);
});


test('runtime initialization receives no ambient JavaScript globals', async () => {
  let globals: unknown;
  await runPythonWorker({
    start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
    async loadRuntime(configuration) { globals = configuration.jsglobals; throw new Error('stop after configuration'); },
    postMessage() {},
  });
  assert.ok(globals);
  assert.equal(Object.getPrototypeOf(globals), null);
  assert.deepEqual(Object.keys(globals), []);
});


test('Node worker rejects missing trust acknowledgement before loading a runtime', () => {
  assert.throws(() => createNodePythonWorker({runtimeModuleURL: 'not a URL'} as never), /trustedPython/);
});

type WasmImports = { env?: Record<string, unknown> };
const wasm = (globalThis as unknown as { WebAssembly: { instantiate(source: unknown, imports?: WasmImports): Promise<unknown> } }).WebAssembly;

test('runtime initialization intercepts native process and socket imports before Wasm instantiation', async () => {
  const original = wasm.instantiate;
  let observed: WasmImports | undefined;
  wasm.instantiate = (async (_source: unknown, imports?: WasmImports) => { observed = imports; return {}; }) as typeof wasm.instantiate;
  const ambient = () => { throw new Error('ambient host syscall'); };
  const imports = { env: { _emscripten_system: ambient, __syscall_socket: ambient, __syscall_connect: ambient } };
  try {
    await runPythonWorker({
      start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
      async loadRuntime() { await wasm.instantiate(new Uint8Array(), imports); throw new Error('stop after instantiation'); },
      postMessage() {},
    });
    assert.equal((observed!.env!._emscripten_system as (command: number) => number)(1), -52);
    assert.equal((observed!.env!._emscripten_system as (command: number) => number)(0), 0);
    assert.equal((observed!.env!.__syscall_socket as () => number)(), -52);
    assert.equal((observed!.env!.__syscall_connect as () => number)(), -52);
  } finally { wasm.instantiate = original; }
});

test('runtime refuses direct host helper and syscall aliases after initialization', async () => {
  const instantiate = wasm.instantiate;
  wasm.instantiate = (async () => ({})) as typeof wasm.instantiate;
  let called = false;
  const host = () => { called = true; return 73 << 8; };
  const runtime = {
    version: 'unqualified', FS: { filesystems: { NODEFS: {} } },
    _module: { NODEFS: {}, __emscripten_system: host, SOCKFS: { createSocket: host } },
    mountNodeFS: host, mountNativeFS: host, useNodeSockFS: host,
  };
  try {
    await runPythonWorker({
      start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
      async loadRuntime() {
        await wasm.instantiate(new Uint8Array(), {env: {_emscripten_system: host, __syscall_socket: host}});
        return runtime as never;
      },
      postMessage() {},
    });
    assert.equal(runtime._module.__emscripten_system(), -52);
    assert.throws(() => runtime._module.SOCKFS.createSocket(), /unavailable/);
    assert.throws(() => runtime.mountNodeFS(), /unavailable/);
    assert.throws(() => runtime.mountNativeFS(), /unavailable/);
    assert.throws(() => runtime.useNodeSockFS(), /unavailable/);
    assert.equal('NODEFS' in runtime.FS.filesystems, false);
    assert.equal('NODEFS' in runtime._module, false);
    assert.equal(called, false);
  } finally { wasm.instantiate = instantiate; }
});

test('startup stdout and stderr preserve Unicode bytes across bounded acknowledged transfers', async () => {
  const shared = new SharedArrayBuffer(128);
  const control = new Int32Array(shared, 0, 2);
  const payload = new Uint8Array(shared, 8);
  const output: Record<string, number[]> = { stdout: [], stderr: [] };
  const messages = ['café 🐍', '错误'];
  await runPythonWorker({
    start: { shared, invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 3 },
    async loadRuntime(configuration) {
      configuration.stdout(messages[0]!);
      configuration.stderr(messages[1]!);
      throw new Error('initialization failed after diagnostics');
    },
    postMessage(message) {
      const request = message as { op?: string; args?: number[][] };
      if (!request.op) return;
      assert.ok(request.op === 'stdout' || request.op === 'stderr');
      const chunk = request.args![0]!;
      assert.ok(chunk.length > 0 && chunk.length <= 3);
      output[request.op]!.push(...chunk);
      // Each callback waits for this acknowledgement before issuing another chunk.
      payload.set(new TextEncoder().encode('null'));
      Atomics.store(control, 1, 4);
      Atomics.store(control, 0, 1);
    },
  });
  assert.deepEqual(output.stdout, Array.from(new TextEncoder().encode(messages[0] + '\n')));
  assert.deepEqual(output.stderr, Array.from(new TextEncoder().encode(messages[1] + '\n')));
});

test('initialization without native isolation hooks fails closed and restores the Wasm loader', async () => {
  const instantiate = wasm.instantiate;
  const messages: unknown[] = [];
  await runPythonWorker({
    start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
    async loadRuntime() { return { version: '314.0.6' } as never; },
    postMessage(message) { messages.push(message); },
  });
  assert.equal(wasm.instantiate, instantiate);
  assert.deepEqual(messages, [{ type: 'error', message: 'Error: Python native syscall isolation ABI unavailable' }]);
});

test('rejected initialization restores the Wasm loader before another invocation', async () => {
  const instantiate = wasm.instantiate;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: unknown[] = [];
    await runPythonWorker({
      start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
      async loadRuntime() { throw new Error('loader rejected'); },
      postMessage(message) { messages.push(message); },
    });
    assert.equal(wasm.instantiate, instantiate);
    assert.deepEqual(messages, [{ type: 'error', message: 'Error: loader rejected' }]);
  }
});
