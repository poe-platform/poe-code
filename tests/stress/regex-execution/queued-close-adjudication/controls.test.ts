import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { setImmediate as tick } from "node:timers/promises";
import { after, beforeEach, test } from "node:test";
import type { Worker } from "node:worker_threads";
import { RegexExecutor, RegexExecutionError, withRegexSession } from "../../../../src/commands/regex-execution/client.js";
import type { CommandContext } from "../../../../src/contracts/command.js";
import type { GrepDescriptor, Row } from "../../../../src/commands/regex-execution/protocol.js";

const workersModule = createRequire(import.meta.url)("node:worker_threads") as { Worker: typeof Worker };
const NativeWorker = workersModule.Worker;
const descriptor: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rows: Row[] = [{ bytes: Uint8Array.of(97), all: true, terminated: true }];
const events = ["message", "messageerror", "error", "exit"];
let workers: FakeWorker[] = [];
let startupStall = false;
let totalWorkers = 0;

class FakeWorker extends EventEmitter {
  readonly posts: { id: number }[] = [];
  terminationCalls = 0;
  terminated = false;
  release!: () => void;
  readonly gate = new Promise<void>(resolve => { this.release = resolve; });
  constructor() {
    super();
    workers.push(this);
    totalWorkers++;
    if (!startupStall) queueMicrotask(() => this.emit("message", { ready: true }));
  }
  ref(): this { return this; }
  unref(): this { return this; }
  postMessage(message: { id: number }): void { this.posts.push(message); }
  reply(): void { this.emit("message", { id: this.posts.at(-1)!.id, results: [new Float64Array([0, 1])] }); }
  async terminate(): Promise<number> {
    this.terminationCalls++;
    await this.gate;
    this.terminated = true;
    this.emit("exit", 1);
    return 1;
  }
}

workersModule.Worker = FakeWorker as unknown as typeof Worker;
syncBuiltinESMExports();
beforeEach(() => { workers = []; startupStall = false; });
after(() => {
  workersModule.Worker = NativeWorker;
  syncBuiltinESMExports();
  console.log(JSON.stringify({ totalFakeWorkers: totalWorkers, nativeWorkers: 0, strictUnhandled: true }));
});
const settle = <Value>(promise: Promise<Value>) => promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
function failure(result: Awaited<ReturnType<typeof settle>>): unknown {
  assert.equal(result.ok, false);
  if (!result.ok) return result.error;
  throw new Error("expected rejection");
}
function closed(error: unknown): boolean {
  assert.ok(error instanceof RegexExecutionError);
  assert.equal(error.code, "CLOSED");
  assert.equal(error.message, "regex CLOSED: invocation is closed");
  assert.equal("exitCode" in error, false);
  assert.equal("status" in error, false);
  return true;
}
function clean(signal: AbortSignal): void {
  assert.equal(getEventListeners(signal, "abort").length, 0);
  for (const worker of workers) {
    assert.equal(worker.terminated, true);
    assert.equal(worker.terminationCalls, 1);
    for (const event of events) assert.equal(worker.listenerCount(event), 0, event);
  }
  console.log(JSON.stringify({ workers: workers.length, retiredExactlyOnce: true, remainingListeners: 0 }));
}
function executor(): RegexExecutor {
  return new RegexExecutor({ maxWorkers: 1, startupTimeoutMs: 1000, requestTimeoutMs: 1000, idleTimeoutMs: 1000 });
}

test("idle messageerror plus queued close rejects CLOSED and awaits the exact retirement", { timeout: 2500 }, async () => {
  const caller = new AbortController();
  const owner = executor();
  const first = owner.open(caller.signal);
  const second = owner.open(caller.signal);
  const initial = settle(first.run(descriptor, rows));
  try {
    await tick(); workers[0]!.reply(); assert.equal((await initial).ok, true);
    workers[0]!.emit("messageerror", new Error("idle receive failure"));
    workers[0]!.emit("messageerror", new Error("duplicate"));
    await tick();
    assert.equal(workers[0]!.terminationCalls, 1);
    const pending = settle(second.run(descriptor, rows));
    const sameOwner = settle(second.run(descriptor, rows));
    await first.close();
    const closing = second.close();
    assert.equal(second.close(), closing);
    assert.throws(() => second.run(descriptor, rows), closed);
    let finished = false;
    void closing.then(() => { finished = true; });
    await tick();
    const reason = failure(await pending);
    closed(reason);
    assert.equal(failure(await sameOwner), reason);
    assert.equal(workers.length, 1);
    assert.equal(finished, false);
    assert.equal(workers[0]!.terminated, false);
    workers[0]!.release();
    await closing;
    assert.equal(finished, true);
    assert.equal(workers.length, 1);
    assert.throws(() => second.run(descriptor, rows), closed);
    await second.close();
    clean(caller.signal);
    console.log(JSON.stringify({ code: "CLOSED", message: (reason as Error).message, sameOwnerReasonIdentity: true, status: "not applicable: direct session rejection" }));
  } finally {
    caller.abort(); for (const worker of workers) worker.release();
    await initial; await first.close(); await second.close(); await owner.dispose();
  }
});

test("an OPEN queued sibling gets a replacement only after idle messageerror retirement", { timeout: 2500 }, async () => {
  const caller = new AbortController();
  const owner = executor();
  const first = owner.open(caller.signal);
  const second = owner.open(caller.signal);
  const initial = settle(first.run(descriptor, rows));
  try {
    await tick(); workers[0]!.reply(); await initial;
    workers[0]!.emit("messageerror", new Error("idle receive failure"));
    const pending = settle(second.run(descriptor, rows));
    await first.close(); await tick();
    assert.equal(workers.length, 1);
    assert.equal(workers[0]!.terminationCalls, 1);
    assert.equal(workers[0]!.terminated, false);
    workers[0]!.release(); await tick();
    assert.equal(workers.length, 2);
    assert.equal(workers[0]!.terminated, true);
    workers[1]!.reply();
    assert.deepEqual(await pending, { ok: true, value: [[{ start: 0, end: 1 }]] });
    const closing = second.close(); await tick();
    assert.equal(workers[1]!.terminationCalls, 1);
    workers[1]!.release(); await closing; clean(caller.signal);
  } finally {
    caller.abort(); for (const worker of workers) worker.release();
    await initial; await first.close(); await second.close(); await owner.dispose();
  }
});

test("queued close neither terminates nor waits for an active sibling lease", { timeout: 2500 }, async () => {
  const caller = new AbortController();
  const owner = executor();
  const sibling = owner.open(caller.signal);
  const closingSession = owner.open(caller.signal);
  const active = settle(sibling.run(descriptor, rows));
  try {
    await tick();
    const queued = settle(closingSession.run(descriptor, rows));
    await closingSession.close(); closed(failure(await queued));
    assert.equal(workers.length, 1);
    assert.equal(workers[0]!.terminationCalls, 0);
    workers[0]!.reply(); assert.equal((await active).ok, true);
    const next = settle(sibling.run(descriptor, rows));
    await tick(); workers[0]!.reply(); assert.equal((await next).ok, true);
    assert.equal(workers.length, 1);
    workers[0]!.release(); await sibling.close(); clean(caller.signal);
  } finally {
    caller.abort(); for (const worker of workers) worker.release();
    await active; await closingSession.close(); await sibling.close(); await owner.dispose();
  }
});

for (const phase of ["startup", "active"] as const) test(`${phase} PROTOCOL selection survives later caller abort and awaits retirement`, { timeout: 2500 }, async () => {
  startupStall = phase === "startup";
  const caller = new AbortController();
  const owner = executor();
  const session = owner.open(caller.signal);
  const pending = settle(session.run(descriptor, rows));
  try {
    await tick();
    workers[0]!.emit("messageerror", new Error("receive failure"));
    workers[0]!.emit("messageerror", new Error("duplicate"));
    await tick();
    caller.abort(new Error("late caller abort must not rewrite internal selection"));
    const closing = session.close();
    let finished = false;
    void closing.then(() => { finished = true; });
    await tick();
    assert.equal(finished, false);
    assert.equal(workers[0]!.terminationCalls, 1);
    assert.equal(workers[0]!.terminated, false);
    workers[0]!.release();
    const reason = failure(await pending);
    assert.ok(reason instanceof RegexExecutionError);
    assert.equal(reason.code, "PROTOCOL");
    assert.equal(reason.message, "regex PROTOCOL: worker message could not be deserialized");
    assert.notEqual(reason, caller.signal.reason);
    assert.equal("exitCode" in reason, false);
    assert.equal(workers[0]!.posts.length, phase === "startup" ? 0 : 1);
    await closing; clean(caller.signal);
  } finally {
    for (const worker of workers) worker.release();
    await pending; await session.close(); await owner.dispose();
  }
});

for (const reason of [Object.assign(new Error("prior caller reason"), { code: "ENOENT" }), false, 0, "", null]) {
  test(`prior caller reason is strict identity through messageerror/close: ${String(reason)}`, { timeout: 2500 }, async () => {
    const caller = new AbortController();
    const owner = executor();
    const session = owner.open(caller.signal);
    const pending = settle(session.run(descriptor, rows));
    try {
      await tick(); caller.abort(reason);
      workers[0]!.emit("messageerror", new Error("later receive failure"));
      const closing = session.close();
      assert.equal(session.close(), closing);
      await tick();
      assert.equal(workers[0]!.terminated, false);
      workers[0]!.release();
      assert.equal(failure(await pending), reason);
      await closing;
      assert.throws(() => session.run(descriptor, rows), error => error === reason);
      clean(caller.signal);
    } finally {
      for (const worker of workers) worker.release();
      await pending; await session.close(); await owner.dispose();
    }
  });
}

test("synchronous empty-owner cleanup rejects late acquisition before executor.open", { timeout: 2500 }, async () => {
  const caller = new AbortController();
  const owner = executor();
  let acquired = false;
  owner.open = () => { acquired = true; throw new Error("unexpected acquisition"); };
  let cleanup: (() => void | Promise<void>) | undefined;
  let closing: void | Promise<void>;
  const context = { signal: caller.signal, registerCleanup(callback: () => void | Promise<void>) {
    cleanup = callback; closing = callback(); assert.equal(callback(), closing);
  } } as CommandContext;
  const result = await settle(withRegexSession(context, owner, () => { throw new Error("unexpected execution"); }));
  closed(failure(result));
  await closing!;
  assert.equal(cleanup!(), closing!);
  assert.equal(acquired, false);
  assert.equal(workers.length, 0);
  await owner.dispose(); clean(caller.signal);
});
