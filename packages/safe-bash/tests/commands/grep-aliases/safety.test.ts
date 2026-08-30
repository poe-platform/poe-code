import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test, { after } from "node:test";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { createGrepAliasCommands, egrepCommand, fgrepCommand } from "../../../src/commands/grep-aliases/index.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/client.js";
import type { Request } from "../../../src/commands/regex-execution/protocol.js";
import type { ByteSource, InvocationCleanup } from "../../../src/contracts/index.js";
import { deferred, run } from "./helpers.js";

const workerModule = createRequire(import.meta.url)("node:worker_threads") as typeof import("node:worker_threads");
const originalWorker = workerModule.Worker;
const workers = new Set<Worker>();
const exited = new Set<Worker>();
class TrackedWorker extends originalWorker {
  constructor(filename: string | URL, options?: WorkerOptions) {
    super(filename, options);
    workers.add(this);
    this.once("exit", () => { exited.add(this); });
  }
}
workerModule.Worker = TrackedWorker;
syncBuiltinESMExports();
after(() => {
  workerModule.Worker = originalWorker;
  syncBuiltinESMExports();
  assert.equal(workers.size, exited.size);
  console.log(JSON.stringify({ actualWorkers: workers.size, exited: exited.size, active: workers.size - exited.size }));
});

for (const factory of [egrepCommand, fgrepCommand]) {
  const name = factory().name;
  test(`${name} registers cleanup synchronously before acquisition and shares completion`, { timeout: 5000 }, async () => {
    const original = RegexExecutor.prototype.open;
    const events: string[] = [];
    const callbacks: InvocationCleanup[] = [];
    RegexExecutor.prototype.open = function(signal) { events.push("open"); return original.call(this, signal); };
    try {
      assert.equal((await run(factory(), ["a"], "a\n", { registerCleanup(cleanup) { events.push("register"); callbacks.push(cleanup); } })).code, 0);
      assert.deepEqual(events, ["register", "open"]);
      assert.equal(callbacks.length, 1);
      const completion = callbacks[0]!();
      assert.equal(callbacks[0]!(), completion);
      await completion;
      events.length = 0;
      const reason = new Error("registrar refused");
      await assert.rejects(run(factory(), ["a"], "a\n", { registerCleanup() { throw reason; } }), error => error === reason);
      assert.deepEqual(events, []);
    } finally { RegexExecutor.prototype.open = original; }
  });

  test(`${name} already aborted input never acquires a session`, async () => {
    const controller = new AbortController();
    const reason = Object.assign(new Error("cancelled"), { code: "ENOENT" });
    controller.abort(reason);
    let registered = false;
    await assert.rejects(run(factory(), ["a"], "a\n", {
      signal: controller.signal, registerCleanup() { registered = true; },
    }), error => error === reason);
    assert.equal(registered, false);
  });

  test(`${name} cancellation awaits active worker retirement`, { timeout: 5000 }, async () => {
    const original = Worker.prototype.postMessage;
    const entered = deferred();
    const controller = new AbortController();
    const reason = new Error("cancel active matching");
    let activeWorker: Worker | undefined;
    Worker.prototype.postMessage = function(request: Request, transfer) {
      if (request.rows.length) { activeWorker = this; entered.resolve(); return; }
      original.call(this, request, transfer);
    };
    const execution = run(factory(), ["a"], "a\n", { signal: controller.signal });
    const rejected = assert.rejects(execution, error => error === reason);
    try {
      await entered.promise;
      controller.abort(reason);
      await rejected;
      assert.ok(activeWorker && exited.has(activeWorker));
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    } finally { Worker.prototype.postMessage = original; controller.abort(reason); await rejected; }
  });

  test(`${name} owned records survive Buffer reuse and source finalization`, async () => {
    const reused = Buffer.alloc(3);
    const source = (async function* () {
      try {
        reused.set(Buffer.from("a1\n")); yield reused.subarray();
        reused.set(Buffer.from("a2\n")); yield reused.subarray();
        reused.set(Buffer.from("a3!")); yield reused.subarray(0, 2);
      } finally { reused.fill(120); }
    })();
    const result = await run(factory(), ["a"], source);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), "a1\na2\na3\n");
    assert.equal(reused.toString(), "xxx");
  });

  test(`${name} awaits stdout backpressure before another write`, { timeout: 5000 }, async () => {
    const entered = deferred();
    const release = deferred();
    const output: Uint8Array[] = [];
    let writes = 0;
    let complete = false;
    const execution = run(factory(), ["a"], "a\na\n", { stdout: { async write(bytes) {
      writes++;
      if (writes === 1) { entered.resolve(); await release.promise; }
      output.push(Uint8Array.from(bytes));
    } } }).then(result => { complete = true; return result; });
    try {
      await entered.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(writes, 1);
      assert.equal(complete, false);
    } finally { release.resolve(); }
    assert.equal((await execution).code, 0);
    assert.equal(Buffer.concat(output).toString(), "a\na\n");
  });

  for (const destination of ["stdin", "stdout"] as const) test(`${name} aborts entered opaque ${destination} and observes late rejection`, { timeout: 5000 }, async () => {
    const entered = deferred();
    const controller = new AbortController();
    const reason = new Error(`abort ${destination}`);
    let rejectLate!: (error: unknown) => void;
    const opaque = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    const source: ByteSource = { [Symbol.asyncIterator]() { return { next() { entered.resolve(); return opaque; } }; } };
    const execution = run(factory(), ["a"], destination === "stdin" ? source : "a\n", {
      signal: controller.signal,
      ...(destination === "stdout" ? { stdout: { async write() { entered.resolve(); await opaque; } } } : {}),
    });
    const rejected = assert.rejects(execution, error => error === reason);
    try { await entered.promise; controller.abort(reason); await rejected; }
    finally { controller.abort(reason); rejectLate(new Error("late rejection")); }
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

  test(`${name} quiet early stop awaits cooperative source return`, { timeout: 5000 }, async () => {
    const returning = deferred();
    const release = deferred();
    let returns = 0;
    let reads = 0;
    let complete = false;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { reads++; assert.equal(reads, 1); return { done: false, value: Buffer.from("a\nlater\n") }; },
      async return() { returns++; returning.resolve(); await release.promise; return { done: true, value: undefined }; },
    }; } };
    const execution = run(factory(), ["-q", "a"], source).then(result => { complete = true; return result; });
    try { await returning.promise; assert.equal(complete, false); }
    finally { release.resolve(); }
    assert.equal((await execution).code, 0);
    assert.equal(returns, 1);
    assert.equal(reads, 1);
  });

  test(`${name} sink failure finalizes source and retains alias diagnostic`, async () => {
    let returns = 0;
    const failure = Object.assign(new Error("broken sink"), { code: "EPIPE" });
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: Buffer.from("a\n") }; },
      async return() { returns++; return { done: true, value: undefined }; },
    }; } };
    const result = await run(factory(), ["a"], source, { stdout: { async write() { throw failure; } } });
    assert.equal(result.code, 2);
    assert.equal(result.stderr.toString(), `${name}: broken sink\n`);
    assert.equal(returns, 1);
  });

  test(`${name} input error precedes return error and closes once`, async () => {
    let returns = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("input failed"); },
      async return(): Promise<IteratorResult<Uint8Array>> { returns++; throw new Error("return failed"); },
    }; } };
    const result = await run(factory(), ["a"], source);
    assert.equal(result.code, 2);
    assert.equal(result.stderr.toString(), `${name}: input failed\n`);
    assert.equal(returns, 1);
  });

  test(`${name} matching uses worker not host RegExp construction`, async () => {
    const original = globalThis.RegExp;
    globalThis.RegExp = new Proxy(original, {
      construct() { throw new Error("host RegExp forbidden"); },
      apply() { throw new Error("host RegExp forbidden"); },
    });
    try { assert.equal((await run(factory(), [name === "egrep" ? "a+" : "a+"], "aa\na+\n")).code, 0); }
    finally { globalThis.RegExp = original; }
  });
}

test("family aliases share executor worker and queue budgets", { timeout: 10000 }, async () => {
  const [extended, fixed] = createGrepAliasCommands({ regex: { maxWorkers: 1, maxQueuedRequests: 0, requestTimeoutMs: 5000 } });
  const original = Worker.prototype.postMessage;
  const entered = deferred();
  let held: { worker: Worker; request: Request } | undefined;
  Worker.prototype.postMessage = function(request: Request, transfer) {
    if (!held && request.rows.length) { held = { worker: this, request }; entered.resolve(); return; }
    original.call(this, request, transfer);
  };
  const initial = run(extended!, ["a"], "a\n");
  try {
    await entered.promise;
    const result = await run(fixed!, ["a"], "a\n");
    assert.equal(result.code, 2);
    assert.match(result.stderr.toString(), /^fgrep: regex QUEUE_EXHAUSTED:/);
  } finally {
    Worker.prototype.postMessage = original;
    if (held) original.call(held.worker, held.request);
    assert.equal((await initial).code, 0);
  }
  assert.equal((await run(fixed!, ["a"], "a\n")).code, 0);
});

test("request timeout option bounds a stalled actual matcher request", { timeout: 5000 }, async () => {
  const original = Worker.prototype.postMessage;
  let activeWorker: Worker | undefined;
  Worker.prototype.postMessage = function(request: Request, transfer) {
    if (request.rows.length) { activeWorker = this; return; }
    original.call(this, request, transfer);
  };
  try {
    const result = await run(egrepCommand({ regex: { requestTimeoutMs: 50 } }), ["a"], "a\n");
    assert.equal(result.code, 2);
    assert.match(result.stderr.toString(), /^egrep: regex REQUEST_TIMEOUT: active request exceeded 50ms\n$/);
    assert.ok(activeWorker && exited.has(activeWorker));
  } finally { Worker.prototype.postMessage = original; }
});

test("paused alias sink releases shared request capacity for sibling", { timeout: 5000 }, async () => {
  const [extended, fixed] = createGrepAliasCommands({ regex: { maxWorkers: 1, maxQueuedRequests: 0 } });
  const entered = deferred();
  const release = deferred();
  const initial = run(extended!, ["a"], "a\n", { stdout: { async write() { entered.resolve(); await release.promise; } } });
  try { await entered.promise; assert.equal((await run(fixed!, ["a"], "a\n")).code, 0); }
  finally { release.resolve(); await initial; }
});
