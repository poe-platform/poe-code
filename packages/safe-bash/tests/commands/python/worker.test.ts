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
  assert.deepEqual(messages, [{ type: 'error', category: 'runtime-abi', message: 'Error: Python native syscall isolation ABI unavailable' }]);
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
    assert.deepEqual(messages, [{ type: 'error', category: 'runtime-assets', message: 'Error: loader rejected' }]);
  }
});

test('unavailable worker shared-memory operations are classified as transport failures', async () => {
  const messages: unknown[] = [];
  await runPythonWorker({
    start: { shared: new SharedArrayBuffer(4), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
    async loadRuntime() { throw new Error('must not load'); },
    postMessage(message) { messages.push(message); },
  });
  assert.equal((messages[0] as { category: string }).category, 'transport-unavailable');
});

test('worker transport preserves postMessage failure details without mistaking backend errno', () => {
  const failure = new Error('private transport configuration');
  const request = createPythonWorkerRequest(new SharedArrayBuffer(1024), () => { throw failure; }, code => new Error(code));
  assert.throws(() => request('stat', '/'), error => {
    assert.equal((error as { category: string }).category, 'transport-unavailable');
    assert.equal((error as Error).cause, failure);
    return true;
  });
});

test('worker RPC classifies an unavailable Atomics.wait and retains its cause', () => {
  const wait = Atomics.wait;
  const failure = new TypeError('Atomics.wait cannot be called in this context');
  const messages: unknown[] = [];
  let waits = 0;
  Atomics.wait = () => { waits++; throw failure; };
  try {
    const request = createPythonWorkerRequest(new SharedArrayBuffer(1024), message => messages.push(message), code => new Error(code));
    assert.throws(() => request('stat', '/'), error => {
      assert.equal((error as { category: string }).category, 'transport-unavailable');
      assert.equal((error as Error).cause, failure);
      return true;
    });
    assert.equal(waits, 1);
    assert.deepEqual(messages, [{ op: 'stat', args: ['/'] }]);
  } finally { Atomics.wait = wait; }
});

for (const stream of ['stdout', 'stderr'] as const) {
  test(`startup ${stream} classifies a missing Atomics.wait as transport, not runtime assets`, async () => {
    const wait = Atomics.wait;
    const instantiate = wasm.instantiate;
    const messages: unknown[] = [];
    Atomics.wait = undefined as never;
    try {
      await runPythonWorker({
        start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
        async loadRuntime(configuration) {
          configuration[stream]('loading');
          throw new Error('startup output must fail first');
        },
        postMessage(message) { messages.push(message); },
      });
      assert.equal(wasm.instantiate, instantiate);
      assert.equal(messages.length, 2);
      assert.deepEqual(messages[0], { op: stream, args: [Array.from(new TextEncoder().encode('loading\n'))] });
      const diagnostic = messages[1] as { type: string; category: string; message: string };
      assert.equal(diagnostic.type, 'error');
      assert.equal(diagnostic.category, 'transport-unavailable');
      assert.match(diagnostic.message, /^TypeError: .*Atomics.wait/);
    } finally { Atomics.wait = wait; }
  });
}

for (const version of ['0.27.7', '314.0.5']) {
  test(`runtime version ${version} is classified as ABI failure after native hooks succeed`, async () => {
    const instantiate = wasm.instantiate;
    const messages: unknown[] = [];
    const imports = { env: { _emscripten_system: () => 1, __syscall_socket: () => 1 } };
    const mockedInstantiate = (async () => ({})) as typeof wasm.instantiate;
    wasm.instantiate = mockedInstantiate;
    try {
      await runPythonWorker({
        start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
        async loadRuntime() {
          await wasm.instantiate(new Uint8Array(), imports);
          return { version } as never;
        },
        postMessage(message) { messages.push(message); },
      });
      assert.equal(imports.env._emscripten_system(), -52);
      assert.equal(imports.env.__syscall_socket(), -52);
      assert.equal(wasm.instantiate, mockedInstantiate);
      assert.deepEqual(messages, [{ type: 'error', category: 'runtime-abi', message: 'Error: Python worker requires Pyodide 314.0.6' }]);
    } finally { wasm.instantiate = instantiate; }
  });
}

for (const missing of ['_emscripten_system', '__syscall_socket']) {
  test(`runtime missing only ${missing} is classified as ABI failure`, async () => {
    const instantiate = wasm.instantiate;
    const messages: unknown[] = [];
    const imports: WasmImports = { env: { _emscripten_system: () => 0, __syscall_socket: () => 0 } };
    delete imports.env![missing];
    const mockedInstantiate = (async () => ({})) as typeof wasm.instantiate;
    wasm.instantiate = mockedInstantiate;
    try {
      await runPythonWorker({
        start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
        async loadRuntime() {
          await wasm.instantiate(new Uint8Array(), imports);
          return { version: '314.0.6' } as never;
        },
        postMessage(message) { messages.push(message); },
      });
      assert.equal(wasm.instantiate, mockedInstantiate);
      assert.deepEqual(messages, [{ type: 'error', category: 'runtime-abi', message: 'Error: Python native syscall isolation ABI unavailable' }]);
    } finally { wasm.instantiate = instantiate; }
  });
}

for (const missing of ['native loader', 'finalization']) {
  test(`pinned runtime missing ${missing} ABI is not classified as an asset failure`, async () => {
    const instantiate = wasm.instantiate;
    const messages: unknown[] = [];
    const mockedInstantiate = (async () => ({})) as typeof wasm.instantiate;
    wasm.instantiate = mockedInstantiate;
    try {
      await runPythonWorker({
        start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
        async loadRuntime() {
          await wasm.instantiate(new Uint8Array(), { env: { _emscripten_system: () => 0, __syscall_socket: () => 0 } });
          return {
            version: '314.0.6',
            _module: missing === 'native loader' ? {} : { LDSO: { loadedLibsByName: {} } },
            runPython() { return JSON.stringify({ EIO: 5 }); },
          } as never;
        },
        postMessage(message) { messages.push(message); },
      });
      assert.equal(wasm.instantiate, mockedInstantiate);
      assert.deepEqual(messages, [{ type: 'error', category: 'runtime-abi', message: `Error: Python runtime ${missing} ABI unavailable` }]);
    } finally { wasm.instantiate = instantiate; }
  });
}

test('runtime asset rejection after intercepted Wasm imports preserves the loader diagnostic', async () => {
  const instantiate = wasm.instantiate;
  const messages: unknown[] = [];
  const failure = new Error('private runtime.wasm asset failed after native ABI imports');
  const mockedInstantiate = (async () => ({})) as typeof wasm.instantiate;
  wasm.instantiate = mockedInstantiate;
  try {
    await runPythonWorker({
      start: { shared: new SharedArrayBuffer(1024), invocation: { args: ['-c', 'pass'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
      async loadRuntime() {
        await wasm.instantiate(new Uint8Array(), { env: { _emscripten_system: () => 0, __syscall_socket: () => 0 } });
        throw failure;
      },
      postMessage(message) { messages.push(message); },
    });
    assert.equal(wasm.instantiate, mockedInstantiate);
    assert.deepEqual(messages, [{ type: 'error', category: 'runtime-assets', message: String(failure) }]);
  } finally { wasm.instantiate = instantiate; }
});

test('worker exit notification failure is classified as transport rather than startup', async () => {
  const shared = new SharedArrayBuffer(1024);
  const control = new Int32Array(shared, 0, 2);
  const payload = new Uint8Array(shared, 8);
  const failure = new Error('private exit transport failure');
  const messages: unknown[] = [];
  let loads = 0;
  await runPythonWorker({
    start: { shared, invocation: { args: ['-c'], cwd: '/', env: {} }, runtimeMount: '/.pyodide-runtime', maxTransferBytes: 64 },
    async loadRuntime() { loads++; throw new Error('invalid invocation must not load'); },
    postMessage(message) {
      const reply = message as { op?: string; type?: string };
      if (reply.op) {
        assert.equal(reply.op, 'stderr');
        payload.set(new TextEncoder().encode('null'));
        Atomics.store(control, 1, 4);
        Atomics.store(control, 0, 1);
        return;
      }
      messages.push(message);
      if (reply.type === 'exit') throw failure;
    },
  });
  assert.equal(loads, 0);
  assert.deepEqual(messages, [
    { type: 'exit', exitCode: 2 },
    { type: 'error', category: 'transport-unavailable', message: String(failure) },
  ]);
});
