import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonHostBridge } from "./host-capabilities.js";

test('structured calls preserve data and scope and retire deterministically', async () => {
  const controller = new AbortController();
  const bridge = createPythonHostBridge({ echo: { async call(value, { signal }) { assert.equal(signal.aborted, false); return value; } } }, { signal: controller.signal });
  assert.deepEqual(await bridge.request({ version: 1, operation: 'call', capability: 'echo', value: { count: 3, enabled: true } }), { count: 3, enabled: true });
  await bridge.close();
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', value: null }), /retired/);
});

test('streams pull once per request, preserve binary bytes, and close on early exit', async () => {
  let pulls = 0;
  let releases = 0;
  const bridge = createPythonHostBridge({ model: { stream() { return { [Symbol.asyncIterator]() { return { async next() { pulls++; return { done: false, value: new Uint8Array([0, 255, 128]) }; }, async return() { releases++; return { done: true, value: undefined }; } }; } }; } } }, { signal: new AbortController().signal });
  const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'model', value: null });
  assert.equal(pulls, 0);
  assert.deepEqual(await bridge.request({ version: 1, operation: 'next', handle }), { done: false, value: { type: 'bytes', bytes: [0, 255, 128] } });
  await bridge.request({ version: 1, operation: 'release', handle });
  await bridge.close();
  assert.equal(pulls, 1);
  assert.equal(releases, 1);
});

test('rejects unknown authority and overflowing input/output', async () => {
  const bridge = createPythonHostBridge({ large: { async call() { return 'x'.repeat(200); } } }, { signal: new AbortController().signal, maxMessageBytes: 128 });
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'other', value: null }), /Unknown/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'large', value: 'x'.repeat(200) }), /limit/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'large', value: null }), /limit/);
  await bridge.close();
});

test('retirement aborts pending calls and waits for their cleanup', async () => {
  let finished = false;
  const bridge = createPythonHostBridge({ delayed: { async call(_, { signal }) { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); finished = true; return null; } } }, { signal: new AbortController().signal });
  const call = bridge.request({ version: 1, operation: 'call', capability: 'delayed', value: null });
  await Promise.resolve();
  const closing = bridge.close();
  await assert.rejects(call, /retired/);
  await closing;
  assert.equal(finished, true);
});

test('capabilities and stream handles are invocation-local', async () => {
  const make = (identity: string) => createPythonHostBridge({ who: { async call() { return identity; }, async *stream() { yield identity; } } }, { signal: new AbortController().signal });
  const first = make('first-user');
  const second = make('second-user');
  const handle = await first.request({ version: 1, operation: 'stream', capability: 'who' });
  await assert.rejects(second.request({ version: 1, operation: 'next', handle }), /Unknown/);
  assert.equal(await second.request({ version: 1, operation: 'call', capability: 'who' }), 'second-user');
  await first.close();
  assert.equal(await second.request({ version: 1, operation: 'call', capability: 'who' }), 'second-user');
  await second.close();
});

test('bounds composite payloads before serialization and refuses accessors', async () => {
  let called = false;
  const bridge = createPythonHostBridge({ echo: { async call() { called = true; return null; } } }, { signal: new AbortController().signal, maxMessageBytes: 256 });
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', value: ['x'.repeat(200), 'y'.repeat(200)] }), /limit/);
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo', get value() { throw new Error('accessed getter'); } }), /data only/);
  assert.equal(called, false);
  await bridge.close();
});

test('async guest jobs can cancel an outstanding host call without retiring the invocation', async () => {
  let cancelled = false;
  const bridge = createPythonHostBridge({ slow: { async call(_, {signal}) {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve(); }, {once:true}));
    signal.throwIfAborted();
    return null;
  } }, echo: {async call(value) { return value; }} }, {signal:new AbortController().signal});
  const handle = await bridge.request({version:1, operation:'begin', capability:'slow', value:null});
  assert.deepEqual(await bridge.request({version:1, operation:'poll', handle}), {done:false});
  await bridge.request({version:1, operation:'cancel', handle});
  await Promise.resolve();
  assert.equal(cancelled, true);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(await bridge.request({version:1, operation:'call', capability:'echo', value:'alive'}), 'alive');
  await bridge.close();
});

test('failed iterator release keeps retirement failed', async () => {
  const failure = new Error('iterator cleanup failed');
  let releases = 0;
  const bridge = createPythonHostBridge({ stream: { stream() { return { [Symbol.asyncIterator]() { return { async next() { return {done:false, value:'value'}; }, async return() { releases++; throw failure; } }; } }; } } }, {signal:new AbortController().signal, maxStreams:1});
  const handle = await bridge.request({version:1, operation:'stream', capability:'stream'});
  await assert.rejects(bridge.request({version:1, operation:'release', handle}), error => error === failure);
  await assert.rejects(bridge.request({version:1, operation:'stream', capability:'stream'}), /stream limit/);
  await assert.rejects(bridge.close(), error => error === failure);
  assert.equal(releases, 1);
});

test('natural async stream completion is not classified as cancellation', async () => {
  const bridge = createPythonHostBridge({ empty:{async *stream() {}} }, {signal:new AbortController().signal});
  const stream = await bridge.request({version:1, operation:'stream', capability:'empty'});
  const handle = await bridge.request({version:1, operation:'begin-next', handle:stream});
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(await bridge.request({version:1, operation:'poll', handle}), {done:true,value:{done:true}});
  await bridge.close();
});

test('streams enforce a cumulative byte budget and release on overflow', async () => {
  let closed = false;
  const bridge = createPythonHostBridge({ output:{async *stream() {try {yield new Uint8Array([1,2]); yield new Uint8Array([3,4]);} finally {closed=true;}}} }, {signal:new AbortController().signal,maxStreamBytes:3});
  const handle = await bridge.request({version:1,operation:'stream',capability:'output'});
  await bridge.request({version:1,operation:'next',handle});
  await assert.rejects(bridge.request({version:1,operation:'next',handle}), /stream byte limit/);
  assert.equal(closed,true);
  await bridge.close();
});

test('oversized sparse arrays are rejected before JSON expansion', async () => {
  let serialized = false;
  const value = new Proxy(new Array(1024), {get(target, key, receiver) {if (key === 'toJSON') serialized = true; return Reflect.get(target, key, receiver);}});
  const bridge = createPythonHostBridge({ large:{async call() {return value;}} }, {signal:new AbortController().signal,maxMessageBytes:256});
  await assert.rejects(bridge.request({version:1,operation:'call',capability:'large'}), /limit/);
  assert.equal(serialized,false);
  await bridge.close();
});

for (const limits of [{}, { maxMessageBytes: Infinity, maxConcurrentCalls: Infinity, maxStreams: Infinity, maxStreamBytes: Infinity }, { maxMessageBytes: 200000 }]) {
  test(`host accepts large messages with limits ${JSON.stringify(limits)}`, async () => {
    const bridge = createPythonHostBridge({ echo: { async call(value) { return value; } } }, { signal: new AbortController().signal, ...limits });
    const value = 'x'.repeat(100000);
    assert.equal(await bridge.request({ version: 1, operation: 'call', capability: 'echo', value }), value);
    await bridge.close();
  });
}

test('host depth is optional and cycles are invalid data', async () => {
  const value: Record<string, unknown> = {};
  let child = value;
  for (let i = 0; i < 40; i++) { child.next = {}; child = child.next as Record<string, unknown>; }
  const request = { version: 1, operation: 'call', capability: 'echo', value };
  const bridge = createPythonHostBridge({ echo: { async call(value) { return value; } } }, { signal: new AbortController().signal });
  assert.deepEqual(await bridge.request(request), value);
  child.next = value;
  await assert.rejects(bridge.request(request), /cycles/);
  await bridge.close();
  delete child.next;
  const bounded = createPythonHostBridge({}, { signal: new AbortController().signal, maxMessageDepth: 32 });
  await assert.rejects(bounded.request(request), /limit/);
  await bounded.close();
});

test('default admission permits concurrent calls and more than four streams', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const bridge = createPythonHostBridge({ echo: { async call(value) { await gate; return value; }, async *stream() { yield 'x'.repeat(1048577); } } }, { signal: new AbortController().signal });
  const first = bridge.request({ version: 1, operation: 'call', capability: 'echo', value: 1 });
  const second = bridge.request({ version: 1, operation: 'call', capability: 'echo', value: 2 });
  finish();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  for (let i = 0; i < 5; i++) {
    const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'echo' });
    const result = await bridge.request({ version: 1, operation: 'next', handle });
    assert.equal((result as { done: boolean }).done, false);
  }
  await bridge.close();
});

test('finite host concurrency and stream admission remain enforced', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const bridge = createPythonHostBridge({ echo: { async call() { await gate; return null; }, async *stream() { yield 'x'; } } }, { signal: new AbortController().signal, maxConcurrentCalls: 1, maxStreams: 1 });
  const first = bridge.request({ version: 1, operation: 'call', capability: 'echo' });
  await assert.rejects(bridge.request({ version: 1, operation: 'call', capability: 'echo' }), /concurrency limit/);
  finish();
  await first;
  await bridge.request({ version: 1, operation: 'stream', capability: 'echo' });
  await assert.rejects(bridge.request({ version: 1, operation: 'stream', capability: 'echo' }), /stream limit/);
  await bridge.close();
});

test('synchronous calls and asynchronous jobs share one host concurrency limit', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const bridge = createPythonHostBridge({ hold: { async call() { await gate; return null; } } },
    { signal: new AbortController().signal, maxConcurrentCalls: 2 });
  await bridge.request({ version: 1, operation: 'begin', capability: 'hold' });
  const direct = bridge.request({ version: 1, operation: 'call', capability: 'hold' });
  try {
    await assert.rejects(bridge.request({ version: 1, operation: 'begin', capability: 'hold' }), /concurrency limit/);
  } finally {
    finish();
    await direct;
    await bridge.close();
  }
});

test('cancelled unfinished work and uncollected results each retain host admission', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const bridge = createPythonHostBridge({ hold: { async call(value) { if (value === 'hold') await gate; return value; } } },
    { signal: new AbortController().signal, maxConcurrentCalls: 2 });
  const cancelled = await bridge.request({ version: 1, operation: 'begin', capability: 'hold', value: 'hold' });
  try {
    await bridge.request({ version: 1, operation: 'cancel', handle: cancelled });
    const completed = await bridge.request({ version: 1, operation: 'begin', capability: 'hold', value: 'completed' });
    await new Promise<void>(resolve => setImmediate(resolve));
    await assert.rejects(bridge.request({ version: 1, operation: 'begin', capability: 'hold' }), /concurrency limit/);
    assert.deepEqual(await bridge.request({ version: 1, operation: 'poll', handle: completed }), { done: true, value: 'completed' });
    assert.equal(await bridge.request({ version: 1, operation: 'call', capability: 'hold', value: 'available' }), 'available');
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    await bridge.request({ version: 1, operation: 'begin', capability: 'hold' });
    await bridge.request({ version: 1, operation: 'begin', capability: 'hold' });
  } finally {
    finish();
    await bridge.close();
  }
});

test('a closing stream retains its admission until iterator cleanup settles', async () => {
  let finish!: () => void;
  let entered!: () => void;
  const cleanup = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let releases = 0;
  const bridge = createPythonHostBridge({ output: { stream() {
    return { [Symbol.asyncIterator]() { return {
      async next() { return { done: false as const, value: 'chunk' }; },
      async return() {
        releases++;
        entered();
        await cleanup;
        return { done: true as const, value: undefined };
      },
    }; } };
  } } }, { signal: new AbortController().signal, maxStreams: 1 });
  const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'output' });
  const release = bridge.request({ version: 1, operation: 'release', handle });
  try {
    await started;
    await assert.rejects(bridge.request({ version: 1, operation: 'stream', capability: 'output' }), /stream limit/);
    await assert.rejects(bridge.request({ version: 1, operation: 'next', handle }), /closing|busy/);
    finish();
    await release;
    const next = await bridge.request({ version: 1, operation: 'stream', capability: 'output' });
    await bridge.request({ version: 1, operation: 'release', handle: next });
    assert.equal(releases, 2);
  } finally {
    finish();
    await release;
    await bridge.close();
  }
});

test('host limits reject invalid finite settings', () => {
  for (const name of ['maxMessageBytes', 'maxMessageDepth', 'maxConcurrentCalls', 'maxStreams', 'maxStreamBytes']) {
    for (const limit of [0, -1, 1.5, NaN, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createPythonHostBridge({}, { signal: new AbortController().signal, [name]: limit }), RangeError);
    }
  }
});


test('concurrent async pulls reserve a stream before host jobs start', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let pulls = 0;
  const bridge = createPythonHostBridge({ output: { stream() {
    return { [Symbol.asyncIterator]() { return {
      async next() { pulls++; await gate; return { done: false as const, value: 'chunk' }; },
      async return() { return { done: true as const, value: undefined }; },
    }; } };
  } } }, { signal: new AbortController().signal, maxConcurrentCalls: 2 });
  try {
    const handle = await bridge.request({ version: 1, operation: 'stream', capability: 'output' });
    const results = await Promise.allSettled([
      bridge.request({ version: 1, operation: 'begin-next', handle }),
      bridge.request({ version: 1, operation: 'begin-next', handle }),
    ]);
    assert.equal(results[0]!.status, 'fulfilled');
    assert.equal(results[1]!.status, 'rejected');
    if (results[1]!.status === 'rejected') assert.match(String(results[1].reason), /busy/);
    assert.equal(pulls, 1);
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    const first = results[0]!;
    if (first.status === 'fulfilled') {
      assert.deepEqual(await bridge.request({ version: 1, operation: 'poll', handle: first.value }),
        { done: true, value: { done: false, value: { type: 'text', text: 'chunk' } } });
    }
    await bridge.request({ version: 1, operation: 'begin-next', handle });
    assert.equal(pulls, 2);
  } finally {
    finish();
    await bridge.close();
  }
});

test('retirement closes every unique capability after a synchronous cleanup failure', async () => {
  const failure = new Error('capability cleanup failed');
  let closed = 0;
  const shared = {async close() { closed++; }};
  const bridge = createPythonHostBridge({
    failed: {close(): Promise<void> { throw failure; }},
    first: shared,
    alias: shared,
  }, {signal:new AbortController().signal});
  await assert.rejects(bridge.close(), error => error === failure);
  assert.equal(closed,1);
  await assert.rejects(bridge.close(), error => error === failure);
  assert.equal(closed,1);
  await assert.rejects(bridge.request({version:1,operation:'call',capability:'first',value:null}),/retired/);
});
