import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { setImmediate as tick, setTimeout as delay } from "node:timers/promises";
import { after, beforeEach, test } from "node:test";
import type { Worker } from "node:worker_threads";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import type { GrepDescriptor, Row } from "../../../../src/commands/regex-execution/protocol.js";

const workersModule = createRequire(import.meta.url)("node:worker_threads") as { Worker: typeof Worker };
const NativeWorker = workersModule.Worker;
const events = ["message", "messageerror", "error", "exit"];
const descriptor: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rows: Row[] = [{ bytes: Uint8Array.of(97), all: true, terminated: true }];
let workers: ControlledWorker[] = [];
let startupStall = false;
let releaseTermination: () => void;
let terminationGate: Promise<void>;

class ControlledWorker extends EventEmitter {
  readonly posts: { id: number }[] = [];
  terminationCalls = 0;
  terminated = false;
  constructor() {
    super();
    workers.push(this);
    if (!startupStall) queueMicrotask(() => this.emit("message", { ready: true }));
  }
  ref(): this { return this; }
  unref(): this { return this; }
  postMessage(message: { id: number }): void { this.posts.push(message); }
  reply(): void { this.emit("message", { id: this.posts.at(-1)!.id, results: [new Float64Array([0, 1])] }); }
  async terminate(): Promise<number> {
    this.terminationCalls++;
    await terminationGate;
    this.terminated = true;
    this.emit("exit", 1);
    return 1;
  }
}

workersModule.Worker = ControlledWorker as unknown as typeof Worker;
syncBuiltinESMExports();
beforeEach(() => {
  workers = [];
  startupStall = false;
  terminationGate = new Promise(resolve => { releaseTermination = resolve; });
});
after(() => { workersModule.Worker = NativeWorker; syncBuiltinESMExports(); });

const settle = <Value>(promise: Promise<Value>) => promise.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
function clean(signal: AbortSignal): void {
  assert.equal(getEventListeners(signal, "abort").length, 0);
  for (const worker of workers) {
    assert.equal(worker.terminated, true);
    assert.equal(worker.terminationCalls, 1);
    for (const event of events) assert.equal(worker.listenerCount(event), 0, event);
  }
}
function errorCode(error: unknown): unknown { return (error as { code?: unknown } | undefined)?.code; }

for (const phase of ["startup", "active"] as const) {
  test(`${phase} messageerror is promptly PROTOCOL and awaits exact retirement`, { timeout: 2000 }, async () => {
    startupStall = phase === "startup";
    const controller = new AbortController();
    const executor = new RegexExecutor({ requestTimeoutMs: 40, startupTimeoutMs: 40 });
    const session = executor.open(controller.signal);
    const pending = settle(session.run(descriptor, rows));
    let settled = false;
    void pending.then(() => { settled = true; });
    try {
      await tick();
      const worker = workers[0]!;
      worker.emit("messageerror", new Error("controlled receive deserialization failure"));
      worker.emit("messageerror", new Error("duplicate receive failure"));
      await tick();
      const promptTerminationCalls = worker.terminationCalls;
      const settledBeforeRelease = settled;
      const terminatedBeforeRelease = worker.terminated;
      releaseTermination();
      const result = await pending;
      console.log(JSON.stringify({ phase, code: errorCode(result.error), promptTerminationCalls, settledBeforeRelease, terminatedBeforeRelease }));
      assert.equal(errorCode(result.error), "PROTOCOL");
      assert.equal(promptTerminationCalls, 1);
      assert.equal(settledBeforeRelease, false);
      assert.equal(terminatedBeforeRelease, false);
      assert.equal(worker.terminated, true);
      assert.equal(worker.posts.length, phase === "startup" ? 0 : 1);
      clean(controller.signal);
    } finally {
      releaseTermination();
      await pending;
      await session.close();
      await executor.dispose();
    }
  });
}

test("idle messageerror retires promptly, holds capacity and close awaits cleanup", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const executor = new RegexExecutor({ maxWorkers: 1, idleTimeoutMs: 1000 });
  const first = executor.open(controller.signal);
  const second = executor.open(controller.signal);
  const initial = first.run(descriptor, rows);
  let queued: ReturnType<typeof settle> | undefined;
  try {
    await tick();
    workers[0]!.reply();
    await initial;
    workers[0]!.emit("messageerror", new Error("idle deserialization failure"));
    workers[0]!.emit("messageerror", new Error("duplicate idle failure"));
    await tick();
    assert.equal(workers[0]!.terminationCalls, 1);
    queued = settle(second.run(descriptor, rows));
    await first.close();
    let closed = false;
    const closing = second.close().then(() => { closed = true; });
    await tick();
    assert.equal(workers.length, 1);
    assert.equal(closed, false);
    releaseTermination();
    await tick();
    assert.equal(workers.length, 2);
    workers[1]!.reply();
    assert.equal((await queued).error, undefined);
    await closing;
    clean(controller.signal);
  } finally {
    releaseTermination();
    controller.abort();
    await queued;
    await first.close();
    await second.close();
    await executor.dispose();
  }
});

for (const prior of ["protocol", "abort", "timeout", "worker-error", "dispose"] as const) {
  test(`${prior} precedence survives messageerror and awaited termination`, { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const executor = new RegexExecutor({ requestTimeoutMs: prior === "timeout" ? 10 : 100 });
    const session = executor.open(controller.signal);
    const pending = settle(session.run(descriptor, rows));
    const reason = new Error("caller reason retained by identity");
    let disposing: Promise<void> | undefined;
    try {
      await tick();
      const worker = workers[0]!;
      if (prior === "protocol") worker.emit("messageerror", new Error("first receive failure"));
      if (prior === "abort") controller.abort(reason);
      if (prior === "timeout") await delay(20);
      if (prior === "worker-error") worker.emit("error", new Error("first worker error"));
      if (prior === "dispose") disposing = executor.dispose();
      await tick();
      worker.emit("messageerror", new Error("late receive failure"));
      if (prior === "protocol") controller.abort(reason);
      releaseTermination();
      const result = await pending;
      if (prior === "abort") assert.equal(result.error, reason);
      else assert.equal(errorCode(result.error), { protocol: "PROTOCOL", timeout: "REQUEST_TIMEOUT", "worker-error": "WORKER_ERROR", dispose: "CLOSED" }[prior]);
      await disposing;
      clean(controller.signal);
    } finally {
      releaseTermination();
      await pending;
      await disposing;
      await session.close();
      await executor.dispose();
    }
  });
}

test("native worker receiver messageerror uses the same awaited cleanup", { timeout: 3000 }, async () => {
  const nativeWorkers: NativeObservedWorker[] = [];
  class NativeObservedWorker extends NativeWorker {
    terminationCalls = 0;
    override postMessage(): void { this.emit("messageerror", new Error("controlled native receiver event")); }
    override terminate(): Promise<number> { this.terminationCalls++; return super.terminate(); }
    constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); nativeWorkers.push(this); }
  }
  workersModule.Worker = NativeObservedWorker;
  syncBuiltinESMExports();
  const controller = new AbortController();
  const executor = new RegexExecutor({ requestTimeoutMs: 40 });
  const session = executor.open(controller.signal);
  try {
    const result = await settle(session.run(descriptor, rows));
    assert.equal(errorCode(result.error), "PROTOCOL");
    assert.equal(nativeWorkers.length, 1);
    assert.equal(nativeWorkers[0]!.threadId, -1);
    assert.equal(nativeWorkers[0]!.terminationCalls, 1);
    for (const event of events) assert.equal(nativeWorkers[0]!.listenerCount(event), 0, event);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    await session.close();
    await executor.dispose();
    workersModule.Worker = ControlledWorker as unknown as typeof Worker;
    syncBuiltinESMExports();
  }
});
