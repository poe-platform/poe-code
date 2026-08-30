import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import type { Worker, WorkerOptions, Transferable } from "node:worker_threads";
import { RegexExecutor, RegexExecutionError } from "../../../src/commands/regex-execution/client.js";
import { defaults, validateReply, type GrepDescriptor, type SearchDescriptor, type Row } from "../../../src/commands/regex-execution/protocol.js";

const workersModule = createRequire(import.meta.url)("node:worker_threads") as { Worker: typeof Worker };
const NativeWorker = workersModule.Worker;
const workers: ObservedWorker[] = [];
let intercept: ((worker: ObservedWorker, message: unknown) => boolean) | undefined;
let holdReady = false;
class ObservedWorker extends NativeWorker {
  terminated = 0;
  closed = false;
  messages = 0;
  constructor(filename: string | URL, options?: WorkerOptions) {
    super(filename, options);
    workers.push(this);
    this.once("exit", () => { this.closed = true; });
  }
  override postMessage(message: unknown, transferList?: readonly Transferable[]): void {
    this.messages++;
    if (!intercept?.(this, message)) super.postMessage(message, transferList);
  }
  override terminate(): Promise<number> { this.terminated++; return super.terminate(); }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (holdReady && event === "message" && (args[0] as { ready?: boolean } | undefined)?.ready) return true;
    return super.emit(event, ...args);
  }
  deliver(message: unknown): void { super.postMessage(message); }
}
workersModule.Worker = ObservedWorker;
syncBuiltinESMExports();
after(async () => {
  intercept = undefined;
  holdReady = false;
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  workersModule.Worker = NativeWorker;
  syncBuiltinESMExports();
  console.log(JSON.stringify({ executorWorkers: workers.length, activeBeforeSafetyCleanup, activeAfter: workers.filter(worker => !worker.closed).length, remainingOwnedListeners: workers.reduce((total, worker) => total + worker.listenerCount("message") + worker.listenerCount("error") + worker.listenerCount("exit"), 0) }));
});

const descriptor: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const row: Row = { bytes: Buffer.from("cat"), all: true, terminated: true };
const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) => error instanceof RegexExecutionError && error.code === expected;
function state(executor: RegexExecutor) {
  return executor as unknown as { slots: Set<{ busy: boolean }>; queue: unknown[]; queuedBytes: number; sessions: number };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("bounded observation timed out");
}
function clean(from: number): void {
  for (const worker of workers.slice(from)) {
    assert.equal(worker.closed, true);
    assert.equal(worker.terminated, 1);
    for (const event of ["message", "error", "exit"]) assert.equal(worker.listenerCount(event), 0, event);
  }
}

test("defaults are active-request policy, not prototype cumulative caps", () => {
  assert.deepEqual(defaults, { requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2, maxQueuedRequests: 64, maxQueuedBytes: 128 * 1024 * 1024, idleTimeoutMs: 100, workerOldGenerationMb: 128, workerStackMb: 4 });
  for (const options of [{ requestTimeoutMs: 0 }, { startupTimeoutMs: 2147483648 }, { maxWorkers: -1 }, { maxQueuedRequests: -1 }, { maxQueuedBytes: NaN }, { idleTimeoutMs: Infinity }]) assert.throws(() => new RegexExecutor(options), RangeError);
});

test("preabort creates no worker or listener", () => {
  const from = workers.length;
  const controller = new AbortController();
  const reason = new Error("before construction");
  controller.abort(reason);
  const executor = new RegexExecutor();
  assert.throws(() => executor.open(controller.signal), error => error === reason);
  assert.equal(workers.length, from);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("one worker handles validation, batches and more than 1024 calls", { timeout: 15000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const caller = signal();
  const session = executor.open(caller);
  try {
    assert.deepEqual(await session.run(descriptor, []), []);
    for (let request = 0; request < 1030; request++) assert.deepEqual(await session.run(descriptor, [row]), [[{ start: 1, end: 2 }]]);
    assert.deepEqual(await session.run(descriptor, [row, row]), [[{ start: 1, end: 2 }], [{ start: 1, end: 2 }]]);
    assert.equal(workers.length - from, 1);
    assert.equal([...state(executor).slots][0]!.busy, false);
    assert.equal(getEventListeners(caller, "abort").length, 0);
  } finally { await session.close(); }
  clean(from);
  assert.equal(state(executor).slots.size, 0);
});

test("pattern, hit, transport and invocation sizes do not inherit prototype caps", { timeout: 10000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  for (let invocation = 0; invocation < 2; invocation++) {
    const session = executor.open(signal());
    try {
      const many = { ...descriptor, patterns: [...Array.from({ length: 32 }, () => "z"), "a"] };
      assert.equal((await session.run(many, [row]))[0]!.length, 1);
      const hits = await session.run(descriptor, [{ bytes: Buffer.from("a".repeat(5000)), all: true, terminated: true }]);
      assert.equal(hits[0]!.length, 5000);
      const big = await session.run(descriptor, [{ bytes: Buffer.alloc(300000, 98), all: false, terminated: true }]);
      assert.deepEqual(big, [[]]);
    } finally { await session.close(); }
  }
  clean(from);
});

test("rg retains its 100000-hit limit and grep accepts over 8MiB input", { timeout: 10000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const session = executor.open(signal());
  const search: SearchDescriptor = { kind: "rg", patterns: [""], fixed: false, case: "sensitive", word: false, whole: false, nullData: false };
  try {
    assert.equal((await session.run(search, [{ bytes: Buffer.alloc(99999, 97), all: true, terminated: true }]))[0]!.length, 100000);
    assert.deepEqual(await session.run(descriptor, [{ bytes: Buffer.alloc(9 * 1024 * 1024, 98), all: false, terminated: true }]), [[]]);
  } finally { await session.close(); }
  clean(from);
});

test("FIFO queue removes aborted waiter and rejects count overflow", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ maxWorkers: 1, maxQueuedRequests: 2 });
  const first = executor.open(signal());
  const aborted = new AbortController();
  const second = executor.open(aborted.signal);
  const third = executor.open(signal());
  const fourth = executor.open(signal());
  let held: { worker: ObservedWorker; message: unknown } | undefined;
  intercept = (worker, message) => { held = { worker, message }; return true; };
  const order: string[] = [];
  try {
    const initial = first.run(descriptor, [row]).then(result => { order.push("first"); return result; });
    await until(() => held !== undefined);
    const cancelled = second.run(descriptor, [row]);
    const reason = new Error("queued cancellation");
    const cancellation = assert.rejects(cancelled, error => error === reason);
    const later = third.run(descriptor, [row]).then(result => { order.push("third"); return result; });
    await assert.rejects(fourth.run(descriptor, [row]), code("QUEUE_EXHAUSTED"));
    assert.equal(state(executor).queue.length, 2);
    aborted.abort(reason);
    await cancellation;
    assert.equal(state(executor).queue.length, 1);
    assert.equal(getEventListeners(aborted.signal, "abort").length, 0);
    intercept = undefined;
    held!.worker.deliver(held!.message);
    await Promise.all([initial, later]);
    assert.deepEqual(order, ["first", "third"]);
    assert.equal(workers.length - from, 1);
    assert.equal(state(executor).queuedBytes, 0);
  } finally { intercept = undefined; await Promise.all([first.close(), second.close(), third.close(), fourth.close()]); }
  clean(from);
});

test("queue input accounting includes descriptors and bytes; executors are independent", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ maxWorkers: 1, maxQueuedBytes: 200 });
  const first = executor.open(signal());
  const next = executor.open(signal());
  let held: { worker: ObservedWorker; message: unknown } | undefined;
  intercept = (worker, message) => { held = { worker, message }; return true; };
  try {
    const initial = first.run(descriptor, [row]);
    await until(() => held !== undefined);
    await assert.rejects(next.run({ ...descriptor, patterns: ["z".repeat(100)] }, [row]), code("QUEUE_EXHAUSTED"));
    await assert.rejects(next.run(descriptor, [{ ...row, bytes: Buffer.alloc(100) }]), code("QUEUE_EXHAUSTED"));
    intercept = undefined;
    const independent = new RegexExecutor({ maxWorkers: 1 });
    const other = independent.open(signal());
    try { assert.equal((await other.run(descriptor, [row]))[0]!.length, 1); }
    finally { await other.close(); }
    held!.worker.deliver(held!.message);
    await initial;
  } finally { intercept = undefined; await Promise.all([first.close(), next.close()]); }
  clean(from);
});

test("active abort awaits exact cleanup without cross-caller cancellation", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const controller = new AbortController();
  const first = executor.open(controller.signal);
  const second = executor.open(signal());
  let held: ObservedWorker | undefined;
  intercept = worker => { held = worker; return true; };
  try {
    const pending = first.run(descriptor, [row]);
    const reason = new Error("active cancellation");
    const cancelled = assert.rejects(pending, error => error === reason);
    await until(() => held !== undefined);
    intercept = undefined;
    const independent = second.run(descriptor, [row]);
    controller.abort(reason);
    await cancelled;
    assert.equal(held!.closed, true);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.equal((await independent)[0]!.length, 1);
  } finally { intercept = undefined; await Promise.all([first.close(), second.close()]); }
  clean(from);
});

test("startup abort does not dispatch matching and awaits cleanup", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const controller = new AbortController();
  const session = executor.open(controller.signal);
  const pending = session.run(descriptor, [row]);
  const reason = new Error("startup cancellation");
  const rejected = assert.rejects(pending, error => error === reason);
  controller.abort(reason);
  await rejected;
  await session.close();
  assert.equal(workers[from]!.messages, 0);
  clean(from);
});

test("benign stalled reply hits short explicit request deadline and cleans worker", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ requestTimeoutMs: 25 });
  const session = executor.open(signal());
  intercept = () => true;
  try { await assert.rejects(session.run(descriptor, [row]), code("REQUEST_TIMEOUT")); }
  finally { intercept = undefined; await session.close(); }
  clean(from);
});

test("benign withheld ready has a distinct startup deadline and no regex dispatch", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ startupTimeoutMs: 25 });
  const session = executor.open(signal());
  holdReady = true;
  try { await assert.rejects(session.run(descriptor, [row]), code("STARTUP_TIMEOUT")); }
  finally { holdReady = false; await session.close(); }
  assert.equal(workers[from]!.messages, 0);
  clean(from);
});

test("malformed replies and natural exact-worker exit settle after cleanup", { timeout: 5000 }, async () => {
  for (const mode of ["malformed", "exit"] as const) {
    const from = workers.length;
    const executor = new RegexExecutor();
    const session = executor.open(signal());
    intercept = worker => {
      if (mode === "malformed") queueMicrotask(() => worker.emit("message", { id: -1, results: [] }));
      else void NativeWorker.prototype.terminate.call(worker);
      return true;
    };
    try { await assert.rejects(session.run(descriptor, [row]), code(mode === "malformed" ? "PROTOCOL" : "WORKER_EXIT")); }
    finally { intercept = undefined; await session.close(); }
    assert.equal(workers[from]!.closed, true);
    assert.equal(workers[from]!.listenerCount("error"), 0);
  }
});

test("idle retirement is automatic with an open invocation and removes listeners", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ idleTimeoutMs: 15 });
  const session = executor.open(signal());
  try {
    await session.run(descriptor, [row]);
    await until(() => state(executor).slots.size === 0);
    clean(from);
    assert.deepEqual(await session.run(descriptor, [row]), [[{ start: 1, end: 2 }]]);
  } finally { await session.close(); }
  clean(from);
});

test("dispose rejects queued and active work, observes late handlers and is idempotent", { timeout: 5000 }, async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ maxWorkers: 1 });
  const first = executor.open(signal());
  const second = executor.open(signal());
  intercept = () => true;
  try {
    const active = assert.rejects(first.run(descriptor, [row]), code("CLOSED"));
    const queued = assert.rejects(second.run(descriptor, [row]), code("CLOSED"));
    await executor.dispose();
    await Promise.all([active, queued]);
    await executor.dispose();
    assert.throws(() => executor.open(signal()), code("CLOSED"));
  } finally { intercept = undefined; await Promise.all([first.close(), second.close()]); }
  clean(from);
});

test("reply validation rejects bounds, ordering and first-result amplification", () => {
  for (const ranges of [[-1, 1], [1, 4], [2, 1], [1.5, 2], [2, 3, 0, 1]]) assert.throws(() => validateReply({ id: 1, results: [new Float64Array(ranges)] }, 1, [row], signal()), code("PROTOCOL"));
  assert.throws(() => validateReply({ id: 1, results: [new Float64Array([0, 1, 1, 2])] }, 1, [{ ...row, all: false }], signal()), code("PROTOCOL"));
});
