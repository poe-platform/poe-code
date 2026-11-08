import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import threads, { type Transferable, type WorkerOptions } from "node:worker_threads";
import { RegexExecutor, withRegexSession, type RegexSession } from "../../../src/commands/regex-execution/client.js";
import { exprMatchCeilings, type ExprMatchDescriptor, type GrepDescriptor } from "../../../src/commands/regex-execution/protocol.js";
import type { CommandContext, InvocationCleanup } from "../../../src/contracts/command.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";

class StructuralAbortSignal extends EventTarget implements AbortSignal {
  private cancelled = false;
  private cancellationReason: unknown;
  onabort: ((this: AbortSignal, event: Event) => unknown) | null = null;
  constructor() {
    super();
    this.addEventListener("abort", event => this.onabort?.call(this, event), { once: true });
  }
  get aborted(): boolean { return this.cancelled; }
  get reason(): unknown { return this.cancellationReason; }
  throwIfAborted(): void { if (this.aborted) throw this.reason; }
  abort(reason: unknown): void {
    if (this.aborted) return;
    this.cancelled = true;
    this.cancellationReason = reason;
    this.dispatchEvent(new Event("abort"));
  }
}

const NativeWorker = threads.Worker;
const workers: ObservedWorker[] = [];
let holdReady = false;
let holdRequest = false;
let throwUndefined = false;
let retirementGate: Promise<void> | undefined;
class ObservedWorker extends NativeWorker {
  closed = false;
  terminations = 0;
  requests = 0;
  private heldRequest: unknown;
  constructor(filename: string | URL, options?: WorkerOptions) {
    super(filename, options);
    workers.push(this);
    this.once("exit", () => { this.closed = true; });
  }
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    const value = args[0];
    if (holdReady && event === "message" && value && typeof value === "object" && "ready" in value) return true;
    return super.emit(event, ...args);
  }
  override postMessage(message: unknown, transferList?: readonly Transferable[]): void {
    this.requests++;
    if (throwUndefined) throw undefined;
    if (holdRequest) { this.heldRequest = message; return; }
    super.postMessage(message, transferList);
  }
  release(): void { super.postMessage(this.heldRequest); }
  override async terminate(): Promise<number> {
    this.terminations++;
    await retirementGate;
    return super.terminate();
  }
}
threads.Worker = ObservedWorker;
syncBuiltinESMExports();
after(async () => {
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  console.log(JSON.stringify({ abortReasonWorkers: workers.length, activeBeforeSafetyCleanup, activeAfter: workers.filter(worker => !worker.closed).length }));
  assert.equal(activeBeforeSafetyCleanup, 0);
});

const grep: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const expr: ExprMatchDescriptor = { kind: "expr-match", pattern: Buffer.from("a"), profile: "byte", limits: exprMatchCeilings };
const subject = Buffer.from("abc");
const rows = [{ bytes: subject, all: false, terminated: false }];
const operations = ["run", "matchExpr"] as const;
type Operation = typeof operations[number];
const nativeReasons = [
  { name: "native-undefined", reason: undefined },
  { name: "native-zero", reason: 0 },
  { name: "native-null", reason: null },
  { name: "native-false", reason: false },
  { name: "native-empty-string", reason: "" },
  { name: "native-Error", reason: new Error("caller cancellation") },
];
function direct(executor: RegexExecutor, operation: Operation, signal: AbortSignal): Promise<unknown> {
  return operation === "run" ? executor.request(grep, rows, signal) : executor.request(expr, rows, signal);
}
function invoke(session: RegexSession, operation: Operation): Promise<unknown> {
  return operation === "run" ? session.run(grep, rows) : session.matchExpr(expr, subject);
}
function settled(action: () => unknown) {
  return Promise.resolve().then(action).then(
    value => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}
function rejected(outcome: Awaited<ReturnType<typeof settled>>, reason: unknown): void {
  assert.equal(outcome.status, "rejected");
  if (outcome.status === "rejected") assert.ok(Object.is(outcome.reason, reason), "exact rejection reason");
}
function succeeded(outcome: Awaited<ReturnType<typeof settled>>, operation: Operation): void {
  assert.equal(outcome.status, "fulfilled");
  if (outcome.status !== "fulfilled") return;
  if (operation === "run") assert.deepEqual(outcome.value, [[{ start: 0, end: 1 }]]);
  else {
    assert.ok(outcome.value && typeof outcome.value === "object");
    assert.ok("matched" in outcome.value && outcome.value.matched === true);
    assert.ok("overall" in outcome.value);
    assert.deepEqual(outcome.value.overall, { start: 0, end: 1 });
  }
}
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("bounded worker observation timed out");
}
function clean(from: number): void {
  for (const worker of workers.slice(from)) {
    assert.equal(worker.closed, true);
    assert.equal(worker.terminations, 1);
    for (const event of ["message", "messageerror", "error", "exit"]) assert.equal(worker.listenerCount(event), 0, event);
  }
}

test("structural signal implements EventTarget and AbortSignal; native undefined is a DOMException", async () => {
  const structural = new StructuralAbortSignal();
  const signal: AbortSignal = structural;
  let calls = 0;
  signal.onabort = function (event) { assert.equal(this, signal); assert.equal(event.type, "abort"); calls++; };
  const listener = () => { calls++; };
  signal.addEventListener("abort", listener);
  signal.removeEventListener("abort", listener);
  signal.addEventListener("abort", { handleEvent(event) { assert.equal(event.target, signal); calls++; } }, { once: true });
  assert.equal(signal.dispatchEvent(new Event("control")), true);
  signal.throwIfAborted();
  structural.abort(undefined);
  structural.abort(new Error("must not replace first reason"));
  assert.equal(calls, 2);
  assert.equal(signal.aborted, true);
  rejected(await settled(() => signal.throwIfAborted()), undefined);
  const native = new AbortController();
  native.abort(undefined);
  assert.ok(native.signal.reason instanceof DOMException);
  assert.equal(native.signal.reason.name, "AbortError");
  assert.notEqual(native.signal.reason, signal.reason);
});

for (const operation of operations) {
  for (const route of ["direct", "session"] as const) {
    const cases = route === "direct" ? [{ name: "structural-undefined", reason: undefined }, ...nativeReasons] : nativeReasons;
    for (const reasonCase of cases) for (const stage of ["preaborted", "startup", "active", "queued"] as const) {
      test(`${route} ${operation} ${reasonCase.name} ${stage} preserves rejection and sibling`, { timeout: 10000 }, async () => {
        const from = workers.length;
        const executor = new RegexExecutor({ maxWorkers: 1 });
        const structural = new StructuralAbortSignal();
        const native = new AbortController();
        const signal: AbortSignal = reasonCase.name === "structural-undefined" ? structural : native.signal;
        const abort = () => reasonCase.name === "structural-undefined" ? structural.abort(undefined) : native.abort(reasonCase.reason);
        let session: RegexSession | undefined;
        let sibling: Promise<Awaited<ReturnType<typeof settled>>> | undefined;
        const pending = () => route === "direct" ? direct(executor, operation, signal) : invoke(session ??= executor.open(signal), operation);
        try {
          if (stage === "preaborted") {
            abort();
            rejected(await settled(pending), signal.reason);
            assert.equal(workers.length, from);
            return;
          }
          if (stage === "queued") {
            holdRequest = true;
            sibling = settled(() => direct(executor, operation, new AbortController().signal));
            await until(() => workers[from]?.requests === 1);
          } else {
            holdReady = stage === "startup";
            holdRequest = stage === "active";
          }
          const result = settled(pending);
          await until(() => stage === "active" ? workers[from]?.requests === 1 : workers.length > from);
          await Promise.resolve();
          abort();
          rejected(await result, signal.reason);
          assert.equal(getEventListeners(signal, "abort").length, 0);
          if (stage === "queued") {
            assert.equal(workers[from]!.closed, false);
            assert.equal(workers[from]!.terminations, 0);
            assert.equal(workers[from]!.requests, 1);
            holdRequest = false;
            workers[from]!.release();
            succeeded(await sibling!, operation);
          } else {
            assert.equal(workers[from]!.closed, true);
            assert.equal(workers[from]!.requests, stage === "startup" ? 0 : 1);
          }
          holdReady = false;
          holdRequest = false;
          succeeded(await settled(() => direct(executor, operation, new AbortController().signal)), operation);
        } finally {
          holdReady = false;
          holdRequest = false;
          await session?.close();
          await executor.dispose();
          await sibling;
          clean(from);
        }
      });
    }
  }

  test(`${operation} natural structural success and native valid-context cleanup`, async () => {
    const from = workers.length;
    const executor = new RegexExecutor();
    let cleanup: InvocationCleanup | undefined;
    const context: CommandContext = {
      command: operation === "run" ? "grep" : "expr", args: [], cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
      registerCleanup(callback) { assert.equal(workers.length, from); cleanup = callback; },
    };
    try {
      const result = withRegexSession(context, executor, async session => {
        assert.ok(cleanup);
        succeeded(await settled(() => invoke(session, operation)), operation);
        return { exitCode: 0 };
      });
      assert.ok(cleanup, "cleanup registered synchronously");
      assert.deepEqual(await result, { exitCode: 0 });
      await Promise.all([cleanup(), cleanup()]);
      clean(from);
      const structural = new StructuralAbortSignal();
      succeeded(await settled(() => direct(executor, operation, structural)), operation);
      assert.equal(getEventListeners(structural, "abort").length, 1, "only fixture onabort listener remains");
    } finally { await executor.dispose(); clean(from); }
  });

  test(`${operation} active structural undefined awaits retirement before rejecting`, async () => {
    const from = workers.length;
    const executor = new RegexExecutor();
    const signal = new StructuralAbortSignal();
    let release!: () => void;
    retirementGate = new Promise<void>(resolve => { release = resolve; });
    holdRequest = true;
    let completed = false;
    const result = settled(() => direct(executor, operation, signal)).then(outcome => { completed = true; return outcome; });
    try {
      await until(() => workers[from]?.requests === 1);
      signal.abort(undefined);
      await until(() => workers[from]!.terminations === 1);
      assert.equal(completed, false);
      assert.equal(workers[from]!.closed, false);
      release();
      rejected(await result, undefined);
      assert.equal(workers[from]!.closed, true);
    } finally {
      release(); retirementGate = undefined; holdRequest = false;
      await executor.dispose(); await result; clean(from);
    }
  });

  test(`${operation} session preserves explicit transport rejection undefined`, async () => {
    const from = workers.length;
    const executor = new RegexExecutor();
    const session = executor.open(new AbortController().signal);
    throwUndefined = true;
    try { rejected(await settled(() => invoke(session, operation)), undefined); }
    finally { throwUndefined = false; await session.close(); await executor.dispose(); clean(from); }
  });
}
