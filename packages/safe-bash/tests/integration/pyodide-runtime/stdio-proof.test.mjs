import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createBytePipe } from '../../../src/contracts/io.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function session(context) {
  const shared = new SharedArrayBuffer(4096);
  const control = new Int32Array(shared, 0, 2);
  const payload = new Uint8Array(shared, 8);
  const pipes = Object.fromEntries(['stdin', 'stdout', 'stderr'].map(name => [name, createBytePipe({ highWaterMark: 1 })]));
  const reader = pipes.stdin.readable[Symbol.asyncIterator]();
  let remaining = new Uint8Array();
  const worker = new Worker(new URL('./stdio-proof-worker.mjs', import.meta.url), { workerData: { shared } });
  const ready = deferred();
  const done = deferred();
  void ready.promise.catch(() => {});
  void done.promise.catch(() => {});
  const pending = new Set();
  const observed = [];
  let stopped = false;
  function reply(value, failure = false) {
    if (stopped) return;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    assert.ok(bytes.length <= payload.length);
    payload.set(bytes);
    Atomics.store(control, 1, bytes.length);
    Atomics.store(control, 0, failure ? 2 : 1);
    Atomics.notify(control, 0);
  }
  worker.on('error', error => { ready.reject(error); done.reject(error); });
  worker.on('exit', code => {
    if (!stopped) {
      const error = new Error(`Python worker exited unexpectedly: ${code}`);
      ready.reject(error); done.reject(error);
    }
  });
  worker.on('message', message => {
    if (message.ready) { ready.resolve(message); return; }
    if (message.done || message.failed) {
      void Promise.all([pipes.stdout.close(), pipes.stderr.close()]).then(() => {
        if (message.failed) done.reject(new Error(message.failed));
        else done.resolve();
      }, done.reject);
      return;
    }
    observed.push(message.op);
    const serving = (async () => {
      if (message.op === 'stdin') {
        if (!remaining.length) {
          const next = await reader.next();
          remaining = next.done ? new Uint8Array() : Uint8Array.from(next.value);
        }
        const result = remaining.slice(0, message.args);
        remaining = remaining.subarray(result.length);
        reply(Array.from(result));
      } else {
        await pipes[message.op].writable.write(Uint8Array.from(message.args));
        reply(null);
      }
    })().catch(error => reply({ error: String(error), code: error?.code }, true));
    pending.add(serving);
    void serving.finally(() => pending.delete(serving));
  });
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const cancellation = new Error('cancelled');
    ready.reject(cancellation);
    await Promise.all(Object.values(pipes).map(pipe => pipe.abort(new Error('cancelled'))));
    await worker.terminate();
    await Promise.all(pending);
    await reader.return?.();
    done.reject(cancellation);
  };
  context.after(stop);
  assert.equal((await ready.promise).version, '314.0.6');
  return { pipes, observed, pending, stop, run(script) { worker.postMessage({ script }); return done.promise; } };
}

test('real synchronous Python exchanges incremental bytes through bounded shell pipes', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const out = bridge.pipes.stdout.readable[Symbol.asyncIterator]();
  const err = bridge.pipes.stderr.readable[Symbol.asyncIterator]();
  const running = bridge.run(`import os\nfor i in range(64):\n b = os.read(0, 1)\n os.write(1, b)\n os.write(2, b)\nassert os.read(0, 1) == b''\n`);
  // Producer cannot provide byte N+1 until both outputs for N are visible.
  for (let index = 0; index < 64; index++) {
    const byte = Uint8Array.of(index * 4);
    await bridge.pipes.stdin.writable.write(byte);
    assert.deepEqual((await out.next()).value, byte);
    assert.deepEqual((await err.next()).value, byte);
  }
  await bridge.pipes.stdin.close();
  await running;
  assert.equal(bridge.observed.filter(op => op === 'stdin').length, 65);
  await out.return?.();
  await err.return?.();
});

for (const stream of ['stdin', 'stdout', 'stderr']) {
  test(`real Python cancellation while blocked on bounded ${stream} retires RPC work`, { timeout: 15000 }, async context => {
    const bridge = await session(context);
    const fd = stream === 'stdout' ? 1 : 2;
    const running = bridge.run(stream === 'stdin' ? 'import os\nos.read(0, 1)' : `import os\nos.write(${fd}, b'a')\nos.write(${fd}, b'b')`);
    const settlement = assert.rejects(running, { message: 'cancelled' });
    const expected = stream === 'stdin' ? 1 : 2;
    while (bridge.observed.filter(op => op === stream).length < expected) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(bridge.pending.size, 1);
    const began = performance.now();
    await bridge.stop();
    await settlement;
    assert.equal(bridge.pending.size, 0);
    assert.ok(performance.now() - began < 1000, 'cooperative pipe cancellation settles promptly');
  });
}

test('successful Python completion closes both output pipes after final bytes', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const output = bridge.pipes.stdout.readable[Symbol.asyncIterator]();
  const error = bridge.pipes.stderr.readable[Symbol.asyncIterator]();
  await bridge.run('import os\nos.write(1, b"final")\nos.write(2, b"error")');
  assert.equal(new TextDecoder().decode((await output.next()).value), 'final');
  assert.equal(new TextDecoder().decode((await error.next()).value), 'error');
  const deadline = setTimeout(() => bridge.stop(), 500);
  try {
    assert.equal((await output.next()).done, true);
    assert.equal((await error.next()).done, true);
  } finally { clearTimeout(deadline); }
});

test('Python observes downstream closure as BrokenPipeError and stderr remains usable', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  await bridge.pipes.stdout.endpoints.read.close();
  await bridge.run(`import os, errno
try:
 os.write(1, b'x')
except BrokenPipeError as error:
 assert error.errno == errno.EPIPE
else:
 raise AssertionError('write to closed pipe succeeded')
os.write(2, b'caught')
`);
  assert.equal(new TextDecoder().decode((await bridge.pipes.stderr.readable.next()).value), 'caught');
});

test('binary buffered stdin and output preserve every byte across RPC chunks and repeated EOF', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const expected = Uint8Array.from({ length: 1025 }, (_, index) => index % 256);
  const output = (async () => {
    const chunks = [];
    for await (const chunk of bridge.pipes.stdout.readable) chunks.push(Uint8Array.from(chunk));
    return Buffer.concat(chunks);
  })();
  const running = bridge.run(`import os, sys
assert os.read(0, 0) == b''
data = sys.stdin.buffer.read()
assert len(data) == 1025
assert os.read(0, 3) == b''
assert os.read(0, 3) == b''
assert sys.stdout.buffer.write(data) == len(data)
sys.stdout.buffer.flush()
`);
  await bridge.pipes.stdin.writable.write(new Uint8Array());
  for (let offset = 0; offset < expected.length; offset += 79) {
    await bridge.pipes.stdin.writable.write(expected.subarray(offset, offset + 79));
  }
  await bridge.pipes.stdin.close();
  await running;
  assert.deepEqual(await output, Buffer.from(expected));
});

test('uncaught Python exception closes output streams without discarding accepted bytes', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const failure = assert.rejects(bridge.run('import sys\nsys.stdout.write("before")\nraise ValueError("expected")'), /ValueError: expected/);
  const output = bridge.pipes.stdout.readable[Symbol.asyncIterator]();
  assert.equal(new TextDecoder().decode((await output.next()).value), 'before');
  await failure;
  assert.equal((await output.next()).done, true);
  assert.equal((await bridge.pipes.stderr.readable.next()).done, true);
});

test('a large os.write reports accepted prefix when the consumer closes during backpressure', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const running = bridge.run(`import os
assert os.write(1, b'x' * 65) == 32
os.write(2, b'partial')
`);
  while (bridge.observed.filter(op => op === 'stdout').length < 2) await new Promise(resolve => setTimeout(resolve, 1));
  await bridge.pipes.stdout.endpoints.read.close();
  await running;
  assert.equal(new TextDecoder().decode((await bridge.pipes.stderr.readable.next()).value), 'partial');
});

test('Python completion flushes buffered text without explicit script flush', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  const output = (async () => {
    const chunks = [];
    for await (const chunk of bridge.pipes.stdout.readable) chunks.push(Uint8Array.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  })();
  await bridge.run('import sys\nsys.stdout.write("é" * 99)');
  assert.equal(await output, 'é'.repeat(99));
});

test('stdout flush failure preserves the script error and still flushes stderr', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  await bridge.pipes.stdout.endpoints.read.close();
  await assert.rejects(bridge.run('import sys\nsys.stdout.write("buffered")\nsys.stderr.write("diagnostic")\nraise ValueError("primary")'), /ValueError: primary\n$/);
  assert.equal(new TextDecoder().decode((await bridge.pipes.stderr.readable.next()).value), 'diagnostic', JSON.stringify(bridge.observed));
  assert.equal((await bridge.pipes.stderr.readable.next()).done, true);
});

test('scripts may close their standard streams before successful completion', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  await bridge.run('import sys\nsys.stdout.write("before close")\nsys.stdout.close()\nsys.stderr.close()');
  assert.equal(new TextDecoder().decode((await bridge.pipes.stdout.readable.next()).value), 'before close');
  assert.equal((await bridge.pipes.stdout.readable.next()).done, true);
  assert.equal((await bridge.pipes.stderr.readable.next()).done, true);
});

test('scripts may disable standard output streams before successful completion', { timeout: 15000 }, async context => {
  const bridge = await session(context);
  await bridge.run('import sys\nsys.stdout = None\nsys.stderr = None');
  assert.equal((await bridge.pipes.stdout.readable.next()).done, true);
  assert.equal((await bridge.pipes.stderr.readable.next()).done, true);
});
