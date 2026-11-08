import assert from 'node:assert/strict';
import { once, getEventListeners } from 'node:events';
import { Client, Capacity } from './.temporary/fixed/tests/stress/regex-execution/design/review/.temporary/js/tests/stress/regex-execution/design/client.js';
import { caps } from './.temporary/fixed/tests/stress/regex-execution/design/review/.temporary/js/tests/stress/regex-execution/design/protocol.js';

export const cases = ['exit-active', 'error-active', 'exit-error-abort-race', 'partial-live-close', 'pending-source-reject', 'pending-source-abort', 'uncooperative-pending-abort', 'downstream-close-pending', 'downstream-throw', 'single-next-order', 'batch-byte-cap', 'capacity-policy'];
const name = process.argv[2];
assert(process.send && cases.includes(name), 'STATIC_BENIGN_GUARD_ONLY');
const clients = [];
const observations = [];
const row = { text: 'r', all: true };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const settled = promise => promise.then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', error: String(error?.message ?? error) }));
const make = (capacity = new Capacity(), signal) => { const client = new Client([{ source: 'r', flags: 'g' }], capacity, signal); clients.push(client); return client; };
const snapshot = client => ({ metrics: { ...client.metrics }, pending: Boolean(client.pending), busy: client.busy, releaseHeld: Boolean(client.release), capacity: client.capacity.active, thread: client.worker?.threadId ?? null, listeners: client.worker ? Object.fromEntries(['message', 'error', 'exit', 'messageerror'].map(event => [event, client.worker.listenerCount(event)])) : {}, stdoutListeners: client.worker?.stdout.listenerCount('data') ?? 0, stderrListeners: client.worker?.stderr.listenerCount('data') ?? 0, signalListeners: client.signal ? getEventListeners(client.signal, 'abort').length : 0 });
const record = (label, value) => { observations.push({ label, value }); return value; };
const clean = client => {
  const state = record('cleanup-before-outer-finally', snapshot(client));
  assert.equal(state.metrics.created, state.metrics.terminated); assert.equal(state.metrics.listenersAfter, 0);
  assert.equal(state.pending, false); assert.equal(state.busy, false); assert.equal(state.releaseHeld, false); assert.equal(state.capacity, 0);
  assert.equal(state.signalListeners, 0); assert.equal(state.stdoutListeners, 0); assert.equal(state.stderrListeners, 0);
  assert(Object.values(state.listeners).every(count => count === 0));
  if (client.worker) assert.equal(state.thread, -1);
};
const controlled = (initial = [], signal) => {
  let reads = 0; let returns = 0; let outstanding = 0; let maximum = 0; let resolvePending; let rejectPending;
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      reads++; outstanding++; maximum = Math.max(maximum, outstanding); assert.equal(outstanding, 1, 'OVERLAPPING_SOURCE_NEXT');
      if (initial.length) { outstanding--; return Promise.resolve({ done: false, value: initial.shift() }); }
      return new Promise((resolve, reject) => { resolvePending = value => { outstanding--; resolvePending = undefined; rejectPending = undefined; resolve(value); }; rejectPending = error => { outstanding--; resolvePending = undefined; rejectPending = undefined; reject(error); }; });
    },
    async return() { returns++; signal?.removeEventListener('abort', abort); rejectPending?.(new Error('SOURCE_CLOSED')); return { done: true }; },
  };
  const abort = () => rejectPending?.(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  return { source, state: () => ({ reads, returns, outstanding, maximum }), reject: message => { assert(rejectPending, 'EXPECTED_PENDING_SOURCE'); rejectPending(new Error(message)); }, deliver: () => resolvePending?.({ done: false, value: row }), finish: () => resolvePending?.({ done: true }) };
};

async function run() {
  if (['exit-active', 'error-active', 'exit-error-abort-race'].includes(name)) {
    const controller = new AbortController(); const client = make(undefined, controller.signal); await client.ready();
    const pending = settled(client.batch([row])); await Promise.resolve(); assert(client.pending);
    if (name === 'exit-active') {
      client.worker.emit('exit', 23);
      assert.equal((await pending).error, 'WORKER_EXIT');
    } else if (name === 'error-active') {
      client.worker.emit('error', new Error('GUARD_WORKER_ERROR'));
      assert.equal((await pending).error, 'GUARD_WORKER_ERROR');
    } else {
      client.worker.emit('exit', 24); client.worker.emit('error', new Error('GUARD_RACING_ERROR')); controller.abort(new Error('GUARD_RACING_ABORT'));
      assert.equal((await pending).error, 'WORKER_EXIT');
    }
    clean(client); await Promise.all([client.dispose(), client.dispose()]); clean(client);
    assert.equal(client.metrics.created, 1); assert.equal(client.metrics.terminated, 1); return;
  }
  if (name === 'partial-live-close') {
    const client = make(); await client.ready(); const control = controlled([row]); const iterator = client.stream(control.source, 16);
    const first = await Promise.race([settled(iterator.next()), delay(100).then(() => ({ status: 'timeout' }))]);
    record('first-without-eof', { first, source: control.state(), client: snapshot(client) });
    assert.equal(first.status, 'fulfilled'); assert.equal(first.value.done, false); assert.equal(first.value.value.hits.length, 1);
    const before = control.state(); await delay(20); assert.deepEqual(control.state(), before); assert(before.reads <= 2);
    await iterator.return(); await delay(10); record('source-after-close', control.state());
    assert.equal(control.state().returns, 1); assert.equal(control.state().outstanding, 0); clean(client); return;
  }
  if (name === 'pending-source-reject' || name === 'pending-source-abort') {
    const controller = new AbortController(); const client = make(undefined, controller.signal); await client.ready();
    const control = controlled([], name === 'pending-source-abort' ? controller.signal : undefined); const iterator = client.stream(control.source, 16); const pending = settled(iterator.next());
    await delay(10); assert.equal(control.state().outstanding, 1);
    if (name === 'pending-source-reject') control.reject('GUARD_SOURCE_FAILURE'); else controller.abort(new Error('GUARD_SOURCE_ABORT'));
    const outcome = await Promise.race([pending, delay(100).then(() => ({ status: 'timeout' }))]);
    record('pending-read-settlement', { outcome, source: control.state(), client: snapshot(client) });
    assert.equal(outcome.error, name === 'pending-source-reject' ? 'GUARD_SOURCE_FAILURE' : 'GUARD_SOURCE_ABORT');
    assert.equal(control.state().returns, 1); assert.equal(control.state().outstanding, 0); clean(client); return;
  }
  if (name === 'uncooperative-pending-abort') {
    const controller = new AbortController(); const client = make(undefined, controller.signal); await client.ready();
    const control = controlled(); const iterator = client.stream(control.source, 16); let hasSettled = false;
    const pending = settled(iterator.next()).then(outcome => { hasSettled = true; return outcome; });
    await delay(10); controller.abort(new Error('GUARD_SOURCE_ABORT')); await delay(30);
    record('uncooperative-read-after-abort', { hasSettled, source: control.state(), client: snapshot(client) });
    assert.equal(hasSettled, false); assert.equal(control.state().outstanding, 1); assert.equal(control.state().returns, 0); clean(client);
    control.reject('GUARD_SOURCE_ABORT'); assert.equal((await pending).error, 'GUARD_SOURCE_ABORT');
    assert.equal(control.state().returns, 1); assert.equal(control.state().outstanding, 0); clean(client); return;
  }
  if (name === 'downstream-close-pending') {
    const client = make(); await client.ready(); const control = controlled(); const iterator = client.stream(control.source, 16);
    const pending = settled(iterator.next()); await delay(10); let closeSettled = false;
    const closing = settled(iterator.return()).then(outcome => { closeSettled = true; return outcome; }); await delay(20);
    record('return-queued-behind-owned-next', { closeSettled, source: control.state() });
    assert.equal(closeSettled, false); assert.equal(control.state().returns, 0); assert.equal(control.state().outstanding, 1);
    control.deliver(); assert.equal((await pending).value.done, false); assert.equal((await closing).value.done, true);
    assert.equal(control.state().returns, 1); assert.equal(control.state().outstanding, 0); clean(client); return;
  }
  if (name === 'downstream-throw') {
    const client = make(); const control = controlled([row]);
    const outcome = await settled((async () => { for await (const result of client.stream(control.source, 8)) { assert.equal(result.hits.length, 1); throw new Error('GUARD_DOWNSTREAM'); } })());
    assert.equal(outcome.error, 'GUARD_DOWNSTREAM'); await delay(10); record('source-after-downstream-throw', control.state());
    assert.equal(control.state().returns, 1); assert.equal(control.state().outstanding, 0); clean(client); return;
  }
  if (name === 'single-next-order') {
    const client = make(); let outstanding = 0; let maximum = 0; let reads = 0; let returns = 0;
    const source = { [Symbol.asyncIterator]() { return this; }, async next() { outstanding++; maximum = Math.max(maximum, outstanding); assert.equal(outstanding, 1); const ordinal = reads++; await delay(2); outstanding--; return ordinal === 7 ? { done: true } : { done: false, value: { text: 'r'.repeat(ordinal + 1), all: true } }; }, async return() { returns++; return { done: true }; } };
    const output = []; for await (const result of client.stream(source, 3)) { output.push(...result.hits.map(hits => hits.length)); await delay(2); }
    record('ordered-source-ownership', { output, reads, returns, maximum, outstanding });
    assert.deepEqual(output, [1, 2, 3, 4, 5, 6, 7]); assert.equal(reads, 8); assert.equal(maximum, 1); assert.equal(outstanding, 0); clean(client); return;
  }
  if (name === 'batch-byte-cap') {
    const client = make(); const widths = [caps.subjectBytes / 4 + 1, caps.subjectBytes / 4 + 1, 1];
    const source = (async function* () { for (const width of widths) yield { text: 'x'.repeat(width), all: false }; })();
    const batches = []; for await (const result of client.stream(source, caps.rows)) batches.push(result.hits.length);
    record('bounded-batches', { batches, client: snapshot(client) }); assert.equal(batches.reduce((total, count) => total + count, 0), 3); assert(batches.length >= 2); clean(client); return;
  }
  if (name === 'capacity-policy') {
    const capacity = new Capacity(); const holder = make(capacity); await holder.ready(); await delay(20);
    assert.equal(capacity.active, 1); assert.equal(holder.pending, undefined);
    const rejected = make(capacity); assert.equal((await settled(rejected.ready())).error, 'CAPACITY_BUSY'); assert.equal(rejected.metrics.created, 0);
    const independent = make(); await independent.batch([row]); await independent.dispose(); clean(independent);
    const first = settled(holder.batch([row])); assert.equal((await settled(holder.batch([row]))).error, 'BUSY'); assert.equal((await first).status, 'fulfilled');
    record('explicit-failfast-no-global-singleton-idle-slot-retained', { holder: snapshot(holder), rejected: snapshot(rejected) });
    await holder.worker.terminate(); await delay(40); clean(holder);
    const successor = make(capacity); await successor.batch([row]); await successor.dispose(); clean(successor); return;
  }
  throw new Error('UNKNOWN_GUARD');
}

process.send({ type: 'ready', name });
assert.equal((await once(process, 'message'))[0], 'go');
let failure; const start = performance.now();
try { await run(); } catch (error) { failure = { message: error.message, stack: error.stack }; }
finally { for (const client of clients) await client.dispose(); }
process.send({ type: 'done', name, failure, observations, cleanup: clients.map(snapshot), elapsedMs: performance.now() - start, memory: process.memoryUsage(), flags: process.execArgv });
process.disconnect();
