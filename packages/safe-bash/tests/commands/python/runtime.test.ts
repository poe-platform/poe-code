import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell, CommandRegistry } from '../../../src/core.js';
import { streamCommands } from '../../../src/commands/streams.js';
import { basicCommands } from '../../../src/commands/basic.js';
import { pythonCommands, type PythonWorkerEndpoint } from '../../../src/commands/python/index.js';

function worker(run: (message: any, send: (value: unknown) => void) => void) {
  let send!: (value: unknown) => void;
  let terminated = 0;
  const endpoint: PythonWorkerEndpoint = {
    subscribe(listener) { send = listener; return () => {}; },
    postMessage(message) { run(message, send); },
    async terminate() { terminated++; },
  };
  return { endpoint, terminated: () => terminated };
}

test('python and python3 pass literal invocation and retire workers', async () => {
  const requests: any[] = [];
  const instance = worker((message, send) => { requests.push(message); queueMicrotask(() => send({ type: 'exit', exitCode: 7 })); });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  for (const name of ['python', 'python3']) {
    const result = await shell.exec(`${name} -c 'print("café")' 'two words'`);
    assert.equal(result.exitCode, 7);
  }
  assert.deepEqual(requests[0].invocation.args, ['-c', 'print("café")', 'two words']);
  assert.deepEqual(requests.map(request => request.invocation.command), ['python', 'python3']);
  assert.equal(instance.terminated(), 2);
});

test('worker failure retires the invocation', async () => {
  const instance = worker((_message, send) => queueMicrotask(() => send({ type: 'error', message: 'runtime failed' })));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass');
  assert.notEqual(result.exitCode, 0);
  assert.equal(instance.terminated(), 1);
});

test('pre-aborted execution never creates an interpreter', async () => {
  let created = 0;
  const controller = new AbortController();
  controller.abort(false);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker() { created++; throw new Error('unexpected'); } }));
  await assert.rejects(shell.exec('python -c pass', { signal: controller.signal }), reason => Object.is(reason, controller.signal.reason));
  assert.equal(created, 0);
});

test('pipe writes are acknowledged only after awaited shell output', async () => {
  let observed: SharedArrayBuffer | undefined;
  const instance = worker((message, send) => {
    observed = message.shared;
    send({ op: 'stdout', args: [[65, 0, 255, 10]] });
    const observe = () => {
      if (Atomics.load(new Int32Array(message.shared, 0, 2), 0) === 0) { setTimeout(observe, 1); return; }
      send({ type: 'exit', exitCode: 0 });
    };
    observe();
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass');
  assert.equal(result.exitCode, 0);
  assert.ok(observed);
  assert.deepEqual(Array.from(result.stdoutBytes), [65, 0, 255, 10]);
});

test('termination wakes a command waiting for the interpreter', async () => {
  const controller = new AbortController();
  const instance = worker(() => queueMicrotask(() => controller.abort('stop Python')));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  await assert.rejects(shell.exec('python -c pass', { signal: controller.signal }), reason => Object.is(reason, controller.signal.reason));
  assert.equal(instance.terminated(), 1);
});

test('worker descriptor writes immediately reach the injected application filesystem', async () => {
  const fs = new MemoryFileSystem();
  let observed = false;
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    const request = async (op: string, args: unknown[]) => {
      Atomics.store(control, 0, 0);
      send({ op, args });
      while (!Atomics.load(control, 0)) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(Atomics.load(control, 0), 1);
      return JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1))));
    };
    void (async () => {
      const handle = await request('open', ['/shared.bin', { access: 'readwrite', creation: 'exclusive' }]);
      await request('write', [handle, [0, 1, 255], 0]);
      assert.deepEqual(Array.from(await fs.readFile('/shared.bin')), [0, 1, 255]);
      observed = true;
      // Deliberately leave the descriptor open; invocation cleanup owns it.
      send({ type: 'exit', exitCode: 0 });
    })().catch(error => send({ type: 'error', message: String(error) }));
  });
  const shell = new Shell({ fs }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(observed, true);
});

test('Python descriptor writes consume the shared shell output budget', async () => {
  const fs = new MemoryFileSystem();
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    const request = async (op: string, args: unknown[]) => {
      Atomics.store(control, 0, 0);
      send({ op, args });
      while (!Atomics.load(control, 0)) {
        if (instance.terminated()) return undefined;
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      return JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1))));
    };
    void (async () => {
      const handle = await request('open', ['/budget.bin', { access: 'write', creation: 'exclusive' }]);
      await request('write', [handle, [1, 2, 3], 0]);
      send({ type: 'exit', exitCode: 0 });
    })().catch(error => send({ type: 'error', message: String(error) }));
  });
  const shell = new Shell({ fs, limits: { maxOutputBytes: 2 } }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  await assert.rejects(shell.exec('python -c pass'), error => typeof error === 'object' && error !== null && 'limit' in error && error.limit === 'maxOutputBytes');
  assert.equal((await fs.readFile('/budget.bin')).length, 0);
});

test('subscription cleanup failure still terminates the interpreter', async () => {
  const instance = worker((_message, send) => queueMicrotask(() => send({ type: 'exit', exitCode: 0 })));
  const subscribe = instance.endpoint.subscribe;
  instance.endpoint.subscribe = (listener, onError) => {
    subscribe(listener, onError);
    return () => { throw new Error('unsubscribe failed'); };
  };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  await assert.rejects(shell.exec('python -c pass'), /unsubscribe failed/);
  assert.equal(instance.terminated(), 1);
});

test('an exited interpreter cannot admit another filesystem operation', async () => {
  const fs = new MemoryFileSystem();
  const instance = worker((_message, send) => {
    send({ type: 'exit', exitCode: 0 });
    send({ op: 'mkdir', args: ['/after-exit'] });
  });
  const shell = new Shell({ fs }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  assert.equal((await shell.exec('python -c pass')).exitCode, 0);
  await assert.rejects(fs.stat('/after-exit'), { code: 'ENOENT' });
  assert.equal(instance.terminated(), 1);
});

for (const phase of ['factory', 'subscribe'] as const) {
  test(`cancellation during worker ${phase} prevents interpreter startup`, async () => {
    const controller = new AbortController();
    let started = 0;
    let terminated = 0;
    let listener!: (value: unknown) => void;
    const endpoint: PythonWorkerEndpoint = {
      subscribe(next) {
        listener = next;
        if (phase === 'subscribe') controller.abort('cancel startup');
        return () => {};
      },
      postMessage() { started++; listener({ type: 'exit', exitCode: 0 }); },
      terminate() { terminated++; },
    };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker() {
      if (phase === 'factory') controller.abort('cancel startup');
      return endpoint;
    } }));
    await assert.rejects(shell.exec('python -c pass', { signal: controller.signal }), error => error === 'cancel startup');
    assert.equal(started, 0);
    assert.equal(terminated, 1);
  });
}

test('initialization progress is lazy, ordered and separate from command output', async () => {
  const events: unknown[] = [];
  let created = 0;
  const instance = worker((_message, send) => {
    send({ type: 'ready' });
    send({ type: 'exit', exitCode: 0 });
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createWorker() { created++; return instance.endpoint; },
    onProgress(event) { events.push(event); },
  }));
  assert.equal(created, 0);
  assert.deepEqual(events, []);
  const result = await shell.exec('python3 --version');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(events, ['initializing', 'ready', 'finished'].map(phase => ({ phase, command: 'python3' })));
  assert.equal(instance.terminated(), 1);
});

test('failed initialization finishes progress after worker retirement', async () => {
  const events: string[] = [];
  const instance = worker((_message, send) => send({ type: 'error', message: 'cannot load runtime' }));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createWorker: () => instance.endpoint,
    onProgress(event) {
      if (event.phase === 'finished') assert.equal(instance.terminated(), 1);
      events.push(event.phase);
    },
  }));
  assert.notEqual((await shell.exec('python -c pass')).exitCode, 0);
  assert.deepEqual(events, ['initializing', 'finished']);
});

test('exit while a stream request is outstanding is a protocol failure', async () => {
  const instance = worker((_message, send) => {
    send({ op: 'stdout', args: [[65]] });
    send({ type: 'exit', exitCode: 0 });
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass');
  assert.notEqual(result.exitCode, 0);
  assert.equal(instance.terminated(), 1);
});

test('a terminated interpreter cannot publish late progress or stream writes', async () => {
  const events: string[] = [];
  const instance = worker((_message, send) => {
    send({ type: 'exit', exitCode: 0 });
    send({ type: 'ready' });
    send({ op: 'stdout', args: [[65]] });
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createWorker: () => instance.endpoint, onProgress(event) { events.push(event.phase); },
  }));
  const result = await shell.exec('python -c pass');
  assert.equal(result.stdout, '');
  assert.deepEqual(events, ['initializing', 'finished']);
});

for (const phase of ['initializing', 'ready', 'finished'] as const) {
  test(`progress callback failure during ${phase} retires owned workers`, async () => {
    const instance = worker((_message, send) => { send({ type: 'ready' }); send({ type: 'exit', exitCode: 0 }); });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
      createWorker: () => instance.endpoint,
      onProgress(event) { if (event.phase === phase) throw new Error('progress failed'); },
    }));
    assert.notEqual((await shell.exec('python -c pass')).exitCode, 0);
    assert.equal(instance.terminated(), phase === 'initializing' ? 0 : 1);
  });
}

test('stdin RPC preserves reused producer buffers, partial reads and EOF', async () => {
  const replies: unknown[] = [];
  const source = (async function* () {
    const bytes = new Uint8Array([0, 255]);
    yield bytes;
    bytes.set([128, 10]);
    yield bytes;
    bytes.fill(42);
  })();
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    void (async () => {
      for (let index = 0; index < 5; index++) {
        Atomics.store(control, 0, 0);
        send({ op: 'stdin', args: [1] });
        while (!Atomics.load(control, 0)) await new Promise(resolve => setTimeout(resolve, 1));
        assert.equal(Atomics.load(control, 0), 1);
        replies.push(JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1)))));
      }
      send({ type: 'exit', exitCode: 0 });
    })().catch(error => send({ type: 'error', message: String(error) }));
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass', { stdin: source });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(replies, [[0], [255], [128], [10], []]);
});

test('broken output pipes reach the interpreter as EPIPE rather than EOF', async () => {
  let reply: unknown;
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    send({ op: 'stdout', args: [[0, 255]] });
    void (async () => {
      while (!Atomics.load(control, 0)) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(Atomics.load(control, 0), 2);
      reply = JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1))));
      send({ type: 'exit', exitCode: 120 });
    })().catch(error => send({ type: 'error', message: String(error) }));
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass', {
    stdout: { async write() { throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' }); } },
  });
  assert.deepEqual(reply, { code: 'EPIPE' });
  assert.equal(result.exitCode, 120);
  assert.equal(instance.terminated(), 1);
});

test('internal pipe closure delivers EPIPE while preserving stderr and interpreter status', async () => {
  let broken = false;
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    const request = async (op: string, bytes: number[]) => {
      Atomics.store(control, 0, 0);
      send({ op, args: [bytes] });
      while (!Atomics.load(control, 0) && !instance.terminated()) await new Promise(resolve => setTimeout(resolve, 1));
      if (instance.terminated()) return undefined;
      return JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1))));
    };
    void (async () => {
      for (let index = 0; index < 100 && !instance.terminated(); index++) {
        const response = await request('stdout', [97, 98, 99, 100, 101, 102]);
        if (response?.code === 'EPIPE') { broken = true; break; }
      }
      if (!instance.terminated()) {
        await request('stderr', Array.from(new TextEncoder().encode('BrokenPipeError\n')));
        send({ type: 'exit', exitCode: 1 });
      }
    })().catch(error => send({ type: 'error', message: String(error) }));
  });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...streamCommands(), ...basicCommands()]), limits: { pipeHighWaterMark: 1 } })
    .use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass | head -c 1; echo ${PIPESTATUS[@]}');
  assert.equal(broken, true);
  assert.equal(result.stdout, 'a1 0\n');
  assert.equal(result.stderr, 'BrokenPipeError\n');
  assert.equal(instance.terminated(), 1);
});

test('pip help and rejected options do not load an interpreter or pretend success', async () => {
  let created = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker() { created++; throw new Error('must remain lazy'); } }));
  const help = await shell.exec('python -m pip install --help');
  assert.equal(help.exitCode, 0, help.stderr);
  assert.ok(help.stdout.includes('Supported options:'));
  for (const command of ['python -m pip install --upgrade pypdf', 'python3 -m pip uninstall pypdf', 'python -m pip install']) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.ok(result.stderr.includes('python:'));
  }
  assert.equal(created, 0);
});

test('interpreter installer failures remain clear shell diagnostics', async () => {
  const instance = worker((_message, send) => queueMicrotask(() => send({ type: 'error', message: 'Incompatible native desktop wheel: cp314-macosx.whl' })));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const result = await shell.exec('python -c pass');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('Incompatible native desktop wheel'));
});

test('SDK packages and shell requirements use canonical storage and mark installation-only invocations', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/requirements.txt', new TextEncoder().encode('pypdf==6.18.1\n'));
  const starts: any[] = [];
  const shell = new Shell({ fs }).use(pythonCommands({
    packages: ['openpyxl==3.1.5'],
    provisioning: {offline:true},
    createWorker() {
      return worker((start, send) => { starts.push(start); queueMicrotask(() => send({ type: 'exit', exitCode: 0 })); }).endpoint;
    },
  }));
  assert.equal((await shell.exec('python -m pip install -r /requirements.txt')).exitCode, 0);
  assert.equal(starts[0].installOnly, true);
  assert.ok(starts[0].packages.requirements.includes('pypdf==6.18.1'));
  assert.ok(starts[0].packages.requirements.includes('openpyxl==3.1.5'));
  assert.equal(starts[0].packages.offline, true);
  assert.equal((await shell.exec('python3 -c pass')).exitCode, 0);
  assert.equal(starts[1].installOnly, false);
});

test('package transport exceptions preserve their diagnostic without an errno code', async () => {
  const instance = worker((message, send) => {
    const control = new Int32Array(message.shared, 0, 2);
    const payload = new Uint8Array(message.shared, 8);
    send({ op: 'package-open', args: [message.packages.session, 'https://example.test/pkg.whl'] });
    const observe = () => {
      if (instance.terminated()) return;
      if (!Atomics.load(control, 0)) { setTimeout(observe, 1); return; }
      const reply = JSON.parse(new TextDecoder().decode(payload.slice(0, Atomics.load(control, 1))));
      send({ type: 'error', message: reply.message });
    };
    observe();
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createWorker: () => instance.endpoint,
    provisioning: { authorize: () => true, transport: async () => { throw new Error('Package TLS handshake failed'); } },
  }));
  const result = await shell.exec('python -c pass');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('Package TLS handshake failed'), result.stderr);
});

test('worker admission fails immediately at capacity and releases after abort', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let created = 0;
  const controller = new AbortController();
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    maxConcurrentWorkers: 1,
    createWorker() {
      created++;
      return worker((_message, send) => {
        if (created === 1) started();
        else queueMicrotask(() => send({ type: 'exit', exitCode: 0 }));
      }).endpoint;
    },
  }));
  const running = shell.exec('python -c pass', { signal: controller.signal });
  const aborted = assert.rejects(running, reason => reason === 'retire');
  await ready;
  try {
    const busy = await shell.exec('python3 -c pass');
    assert.equal(busy.exitCode, 1);
    assert.match(busy.stderr, /worker capacity/);
    assert.equal(created, 1);
  } finally { controller.abort('retire'); }
  await aborted;
  assert.equal((await shell.exec('python -c pass')).exitCode, 0);
});

test('stdin retention refuses oversized upstream chunks before acknowledging bytes', async () => {
  const instance = worker((_message, send) => send({ op: 'stdin', args: [1] }));
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    createWorker: () => instance.endpoint, maxInputChunkBytes: 2,
  }));
  const result = await shell.exec('python -c pass', { stdin: new Uint8Array([1, 2, 3]) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /input chunk/);
  assert.equal(instance.terminated(), 1);
});

for (const stream of ['stdout', 'stderr'] as const) {
  test(`${stream} acknowledgement waits for sink backpressure without retaining more requests`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    let finish!: () => void;
    let control!: Int32Array;
    const chunks: number[][] = [];
    const instance = worker((message, send) => {
      control = new Int32Array(message.shared, 0, 2);
      finish = () => send({ type: 'exit', exitCode: 0 });
      send({ op: stream, args: [[0, 255, 128, 10]] });
    });
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
    const command = shell.exec('python -c pass', { [stream]: { async write(bytes: Uint8Array) {
      chunks.push(Array.from(bytes)); entered(); await gate;
    } } });
    await writing;
    assert.equal(Atomics.load(control, 0), 0);
    assert.deepEqual(chunks, [[0, 255, 128, 10]]);
    release();
    while (!Atomics.load(control, 0)) await new Promise(resolve => setImmediate(resolve));
    finish();
    assert.equal((await command).exitCode, 0);
  });
}

test('a saturated Python pipeline refuses a stage and retires the producer on EPIPE', async () => {
  let terminated = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({
    maxConcurrentWorkers: 1,
    createWorker() {
      const instance = worker((message, send) => {
        const control = new Int32Array(message.shared, 0, 2);
        send({ op: 'stdout', args: [[1, 2, 3]] });
        const observe = () => {
          if (!Atomics.load(control, 0)) { setImmediate(observe); return; }
          send({ type: 'exit', exitCode: 120 });
        };
        observe();
      });
      instance.endpoint.terminate = () => { terminated++; };
      return instance.endpoint;
    },
  }));
  const result = await shell.exec('python -c producer | python3 -c consumer');
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /worker capacity/);
  assert.equal(terminated, 1);
});

test('abort retires an interpreter blocked on opaque stdin and observes late source completion', async () => {
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let supply!: (value: IteratorResult<Uint8Array>) => void;
  const source = {
    [Symbol.asyncIterator]() { return {
      next() { entered(); return new Promise<IteratorResult<Uint8Array>>(resolve => { supply = resolve; }); },
      return() { return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    }; },
  };
  const controller = new AbortController();
  let control!: Int32Array;
  const instance = worker((message, send) => {
    control = new Int32Array(message.shared, 0, 2);
    send({ op: 'stdin', args: [1] });
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(pythonCommands({ createWorker: () => instance.endpoint }));
  const command = shell.exec('python -c pass', { stdin: source, signal: controller.signal });
  const rejected = assert.rejects(command, reason => reason === 'stop read');
  await reading;
  controller.abort('stop read');
  await rejected;
  assert.equal(instance.terminated(), 1);
  supply({ done: false, value: new Uint8Array([255]) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Atomics.load(control, 0), 0);
});
