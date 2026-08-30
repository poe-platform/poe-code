import assert from 'node:assert/strict';
import { getEventListeners, once } from 'node:events';
import { Client, Capacity } from './.temporary/js/tests/stress/regex-execution/design/client.js';
import { compile, scan } from './.temporary/js/tests/stress/regex-execution/design/matching.js';
import { caps } from './.temporary/js/tests/stress/regex-execution/design/protocol.js';
import { grepCommands } from './.temporary/js/src/commands/grep.js';
import { Matcher } from './.temporary/js/src/commands/search/matcher.js';
import { parse } from './.temporary/js/src/commands/search/options.js';
import { Pattern } from './.temporary/js/src/commands/text-programs/regex.js';
import { Budget } from './.temporary/js/src/commands/text-programs/shared.js';
import { scenarios, risks, risk, captures } from './fixtures.mjs';

const [name] = process.argv.slice(2);
assert(process.send && [...scenarios, ...risks].includes(name), 'FIXED_REVIEW_CHILD_ONLY');
const clients = [];
const observations = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const settled = promise => promise.then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', error: String(error?.message ?? error) }));
const make = (patterns = [{ source: 'r', flags: 'g' }], capacity = new Capacity(), signal) => {
  const client = new Client(patterns, capacity, signal);
  clients.push(client);
  return client;
};
const row = { text: 'r', all: true };
const snapshot = client => ({
  metrics: { ...client.metrics }, pending: Boolean(client.pending), busy: client.busy,
  releaseHeld: Boolean(client.release), capacityActive: client.capacity.active,
  workerThreadId: client.worker?.threadId ?? null,
  workerListeners: client.worker ? Object.fromEntries(['message', 'error', 'exit', 'messageerror'].map(event => [event, client.worker.listenerCount(event)])) : {},
  signalListeners: client.signal ? getEventListeners(client.signal, 'abort').length : 0,
});
const record = (label, value) => { observations.push({ label, value }); return value; };
const clean = client => {
  assert.equal(client.metrics.created, client.metrics.terminated);
  assert.equal(client.metrics.listenersAfter, 0);
  assert.equal(client.pending, undefined);
  assert.equal(client.release, undefined);
  assert.equal(client.capacity.active, 0);
  assert.equal(client.signal ? getEventListeners(client.signal, 'abort').length : 0, 0);
  if (client.worker) assert.equal(client.worker.threadId, -1);
};
const compact = hits => hits.map(hit => [hit.start, hit.end, hit.captures]);
const nativeWorker = async (patterns, rows, expected) => {
  const direct = scan(compile(patterns), rows);
  assert.deepEqual(direct.hits.map(compact), expected);
  const client = make(patterns);
  const actual = await client.batch(rows);
  record('native-and-worker', { patterns, rows, direct, actual });
  assert.deepEqual(actual, direct);
  await client.dispose(); clean(client);
};
const matcher = (patterns, extra = []) => new Matcher(patterns, parse([...extra, ...patterns.flatMap(source => ['-e', source]), '-']));
const grep = async (args, text) => {
  const stdout = []; const stderr = []; let total = 0;
  const sink = target => ({ write: async bytes => { total += bytes.length; assert(total < 16384); target.push(Buffer.from(bytes)); } });
  const outcome = await grepCommands()[0].execute({ command: 'grep', args, cwd: '/', env: {}, fs: Object.freeze({}), signal: new AbortController().signal, stdinIsDefault: false, stdin: (async function* () { yield Buffer.from(text); })(), stdout: sink(stdout), stderr: sink(stderr) });
  return { exitCode: outcome.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
};

async function benign() {
  if (name === 'captures') return nativeWorker([captures.descriptor], [captures.input], [captures.expected]);
  if (name === 'unicode') {
    await nativeWorker([{ source: '(σ)', flags: 'gui' }], [{ text: 'Σς', all: true }], [[[0, 1, ['Σ', 'Σ']], [1, 2, ['ς', 'ς']]]]);
    for (const [flags, offsets] of [['g', [0, 1, 2, 3]], ['gu', [0, 2, 3]]]) await nativeWorker([{ source: '', flags }], [{ text: '𝄞x', all: true }], [offsets.map(offset => [offset, offset, ['']])]);
    return;
  }
  if (name === 'selection') {
    await nativeWorker([{ source: '(r|rs)', flags: 'g' }], [{ text: 'rs', all: false }], [[[0, 1, ['r', 'r']]]]);
    const bounded = new Pattern('(r|rs)').find('rs', new Budget({ signal: new AbortController().signal }, { maxSteps: 10000, maxBufferBytes: 1048576 }));
    record('bounded-byte-selection-not-native-equivalence', bounded);
    assert.equal(bounded.end, 2);
    const entries = [{ source: 'z', flags: 'g' }, { source: 'r', flags: 'g' }];
    await nativeWorker(entries, [{ text: 'rz', all: false }, { text: 'rz', all: true }], [[[1, 2, ['z']]], [[1, 2, ['z']], [0, 1, ['r']]]]);
    const currentGrep = record('grep-ordered-print-selection', await grep(['-E', '-o', '-e', 'z', '-e', 'r', '-'], 'rz\n'));
    assert.deepEqual(currentGrep, { exitCode: 0, stdout: 'r\nz\n', stderr: '' });
    assert.deepEqual(record('rg-combined-first', matcher(['z', 'r']).matches(Buffer.from('rz'), false)), [{ start: 0, end: 1 }]);
    return;
  }
  if (name === 'dialects') {
    for (const [args, text, exitCode, stdout] of [
      [['-o', '\\(r\\)\\1'], 'rr\n', 0, 'rr\n'],
      [['-E', '-o', '[[:upper:]]'], 'R\n', 0, 'R\n'],
      [['-E', '(?:r)'], 'r\n', 2, ''],
      [['-E', '-w', '-o', 'r'], 'xr r\n', 0, 'r\n'],
    ]) {
      const actual = record('grep-dialect', { args, result: await grep([...args, '-'], text) }).result;
      assert.equal(actual.exitCode, exitCode); assert.equal(actual.stdout, stdout);
    }
    assert.deepEqual(record('rg-named-reference', matcher(['(?<unit>r)\\k<unit>']).matches(Buffer.from('rr'))), [{ start: 0, end: 2 }]);
    for (const source of ['(r)\\1', '(?<=r)s']) assert.throws(() => matcher([source]), /backreferences and look-around/);
    assert.deepEqual(record('rg-empty-unterminated-bytes', matcher(['']).matches(Buffer.from('𝄞'), true, false)), [0, 1, 2, 3].map(offset => ({ start: offset, end: offset })));
    assert.deepEqual(record('rg-invalid-byte-anchors', matcher(['^b|a$']).matches(Uint8Array.from([97, 255, 98]))), []);
    return;
  }
  if (name === 'preabort') {
    const controller = new AbortController(); controller.abort(new Error('REVIEW_PREABORT'));
    const client = make([{ source: '[', flags: 'g' }], new Capacity(), controller.signal);
    for (const action of [() => client.ready(), () => client.batch([row]), () => client.stream((async function* () { throw new Error('SOURCE_READ'); })(), 1).next()]) assert.equal((await settled(action())).error, 'REVIEW_PREABORT');
    record('before-manual-cleanup', snapshot(client));
    assert.equal(client.metrics.created, 0); assert.equal(client.metrics.requests, 0); assert.equal(client.worker, undefined); assert.equal(client.capacity.active, 0);
    return;
  }
  if (name === 'startup-abort') {
    const controller = new AbortController(); const client = make(undefined, new Capacity(), controller.signal);
    const pending = settled(client.ready()); controller.abort(new Error('REVIEW_STARTUP_ABORT'));
    const outcome = record('settlement', await pending); record('at-settlement-before-finally', snapshot(client));
    assert.equal(outcome.error, 'REVIEW_STARTUP_ABORT'); assert.equal(client.metrics.requests, 0); clean(client); return;
  }
  if (name === 'idle-abort' || name === 'idle-error' || name === 'idle-exit') {
    const controller = new AbortController(); const client = make(undefined, new Capacity(), controller.signal);
    await client.ready();
    if (name === 'idle-abort') controller.abort(new Error('REVIEW_IDLE_ABORT'));
    if (name === 'idle-error') client.worker.emit('error', new Error('REVIEW_INJECTED_IDLE_ERROR'));
    if (name === 'idle-exit') record('actual-external-worker-termination', await client.worker.terminate());
    await delay(40);
    record('automatic-before-manual-cleanup', snapshot(client)); clean(client); return;
  }
  if (name === 'paused-abort' || name === 'consumer-return') {
    const controller = new AbortController(); const client = make(undefined, new Capacity(), controller.signal);
    let reads = 0; let returned = 0;
    const source = { [Symbol.asyncIterator]() { return this; }, async next() { reads++; return { done: false, value: row }; }, async return() { returned++; return { done: true }; } };
    const iterator = client.stream(source, 1);
    try {
      assert.equal((await iterator.next()).done, false);
      const requests = client.metrics.requests;
      if (name === 'paused-abort') controller.abort(new Error('REVIEW_PAUSED_ABORT'));
      await delay(40);
      record('paused-before-return', { reads, returned, requests, client: snapshot(client) });
      assert.equal(reads, 1); assert.equal(client.metrics.requests, requests);
      if (name === 'paused-abort') clean(client);
    } finally { await iterator.return(); }
    clean(client); assert.equal(reads, 1); assert.equal(returned, 1);
    record('after-consumer-return', { reads, returned, client: snapshot(client) });
    if (name === 'consumer-return') {
      const reusable = make();
      for (let batch = 0; batch < 3; batch++) await reusable.batch([row]);
      assert.equal(reusable.metrics.created, 1); assert.equal(reusable.metrics.requests, 4);
      record('three-batches-one-worker', snapshot(reusable)); await reusable.dispose(); clean(reusable);
    }
    return;
  }
  if (name === 'malformed') {
    const client = make(); await client.ready();
    const pending = settled(client.batch([row])); await Promise.resolve();
    assert(client.pending); client.worker.emit('message', { id: client.sequence, ok: true, data: null, extra: true });
    assert.equal(record('malformed-reply', await pending).error, 'RESPONSE_PROTOCOL'); clean(client);
    const invalid = make([{ source: '[', flags: 'g' }]);
    const outcome = record('compile-error', await settled(invalid.batch([row])));
    assert.equal(outcome.status, 'rejected'); assert.match(outcome.error, /Invalid regular expression/); clean(invalid); return;
  }
  if (name === 'caps') {
    for (const [patterns, input, expected] of [
      [[{ source: 'r', flags: 'g' }], Array.from({ length: caps.rows + 1 }, () => row), 'INPUT_CAP_OR_PROTOCOL'],
      [Array.from({ length: caps.patterns + 1 }, () => ({ source: '', flags: 'g' })), [row], 'PATTERN_CAP_OR_PROTOCOL'],
      [Array.from({ length: caps.patterns }, () => ({ source: '', flags: 'g' })), Array.from({ length: caps.rows }, () => ({ text: 'x', all: true })), 'RESULT_CAP'],
    ]) {
      const client = make(patterns); const outcome = await settled(client.batch(input));
      record('cap-rejection', { expected, outcome, client: snapshot(client) }); assert.equal(outcome.error, expected); clean(client);
    }
    return;
  }
  if (name === 'live-source') {
    const client = make(); let reads = 0; let returned = 0; let unblock;
    const source = { [Symbol.asyncIterator]() { return this; }, next() { reads++; return reads === 1 ? Promise.resolve({ done: false, value: row }) : new Promise(resolve => { unblock = resolve; }); }, async return() { returned++; return { done: true }; } };
    const iterator = client.stream(source, 16); const pending = settled(iterator.next());
    try {
      const first = await Promise.race([pending, delay(40).then(() => ({ status: 'observation-timeout' }))]);
      record('before-unblock', { first, reads, returned, client: snapshot(client) });
      assert.equal(first.status, 'fulfilled', 'First ordinary output must not wait for a full batch or EOF');
      assert.equal(first.value.done, false);
    } finally {
      unblock?.({ done: true }); record('after-explicit-source-unblock', await pending); await iterator.return(); await source.return();
      record('source-cleanup', { reads, returned, client: snapshot(client) });
    }
    return;
  }
  if (name === 'capacity') {
    const capacity = new Capacity(); const holder = make(undefined, capacity); await holder.ready();
    const contenders = [make(undefined, capacity), make(undefined, capacity)];
    const outcomes = await Promise.all(contenders.map(client => settled(client.ready())));
    record('failfast-not-queue', { outcomes, clients: contenders.map(snapshot), holder: snapshot(holder) });
    assert.deepEqual(outcomes.map(outcome => outcome.error), ['CAPACITY_BUSY', 'CAPACITY_BUSY']);
    assert(contenders.every(client => client.metrics.created === 0));
    const first = settled(holder.batch([row])); const second = await settled(holder.batch([row]));
    assert.equal(second.error, 'BUSY'); assert.equal((await first).status, 'fulfilled');
    await holder.dispose(); const successor = make(undefined, capacity); await successor.batch([row]); await successor.dispose(); clean(successor); return;
  }
  if (name === 'dispose-late') {
    const controller = new AbortController(); const client = make(undefined, new Capacity(), controller.signal); await client.ready();
    const lateError = client.error; const lateMessage = client.message;
    await Promise.all([client.dispose(), client.dispose(), client.dispose()]);
    lateError(new Error('REVIEW_LATE_HANDLER')); lateMessage({ id: 1, ok: true, data: null }); controller.abort(new Error('REVIEW_LATE_ABORT'));
    await delay(20); record('idempotent-and-late', snapshot(client)); clean(client); assert.equal(client.metrics.terminated, 1);
    const release = client.capacity.acquire(); assert.throws(() => client.capacity.acquire(), /CAPACITY_BUSY/); release(); assert.equal(client.capacity.active, 0); return;
  }
  throw new Error('UNKNOWN_STATIC_CASE');
}

let riskClient; let riskController;
if (risks.includes(name)) {
  assert.equal(Buffer.byteLength(risk.text), risk.bytes);
  riskController = name === 'risk-abort' ? new AbortController() : undefined;
  riskClient = make([{ source: risk.source, flags: 'g' }], new Capacity(), riskController?.signal);
  await riskClient.ready();
}
process.send({ type: 'ready', name });
const [message] = await once(process, 'message'); assert.equal(message, 'go');
const started = performance.now(); let heartbeats = 0; let maxGap = 0; let previous = started;
const heartbeat = setInterval(() => { const now = performance.now(); heartbeats++; maxGap = Math.max(maxGap, now - previous); previous = now; }, 5);
let failure; let abortTimer;
try {
  if (riskClient) {
    if (riskController) abortTimer = setTimeout(() => { record('abort-at-ms', performance.now() - started); riskController.abort(new Error('REVIEW_INFLIGHT_ABORT')); }, 20);
    record('risk-allocation', { name, source: risk.source, bytes: risk.bytes, executions: 1 });
    const outcome = await settled(riskClient.batch([{ text: risk.text, all: false }]));
    record('at-request-settlement-before-finally', { outcome, elapsedMs: performance.now() - started, heartbeats, maxGap, client: snapshot(riskClient) });
    assert.equal(outcome.error, riskController ? 'REVIEW_INFLIGHT_ABORT' : 'WORK_DEADLINE'); clean(riskClient);
    assert.equal(riskClient.metrics.created, 1); assert.equal(riskClient.metrics.requests, 2); assert(heartbeats > 0);
    if (riskController) assert(performance.now() - started < caps.batchMs, 'Explicit abort must settle before default deadline');
  } else await benign();
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  clearTimeout(abortTimer); clearInterval(heartbeat);
  for (const client of clients) await client.dispose();
}
const cleanup = clients.map(snapshot);
for (const client of clients) clean(client);
process.send({ type: 'done', name, failure, observations, elapsedMs: performance.now() - started, heartbeats, maxGap, cleanup, memory: process.memoryUsage(), flags: process.execArgv });
process.disconnect();
