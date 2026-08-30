import assert from 'node:assert/strict';
import { once, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { Client, Capacity } from './.temporary/js/tests/stress/regex-execution/design/client.js';
import { scenarios, row, expectedHits } from './fixtures.mjs';

const [name] = process.argv.slice(2);
assert(process.send && scenarios.includes(name), 'STATIC_BENIGN_CHILD_ONLY');
const clients = [];
const observations = [];
const cleanups = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const make = (signal, capacity = new Capacity()) => {
  const client = new Client([{ source: 'r', flags: 'g' }], capacity, signal);
  clients.push(client);
  return client;
};
const snapshot = client => ({
  metrics: { ...client.metrics }, pending: Boolean(client.pending),
  released: client.release === undefined, capacity: client.capacity.active,
  threadId: client.worker?.threadId ?? null,
  signalListeners: client.signal ? getEventListeners(client.signal, 'abort').length : 0,
  workerListeners: client.worker ? ['message', 'error', 'messageerror', 'exit'].map(event => client.worker.listenerCount(event)) : [],
});
const clean = client => {
  assert.equal(client.metrics.created, client.metrics.terminated);
  assert.equal(client.pending, undefined);
  assert.equal(client.release, undefined);
  assert.equal(client.capacity.active, 0);
  assert.equal(client.metrics.listenersAfter, 0);
  assert.equal(client.signal ? getEventListeners(client.signal, 'abort').length : 0, 0);
  if (client.worker) {
    assert.equal(client.worker.threadId, -1);
    for (const event of ['message', 'error', 'messageerror', 'exit']) assert.equal(client.worker.listenerCount(event), 0);
    assert.equal(client.worker.stdout.listenerCount('data'), 0);
    assert.equal(client.worker.stderr.listenerCount('data'), 0);
  }
};
const sourceOf = (next, finish = async () => ({ done: true })) => ({ [Symbol.asyncIterator]() { return this; }, next, return: finish });
const first = async iterator => {
  const result = await iterator.next();
  assert.equal(result.done, false);
  assert.deepEqual(result.value.hits, expectedHits);
};

async function benign() {
  if (name === 'idle-exit' || name === 'idle-idempotence') {
    const controller = new AbortController(); const client = make(controller.signal);
    await client.ready();
    const exactWorker = client.worker;
    const exitCode = await exactWorker.terminate();
    await delay(30);
    observations.push({ automaticBeforeManualDispose: snapshot(client), exitCode });
    clean(client);
    assert.equal(client.metrics.exitCode, exitCode);
    if (name === 'idle-idempotence') {
      const lateExit = client.exit; const lateError = client.error;
      await Promise.all([client.dispose(), client.dispose(), client.dispose()]);
      lateExit(exitCode); lateError(new Error('LATE_ERROR'));
      controller.abort(new Error('LATE_ABORT'));
      await client.dispose();
      clean(client); assert.equal(client.metrics.terminated, 1);
    }
    const successor = make(undefined, client.capacity);
    await successor.batch([row]); await successor.dispose(); clean(successor);
    return;
  }
  if (name === 'pending-exit') {
    const client = make(); await client.ready();
    const pending = outcome(client.batch([row]));
    await Promise.resolve();
    assert(client.pending, 'ACTUAL_SCAN_PENDING');
    const terminated = client.worker.terminate();
    const result = await pending; await terminated;
    assert.match(result.error?.message ?? '', /WORKER_EXIT/);
    clean(client); return;
  }
  if (name === 'preabort') {
    const controller = new AbortController(); const reason = new Error('PREABORT'); controller.abort(reason);
    const client = make(controller.signal); let acquired = 0;
    const source = { [Symbol.asyncIterator]() { acquired++; throw new Error('UNREACHABLE'); } };
    assert.equal((await outcome(client.stream(source, 16).next())).error, reason);
    assert.equal(acquired, 0); assert.equal(client.metrics.created, 0); assert.equal(client.metrics.requests, 0);
    await client.dispose(); clean(client); return;
  }
  if (name === 'live-feedback') {
    const client = make(); let reads = 0; let returned = 0; let feedback = false;
    const source = sourceOf(async () => {
      reads++;
      if (reads === 1) return { done: false, value: row };
      assert(feedback, 'PRODUCER_REQUIRES_FIRST_RESULT_BEFORE_NEXT_READ');
      return { done: true };
    }, async () => { returned++; return { done: true }; });
    const iterator = client.stream(source, 16);
    await first(iterator); assert.equal(reads, 1); feedback = true;
    assert.equal((await iterator.next()).done, true);
    assert.equal(reads, 2); assert.equal(returned, 0); clean(client); return;
  }
  if (name === 'paused-backpressure' || name === 'paused-abort') {
    const controller = new AbortController(); const client = make(controller.signal);
    let reads = 0; let returned = 0;
    const iterator = client.stream(sourceOf(async () => { reads++; return { done: false, value: row }; }, async () => { returned++; return { done: true }; }), 16);
    await first(iterator); const requests = client.metrics.requests;
    if (name === 'paused-abort') controller.abort(new Error('PAUSED_ABORT'));
    await delay(30);
    assert.equal(reads, 1); assert.equal(client.metrics.requests, requests);
    if (name === 'paused-abort') {
      clean(client);
      assert.equal((await outcome(iterator.next())).error, controller.signal.reason);
    } else await iterator.return();
    assert.equal(reads, 1); assert.equal(returned, 1); clean(client); return;
  }
  if (['cooperative-pending-abort', 'late-read-rejection', 'pending-consumer-return'].includes(name)) {
    const controller = new AbortController(); const client = make(controller.signal);
    const waiting = deferred(); const read = deferred(); let reads = 0; let returned = 0; let pendingRead = false;
    const source = sourceOf(async () => {
      if (++reads === 1) return { done: false, value: row };
      pendingRead = true; waiting.resolve();
      try { return await read.promise; } finally { pendingRead = false; }
    }, async () => { assert.equal(pendingRead, false, 'NO_RETURN_OVERLAP'); returned++; return { done: true }; });
    const iterator = client.stream(source, 16); await first(iterator);
    const pending = outcome(iterator.next()); await waiting.promise;
    let settled = false; void pending.then(() => { settled = true; });
    let returning;
    if (name === 'cooperative-pending-abort') {
      controller.signal.addEventListener('abort', () => read.reject(controller.signal.reason), { once: true });
      controller.abort(new Error('COOPERATIVE_ABORT'));
    } else if (name === 'late-read-rejection') {
      controller.abort(new Error('ABORT_BEFORE_LATE_READ'));
      await client.dispose(); clean(client); await delay(20);
      assert.equal(settled, false, 'UNCOOPERATIVE_READ_MUST_REMAIN_OWNED'); assert.equal(returned, 0);
      read.reject(new Error('LATE_READ_REJECTION'));
    } else {
      returning = outcome(iterator.return());
      await delay(20); assert.equal(settled, false); assert.equal(returned, 0);
      read.resolve({ done: false, value: row });
    }
    const result = await pending;
    if (name === 'cooperative-pending-abort') assert.equal(result.error, controller.signal.reason);
    if (name === 'late-read-rejection') assert.equal(result.error?.message, 'LATE_READ_REJECTION');
    if (returning) { assert.equal(result.value.done, false); assert.equal((await returning).value.done, true); }
    assert.equal(reads, 2); assert.equal(returned, 1); assert.equal(pendingRead, false); clean(client); return;
  }
  if (name === 'awaited-return') {
    const client = make(); const finish = deferred(); const started = deferred(); let returned = 0;
    const iterator = client.stream(sourceOf(async () => ({ done: false, value: row }), async () => { returned++; started.resolve(); await finish.promise; return { done: true }; }), 16);
    await first(iterator); let settled = false;
    const returning = iterator.return(); void returning.then(() => { settled = true; });
    await started.promise; clean(client); await delay(20); assert.equal(settled, false);
    finish.resolve(); await returning; assert.equal(returned, 1); return;
  }
  if (name === 'read-return-rejection' || name === 'return-rejection') {
    const client = make(); const readError = new Error('READ_FAILURE'); const returnError = new Error('RETURN_FAILURE');
    let reads = 0; let returned = 0;
    const iterator = client.stream(sourceOf(async () => { if (++reads === 1) return { done: false, value: row }; throw readError; }, async () => { returned++; throw returnError; }), 16);
    await first(iterator);
    const result = await outcome(name === 'read-return-rejection' ? iterator.next() : iterator.return());
    assert.equal(result.error, name === 'read-return-rejection' ? readError : returnError);
    assert.equal(returned, 1); clean(client); return;
  }
  if (name === 'node-stream-abort') {
    const controller = new AbortController(); const client = make(controller.signal);
    const source = new PassThrough({ objectMode: true, highWaterMark: 1, signal: controller.signal });
    cleanups.push(() => source.destroy());
    source.write(row);
    const iterator = client.stream(source, 16); await first(iterator);
    const pending = outcome(iterator.next()); await delay(10);
    controller.abort(new Error('NODE_STREAM_ABORT'));
    const result = await pending;
    assert.equal(result.error?.code, 'ABORT_ERR'); assert.equal(result.error?.cause, controller.signal.reason);
    assert.equal(source.destroyed, true); assert.equal(source.closed, true); clean(client); return;
  }
  if (name === 'empty-source') {
    const client = make(); let reads = 0; let returned = 0;
    const iterator = client.stream(sourceOf(async () => { reads++; return { done: true }; }, async () => { returned++; return { done: true }; }), 16);
    assert.equal((await iterator.next()).done, true); assert.equal(reads, 1); assert.equal(returned, 0);
    assert.equal(client.metrics.created, 0); clean(client); return;
  }
  if (name === 'explicit-batches') {
    const client = make();
    for (let batch = 0; batch < 3; batch++) assert.deepEqual((await client.batch([row, row])).hits, [...expectedHits, ...expectedHits]);
    assert.equal(client.metrics.created, 1); assert.equal(client.metrics.requests, 4);
    await client.dispose(); clean(client); return;
  }
  throw new Error('UNKNOWN_CASE');
}

process.send({ type: 'ready', name });
assert.equal((await once(process, 'message'))[0], 'go');
const started = performance.now(); let failure;
try { await benign(); }
catch (error) { failure = { message: error?.message ?? String(error), stack: error?.stack }; }
finally {
  for (const cleanup of cleanups) await cleanup();
  for (const client of clients) await client.dispose();
}
for (const client of clients) clean(client);
process.send({ type: 'done', name, failure, observations, cleanup: clients.map(snapshot), elapsedMs: performance.now() - started, memory: process.memoryUsage(), flags: process.execArgv });
process.disconnect();
