import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const tick = () => new Promise(resolveTick => setImmediate(resolveTick));
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const descriptor = { kind: 'grep', patterns: ['a'], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rows = [{ bytes: Uint8Array.of(97), all: true, terminated: true }];
let settings = {};
let instances = [];
class ControlledWorker extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = String(url); this.options = options; this.posts = []; this.terminated = false; this.terminationCalls = 0; this.refed = true;
    instances.push(this);
    if (!settings.startupStall) queueMicrotask(() => this.emit('message', settings.ready ?? { ready: true }));
  }
  ref() { this.refed = true; return this; }
  unref() { this.refed = false; return this; }
  postMessage(message) { this.posts.push(message); settings.post?.(this, message); }
  async terminate() {
    this.terminationCalls++;
    if (settings.terminationDelay) await delay(settings.terminationDelay);
    this.terminated = true;
    this.emit('exit', 1);
    return 1;
  }
  reply(message = this.posts.at(-1), results = [new Float64Array([0, 1])]) { this.emit('message', { id: message.id, results }); }
}
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
function clean(signal) {
  for (const worker of instances) {
    assert.equal(worker.terminated, true, 'all fake workers retired');
    for (const event of ['message', 'error', 'exit', 'messageerror']) assert.equal(worker.listenerCount(event), 0, `no ${event} listener after cleanup`);
    assert.ok(worker.terminationCalls <= 1, 'exactly once retirement');
  }
  if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0);
}

export async function runTransport(snapshot, caseCheck) {
  workerThreads.Worker = ControlledWorker;
  syncBuiltinESMExports();
  const { RegexExecutor } = await import(pathToFileURL(resolve(snapshot, 'dist/commands/regex-execution/client.js')));
  const { defaults, inputBytes } = await import(pathToFileURL(resolve(snapshot, 'dist/commands/regex-execution/protocol.js')));
  const check = async (name, callback) => caseCheck(name, async () => { settings = {}; instances = []; return callback(); });
  await check('default-policy-inspection', async () => {
    assert.equal(defaults.requestTimeoutMs, 1000); assert.equal(defaults.startupTimeoutMs, 3000); assert.equal(defaults.maxWorkers, 2);
    return defaults;
  });
  await check('preabort-no-construction', async () => {
    const executor = new RegexExecutor(); const controller = new AbortController(); const reason = new Error('preabort'); controller.abort(reason);
    assert.throws(() => executor.open(controller.signal), error => error === reason); assert.equal(instances.length, 0); await executor.dispose(); clean(controller.signal);
  });
  await check('default-no-caller-signal-safe-static-stall', async () => {
    const executor = new RegexExecutor(); const controller = new AbortController(); const session = executor.open(controller.signal);
    const start = performance.now();
    try {
      const result = await settle(session.run(descriptor, rows));
      const elapsed = performance.now() - start;
      assert.equal(result.error?.code, 'REQUEST_TIMEOUT'); assert.ok(elapsed >= 900 && elapsed < 2000); assert.equal(instances[0].terminated, true);
      return { elapsed, error: result.error.message, noRegexExecuted: true, callerNeverAborted: !controller.signal.aborted };
    } finally { await session.close(); await executor.dispose(); clean(controller.signal); }
  });
  await check('startup-short-safe-stall', async () => {
    settings.startupStall = true;
    const executor = new RegexExecutor({ startupTimeoutMs: 15 }); const controller = new AbortController(); const session = executor.open(controller.signal);
    try { const result = await settle(session.run(descriptor, rows)); assert.equal(result.error?.code, 'STARTUP_TIMEOUT'); assert.equal(instances[0].posts.length, 0); }
    finally { await session.close(); await executor.dispose(); clean(controller.signal); }
  });
  await check('fifo-cancel-bytes-overflow', async () => {
    const count = inputBytes(descriptor, rows, new AbortController().signal);
    const executor = new RegexExecutor({ maxWorkers: 1, maxQueuedRequests: 2, maxQueuedBytes: count * 2 });
    const controllers = Array.from({ length: 5 }, () => new AbortController()); const sessions = controllers.map(controller => executor.open(controller.signal));
    const results = [];
    try {
      results.push(settle(sessions[0].run(descriptor, rows))); await tick();
      results.push(settle(sessions[1].run(descriptor, rows))); results.push(settle(sessions[2].run(descriptor, rows)));
      const exhausted = await settle(sessions[3].run(descriptor, rows)); assert.equal(exhausted.error?.code, 'QUEUE_EXHAUSTED');
      const reason = new Error('remove middle queue'); controllers[1].abort(reason); assert.equal((await results[1]).error, reason);
      results.push(settle(sessions[4].run(descriptor, rows)));
      instances[0].reply(); assert.deepEqual((await results[0]).value, [[{ start: 0, end: 1 }]]); await tick();
      assert.equal(instances[0].posts.length, 2); instances[0].reply(); assert.ok((await results[2]).value); await tick();
      assert.equal(instances[0].posts.length, 3); instances[0].reply(); assert.ok((await results[3]).value);
      assert.equal(instances.length, 1);
      return { byteAccounting: count, dispatchedIds: instances[0].posts.map(post => post.id), cancelledNeverDispatched: true };
    } finally { for (const controller of controllers) controller.abort(); await Promise.all(sessions.map(session => session.close())); await executor.dispose(); controllers.forEach(controller => clean(controller.signal)); }
  });
  await check('descriptor-and-row-byte-limit', async () => {
    const bytes = inputBytes(descriptor, rows, new AbortController().signal);
    assert.equal(bytes, 128 + 16 + 2 + 32 + 1);
    const executor = new RegexExecutor({ maxWorkers: 1, maxQueuedRequests: 10, maxQueuedBytes: bytes - 1 });
    const controller = new AbortController(); const first = executor.open(controller.signal); const second = executor.open(controller.signal);
    const pending = settle(first.run(descriptor, rows));
    try { await tick(); const result = await settle(second.run(descriptor, rows)); assert.equal(result.error?.code, 'QUEUE_EXHAUSTED'); instances[0].reply(); await pending; return { independentlyExpectedBytes: 128 + 16 + 2 + 32 + 1, actualBytes: bytes }; }
    finally { controller.abort(); await pending; await first.close(); await second.close(); await executor.dispose(); clean(controller.signal); }
  });
  await check('default-two-workers-and-independent-executors', async () => {
    const first = new RegexExecutor(); const second = new RegexExecutor(); const controller = new AbortController();
    const sessions = [first.open(controller.signal), first.open(controller.signal), first.open(controller.signal), second.open(controller.signal)];
    const results = sessions.map(session => settle(session.run(descriptor, rows)));
    try { await tick(); assert.equal(instances.length, 3); instances.forEach(worker => worker.reply()); await tick(); assert.equal(instances[0].posts.length, 2); instances[0].reply(); await Promise.all(results); }
    finally { controller.abort(); await Promise.all(results); await Promise.all(sessions.map(session => session.close())); await first.dispose(); await second.dispose(); clean(controller.signal); }
  });
  await check('active-abort-waits-termination-before-admitting-next', async () => {
    settings.terminationDelay = 25;
    const executor = new RegexExecutor({ maxWorkers: 1 }); const firstController = new AbortController(); const secondController = new AbortController();
    const first = executor.open(firstController.signal); const second = executor.open(secondController.signal);
    const pending = settle(first.run(descriptor, rows)); const queued = settle(second.run(descriptor, rows)); let settled = false; pending.then(() => { settled = true; });
    try {
      await tick(); const reason = new Error('active cancellation'); firstController.abort(reason); await delay(5);
      assert.equal(instances.length, 1); assert.equal(settled, false); assert.equal(instances[0].terminated, false);
      assert.equal((await pending).error, reason); assert.equal(instances[0].terminated, true); await tick(); assert.equal(instances.length, 2);
      instances[1].reply(); assert.ok((await queued).value);
    } finally { firstController.abort(); secondController.abort(); await Promise.all([pending, queued]); await first.close(); await second.close(); await executor.dispose(); clean(firstController.signal); clean(secondController.signal); }
  });
  for (const fault of ['wrong-id', 'odd-ranges', 'out-of-bounds', 'fatal', 'messageerror']) await check(`worker-${fault}`, async () => {
    settings.terminationDelay = 5;
    const executor = new RegexExecutor({ requestTimeoutMs: 40 }); const controller = new AbortController(); const session = executor.open(controller.signal);
    const pending = settle(session.run(descriptor, rows));
    try {
      await tick(); const worker = instances[0]; const sent = worker.posts[0];
      if (fault === 'wrong-id') worker.emit('message', { id: sent.id + 1, results: [] });
      if (fault === 'odd-ranges') worker.reply(sent, [new Float64Array([0])]);
      if (fault === 'out-of-bounds') worker.reply(sent, [new Float64Array([0, 2])]);
      if (fault === 'fatal') worker.emit('error', new Error('controlled worker fatal'));
      if (fault === 'messageerror') worker.emit('messageerror', new Error('controlled deserialization failure'));
      const result = await pending;
      assert.ok(result.error); assert.equal(worker.terminated, true);
      assert.equal(result.error.code, fault === 'fatal' ? 'WORKER_ERROR' : 'PROTOCOL');
      return { code: result.error.code, error: result.error.message };
    } finally { controller.abort(); await pending; await session.close(); await executor.dispose(); clean(controller.signal); }
  });
  await check('idle-fatal-retirement', async () => {
    const executor = new RegexExecutor(); const controller = new AbortController(); const session = executor.open(controller.signal);
    const pending = session.run(descriptor, rows);
    try { await tick(); instances[0].reply(); await pending; instances[0].emit('error', new Error('idle fatal')); await tick(); assert.equal(instances[0].terminated, true); }
    finally { await session.close(); await executor.dispose(); clean(controller.signal); }
  });
  await check('timeout-then-abort-during-awaited-cleanup', async () => {
    settings.terminationDelay = 30;
    const executor = new RegexExecutor({ requestTimeoutMs: 10 }); const controller = new AbortController(); const session = executor.open(controller.signal);
    const pending = settle(session.run(descriptor, rows));
    try { await delay(20); controller.abort(new Error('late abort after timeout')); const result = await pending; assert.equal(result.error?.code, 'REQUEST_TIMEOUT'); assert.equal(instances[0].terminated, true); return { precedence: 'first timeout retained after cleanup-time abort' }; }
    finally { await session.close(); await executor.dispose(); clean(controller.signal); }
  });
}
