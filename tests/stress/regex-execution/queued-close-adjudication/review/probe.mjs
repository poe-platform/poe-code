import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { after, test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";

const workerModule = createRequire(import.meta.url)("node:worker_threads");
const nativeWorker = workerModule.Worker;
const eventNames = ["message", "messageerror", "error", "exit"];
const descriptor = { kind: "grep", patterns: ["a"], fixed: true, extended: false, insensitive: false, whole: false, word: false };
const rows = [{ bytes: Uint8Array.of(97), all: true, terminated: true }];
const expected = [[{ start: 0, end: 1 }]];
const transports = [];
let current;
let finishedFixtures = 0;
const settle = promise => promise.then(value => ({ value }), error => ({ error }));

class FakeWorker extends EventEmitter {
  posts = [];
  terminationCalls = 0;
  terminated = false;
  constructor() {
    super();
    this.gate = new Promise(resolve => { this.release = resolve; });
    current.workers.push(this);
    transports.push(this);
    queueMicrotask(() => this.emit("message", { ready: true }));
  }
  ref() { return this; }
  unref() { return this; }
  postMessage(message) { this.posts.push(message); }
  reply() {
    assert.ok(this.posts.length);
    this.emit("message", { id: this.posts.at(-1).id, results: [new Float64Array([0, 1])] });
  }
  async terminate() {
    this.terminationCalls++;
    await this.gate;
    this.terminated = true;
    this.emit("exit", 1);
    return 1;
  }
}

workerModule.Worker = FakeWorker;
syncBuiltinESMExports();
const { RegexExecutor, RegexExecutionError, withRegexSession } = await import("./.generated/client.js");

function closed(error) {
  assert.ok(error instanceof RegexExecutionError);
  assert.equal(error.code, "CLOSED");
  assert.equal(Object.hasOwn(error, "exitCode"), false);
  return true;
}

async function fixture(execute) {
  const executor = new RegexExecutor({ maxWorkers: 1, idleTimeoutMs: 10000 });
  const workers = [];
  const sessions = [];
  const signals = [];
  const pending = [];
  const track = session => {
    sessions.push(session);
    signals.push(session.requestSignal);
    return session;
  };
  const open = signal => { signals.push(signal); return track(executor.open(signal)); };
  const observe = promise => { const result = settle(promise); pending.push(result); return result; };
  current = { workers };
  try { await execute({ executor, workers, open, track, observe }); }
  finally {
    const disposing = executor.dispose();
    for (const worker of workers) worker.release();
    await Promise.all([disposing, ...sessions.map(session => session.close())]);
    await Promise.all(pending);
    for (const worker of workers) {
      assert.equal(worker.terminated, true);
      assert.equal(worker.terminationCalls, 1);
      for (const event of eventNames) assert.equal(worker.listenerCount(event), 0, event);
    }
    for (const signal of signals) assert.equal(getEventListeners(signal, "abort").length, 0);
    finishedFixtures++;
  }
}

test("retained idle ordering: CLOSED queue, shared close awaits exact retirement, no replacement", { timeout: 1500 }, async () => {
  await fixture(async ({ workers, open, observe }) => {
    const controller = new AbortController();
    const first = open(controller.signal);
    const second = open(controller.signal);
    const initial = observe(first.run(descriptor, rows));
    await tick();
    workers[0].reply();
    assert.deepEqual((await initial).value, expected);
    workers[0].emit("messageerror", new Error("idle receive"));
    workers[0].emit("messageerror", new Error("duplicate idle receive"));
    await tick();
    assert.equal(workers[0].terminationCalls, 1);
    const queued = observe(second.run(descriptor, rows));
    await first.close();
    const closing = second.close();
    assert.equal(second.close(), closing);
    assert.throws(() => second.run(descriptor, rows), closed);
    let complete = false;
    void closing.then(() => { complete = true; });
    await tick();
    closed((await queued).error);
    assert.equal(workers.length, 1);
    assert.equal(complete, false);
    assert.equal(workers[0].terminated, false);
    workers[0].release();
    await closing;
    await tick();
    assert.equal(complete, true);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].posts.length, 1);
    assert.throws(() => second.run(descriptor, rows), closed);
  });
});

test("positive unclosed queue: capacity held until retirement, replacement returns exact ranges", { timeout: 1500 }, async () => {
  await fixture(async ({ workers, open, observe }) => {
    const controller = new AbortController();
    const first = open(controller.signal);
    const second = open(controller.signal);
    const initial = observe(first.run(descriptor, rows));
    await tick();
    workers[0].reply();
    await initial;
    workers[0].emit("messageerror", new Error("idle receive"));
    workers[0].emit("messageerror", new Error("duplicate idle receive"));
    const queued = observe(second.run(descriptor, rows));
    await first.close();
    await tick();
    assert.equal(workers.length, 1);
    assert.equal(workers[0].terminationCalls, 1);
    assert.equal(workers[0].terminated, false);
    workers[0].release();
    await tick();
    assert.equal(workers.length, 2);
    assert.equal(workers[0].terminated, true);
    workers[1].reply();
    assert.deepEqual((await queued).value, expected);
  });
});

test("queued close preserves and does not wait for active sibling lease", { timeout: 1500 }, async () => {
  await fixture(async ({ workers, open, observe }) => {
    const first = open(new AbortController().signal);
    const second = open(new AbortController().signal);
    const active = observe(first.run(descriptor, rows));
    await tick();
    const queued = observe(second.run(descriptor, rows));
    await second.close();
    closed((await queued).error);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].terminationCalls, 0);
    workers[0].reply();
    assert.deepEqual((await active).value, expected);
    const reused = observe(first.run(descriptor, rows));
    await tick();
    workers[0].reply();
    assert.deepEqual((await reused).value, expected);
    assert.equal(workers.length, 1);
  });
});

test("prior caller abort preserves exact errno-shaped and falsy reasons", { timeout: 1500 }, async () => {
  for (const reason of [Object.assign(new Error("caller reason"), { code: "CLOSED" }), 0]) {
    await fixture(async ({ workers, open, observe }) => {
      const sibling = open(new AbortController().signal);
      const caller = new AbortController();
      const queuedSession = open(caller.signal);
      const active = observe(sibling.run(descriptor, rows));
      await tick();
      const queued = observe(queuedSession.run(descriptor, rows));
      caller.abort(reason);
      await queuedSession.close();
      assert.equal((await queued).error, reason);
      assert.throws(() => queuedSession.run(descriptor, rows), error => Object.is(error, reason));
      assert.equal(workers[0].terminationCalls, 0);
      workers[0].reply();
      assert.deepEqual((await active).value, expected);
    });
  }
});

test("selected internal PROTOCOL stays primary internally; outer later caller abort wins identity", { timeout: 1500 }, async () => {
  for (const abortLater of [false, true]) {
    await fixture(async ({ executor, workers, track, observe }) => {
      const caller = new AbortController();
      const reason = Object.assign(new Error("later caller"), { code: "EACCES" });
      let cleanup;
      let internal;
      const outer = observe(withRegexSession({ signal: caller.signal, registerCleanup: callback => { cleanup = callback; } }, executor, async session => {
        track(session);
        internal = observe(session.run(descriptor, rows));
        const result = await internal;
        throw result.error;
      }));
      let settled = false;
      void outer.then(() => { settled = true; });
      await tick();
      workers[0].emit("messageerror", new Error("first receive"));
      await tick();
      assert.equal(workers[0].terminationCalls, 1);
      if (abortLater) caller.abort(reason);
      workers[0].emit("messageerror", new Error("duplicate receive"));
      const closing = cleanup();
      assert.equal(cleanup(), closing);
      await tick();
      assert.equal(settled, false);
      workers[0].release();
      const selected = (await internal).error;
      assert.ok(selected instanceof RegexExecutionError);
      assert.equal(selected.code, "PROTOCOL");
      assert.equal((await outer).error, abortLater ? reason : selected);
      await closing;
    });
  }
});

test("synchronous callback closure rejects late session acquisition", { timeout: 1500 }, async () => {
  await fixture(async ({ executor, workers, observe }) => {
    let acquisitions = 0;
    let executions = 0;
    let closing;
    const originalOpen = executor.open.bind(executor);
    executor.open = signal => { acquisitions++; return originalOpen(signal); };
    const result = observe(withRegexSession({
      signal: new AbortController().signal,
      registerCleanup: cleanup => { closing = cleanup(); assert.equal(cleanup(), closing); },
    }, executor, () => { executions++; return { exitCode: 0 }; }));
    closed((await result).error);
    await closing;
    assert.equal(acquisitions, 0);
    assert.equal(executions, 0);
    assert.equal(workers.length, 0);
  });
});

after(() => {
  workerModule.Worker = nativeWorker;
  syncBuiltinESMExports();
  assert.equal(finishedFixtures, 8);
  assert.equal(transports.length, 8);
  assert.equal(transports.filter(worker => !worker.terminated).length, 0);
  console.log(JSON.stringify({ finishedFixtures, fakeTransports: transports.length, nativeWorkers: 0, remainingFakeWorkers: 0, listenerChecks: "caller and combined abort signals; all four transport events" }));
});
