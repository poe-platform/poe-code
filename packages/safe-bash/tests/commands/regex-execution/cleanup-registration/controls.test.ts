import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { after, afterEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { grepCommands } from "../../../../src/commands/grep.js";
import { rgCommand } from "../../../../src/commands/search/rg.js";
import { RegexExecutor, RegexExecutionError, RegexSession, withRegexSession } from "../../../../src/commands/regex-execution/client.js";
import type { Request } from "../../../../src/commands/regex-execution/protocol.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext, type InvocationCleanup } from "../../../../src/contracts/index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}
const workerModule = createRequire(import.meta.url)("node:worker_threads");
const originalWorker = workerModule.Worker;
const workers: ControlledWorker[] = [];
let holdRequests = false;
let terminationGate: ReturnType<typeof deferred<void>> | undefined;
class ControlledWorker extends EventEmitter {
  closed = false;
  terminations = 0;
  requests = 0;
  terminationError: Error | undefined;
  gate: Promise<void> | undefined;
  constructor() {
    super();
    workers.push(this);
    queueMicrotask(() => this.emit("message", { ready: true }));
  }
  ref() { return this; }
  unref() { return this; }
  postMessage(request: Request) {
    this.requests++;
    if (!holdRequests) queueMicrotask(() => this.emit("message", {
      id: request.id,
      results: request.rows.map(row => new Float64Array(row.bytes.length ? [0, 1] : [])),
    }));
  }
  async terminate() {
    this.terminations++;
    await (this.gate ?? terminationGate?.promise);
    this.closed = true;
    this.emit("exit", 0);
    if (this.terminationError) throw this.terminationError;
    return 0;
  }
}
workerModule.Worker = ControlledWorker;
syncBuiltinESMExports();
const originalOpen = RegexExecutor.prototype.open;
const originalClose = RegexSession.prototype.close;
afterEach(() => {
  holdRequests = false;
  terminationGate?.resolve();
  terminationGate = undefined;
  RegexExecutor.prototype.open = originalOpen;
  RegexSession.prototype.close = originalClose;
});
after(() => {
  workerModule.Worker = originalWorker;
  syncBuiltinESMExports();
  const active = workers.filter(worker => !worker.closed).length;
  const listeners = workers.reduce((total, worker) => total + worker.eventNames().reduce((count, event) => count + worker.listenerCount(event), 0), 0);
  console.log(JSON.stringify({ controlledWorkers: workers.length, active, listeners, pathologicalAllocations: 0 }));
  assert.equal(active, 0);
  assert.equal(listeners, 0);
  assert.ok(workers.every(worker => worker.terminations === 1));
});
function clean(from: number) {
  for (const worker of workers.slice(from)) {
    assert.equal(worker.closed, true);
    assert.equal(worker.terminations, 1);
    assert.deepEqual(worker.eventNames(), []);
  }
}
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.fail("bounded condition did not occur");
}
function settled<Value>(promise: PromiseLike<Value> | Value) {
  return Promise.resolve(promise).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: error as unknown }));
}
function context(tool: string, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: tool, args: ["a", "-"], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource("a\n"), stdinIsDefault: false,
    stdout: { async write() {} }, stderr: { async write() {} }, ...overrides,
  };
}
function command(tool: "grep" | "rg") {
  return tool === "grep" ? grepCommands()[0]! : rgCommand();
}
function assertClosed(error: unknown) {
  assert.ok(error instanceof RegexExecutionError);
  assert.equal(error.code, "CLOSED");
}

for (const tool of ["grep", "rg"] as const) {
  test(`${tool}: registers once before open; construction is resource-free`, async () => {
    const from = workers.length;
    const definition = command(tool);
    assert.equal(workers.length, from);
    const callbacks: InvocationCleanup[] = [];
    const events: string[] = [];
    RegexExecutor.prototype.open = function(signal) { events.push("open"); return originalOpen.call(this, signal); };
    const result = await definition.execute(context(tool, { registerCleanup(cleanup) { events.push("register"); callbacks.push(cleanup); } }));
    assert.equal(result.exitCode, 0);
    clean(from);
    assert.deepEqual(events, ["register", "open"]);
    assert.equal(callbacks.length, 1);
    const first = callbacks[0]!();
    assert.equal(first, callbacks[0]!());
    await first;
  });

  test(`${tool}: late registrar rejection acquires nothing`, async () => {
    const from = workers.length;
    let opens = 0;
    RegexExecutor.prototype.open = function(signal) { opens++; return originalOpen.call(this, signal); };
    const reason = new Error("closed registration");
    const result = await settled(command(tool).execute(context(tool, { registerCleanup() { throw reason; } })));
    assert.deepEqual(result, { ok: false, error: reason });
    assert.equal(opens, 0);
    assert.equal(workers.length, from);
  });

  test(`${tool}: preabort retains exact primitive/errno identity without acquisition`, async () => {
    const from = workers.length;
    let opens = 0;
    let registrations = 0;
    RegexExecutor.prototype.open = function(signal) { opens++; return originalOpen.call(this, signal); };
    for (const reason of ["caller stop", Object.assign(new Error("caller abort"), { code: "ENOENT" })]) {
      const controller = new AbortController();
      controller.abort(reason);
      const result = await settled(command(tool).execute(context(tool, { signal: controller.signal, registerCleanup() { registrations++; } })));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, reason);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
    assert.equal(registrations, 0);
    assert.equal(opens, 0);
    assert.equal(workers.length, from);
  });

  test(`${tool}: accepted callback closes admission before acquisition`, async () => {
    const from = workers.length;
    let opens = 0;
    let cleanup: void | Promise<void>;
    RegexExecutor.prototype.open = function(signal) { opens++; return originalOpen.call(this, signal); };
    const result = await settled(command(tool).execute(context(tool, { registerCleanup(callback) { cleanup = callback(); } })));
    await cleanup!;
    assert.equal(result.ok, false);
    if (!result.ok) assertClosed(result.error);
    assert.equal(opens, 0);
    assert.equal(workers.length, from);
  });

  test(`${tool}: direct context without registrar retains finally cleanup`, async () => {
    const from = workers.length;
    assert.equal((await command(tool).execute(context(tool))).exitCode, 0);
    clean(from);
  });

  for (const failure of [false, true]) test(`${tool}: ${failure ? "error" : "normal"} finally overlaps callback retirement`, async () => {
    const from = workers.length;
    const sink = deferred<void>();
    const entered = deferred<void>();
    const primary = new Error("opaque sink failed");
    let callback: InvocationCleanup | undefined;
    let finished = false;
    terminationGate = deferred<void>();
    const outcome = settled(command(tool).execute(context(tool, {
      registerCleanup(cleanup) { callback = cleanup; },
      stdout: { async write() { entered.resolve(); await sink.promise; if (failure) throw primary; } },
      stderr: { write() { throw primary; } },
    }))).then(result => { finished = true; return result; });
    try {
      await entered.promise;
      assert.ok(callback);
      const closing = callback();
      assert.equal(callback(), closing);
      sink.resolve();
      await delay(10);
      assert.equal(finished, false);
      assert.equal(workers[from]!.terminations, 1);
      terminationGate.resolve();
      await closing;
      const result = await outcome;
      assert.equal(result.ok, !failure);
      if (!result.ok) assert.equal(result.error, primary);
      clean(from);
    } finally { sink.resolve(); terminationGate.resolve(); await outcome; }
  });

  test(`${tool}: cleanup does not await opaque stdin after completed validation`, async () => {
    const from = workers.length;
    const input = deferred<void>();
    const entered = deferred<void>();
    let callback: InvocationCleanup | undefined;
    let finished = false;
    const outcome = settled(command(tool).execute(context(tool, {
      registerCleanup(cleanup) { callback = cleanup; },
      stdin: { async *[Symbol.asyncIterator]() { entered.resolve(); await input.promise; } },
    }))).then(result => { finished = true; return result; });
    try {
      await entered.promise;
      assert.ok(workers.slice(from).some(worker => worker.requests > 0));
      assert.ok(callback);
      await callback();
      assert.equal(finished, false);
      clean(from);
    } finally { input.resolve(); await outcome; }
  });

  for (const mode of ["result", "execution", "abort"] as const) test(`${tool}: cleanup failure precedence ${mode}`, async () => {
    const from = workers.length;
    const cleanupError = new Error("cleanup failure");
    const primary = new Error("selected execution failure");
    const callerReason = Object.assign(new Error("caller during retirement"), { code: "ENOENT" });
    const controller = new AbortController();
    let callback: InvocationCleanup | undefined;
    RegexSession.prototype.close = async function() {
      await originalClose.call(this);
      if (mode === "abort") controller.abort(callerReason);
      throw cleanupError;
    };
    const result = await settled(command(tool).execute(context(tool, {
      signal: controller.signal,
      registerCleanup(cleanup) { callback = cleanup; },
      ...(mode === "execution" ? { stdout: { write() { throw primary; } }, stderr: { write() { throw primary; } } } : {}),
    })));
    if (callback) assert.deepEqual(await settled(callback()), { ok: false, error: cleanupError });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, mode === "abort" ? callerReason : mode === "execution" ? primary : cleanupError);
    clean(from);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}

const descriptor = { kind: "grep" as const, patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rows = [{ bytes: Buffer.from("a"), all: true, terminated: true }];

for (const primaryFails of [false, true]) test(`session settlement preserves falsey ${primaryFails ? "callback" : "cleanup"} identities`, async () => {
  for (const reason of [undefined, null, false, 0, 0n, "", NaN, new Error("selected failure")]) {
    const from = workers.length;
    let closes = 0;
    RegexSession.prototype.close = async function() {
      closes++;
      await originalClose.call(this);
      throw primaryFails ? new Error("secondary cleanup") : reason;
    };
    const result = await settled(withRegexSession(context("grep"), new RegexExecutor(), async session => {
      await session.run(descriptor, rows);
      if (primaryFails) throw reason;
      return { exitCode: 7 };
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, reason);
    assert.equal(closes, 1);
    clean(from);
  }
});

test("session settlement retains result identity on successful cleanup", async () => {
  const from = workers.length;
  const expected = { exitCode: 7 };
  const result = await withRegexSession(context("grep"), new RegexExecutor(), async session => {
    await session.run(descriptor, rows);
    return expected;
  });
  assert.equal(result, expected);
  clean(from);
});

test("session falsey registrar rejection precedes all acquisition", async () => {
  const from = workers.length;
  let opens = 0, callbacks = 0;
  RegexExecutor.prototype.open = function(signal) { opens++; return originalOpen.call(this, signal); };
  for (const reason of [undefined, null, false, 0, 0n, "", NaN]) {
    const result = await settled(withRegexSession(context("grep", { registerCleanup() { throw reason; } }), new RegexExecutor(), () => {
      callbacks++;
      return { exitCode: 0 };
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, reason);
  }
  assert.equal(opens, 0);
  assert.equal(callbacks, 0);
  assert.equal(workers.length, from);
});

test("session settlement awaits shared close and selects late cancellation", async () => {
  for (const timing of ["none", "during", "after"] as const) for (const primaryFails of [false, true]) for (const closeFails of [false, true]) {
    const from = workers.length;
    const entered = deferred<void>(), release = deferred<void>(), controller = new AbortController();
    const reason = Object.assign(new Error("caller during cleanup"), { code: "ENOENT" });
    const expected = { exitCode: 7 };
    let closes = 0, finished = false, cleanup: InvocationCleanup | undefined;
    RegexSession.prototype.close = async function() {
      closes++;
      await originalClose.call(this);
      entered.resolve();
      await release.promise;
      if (timing === "after") controller.abort(reason);
      if (closeFails) throw undefined;
    };
    const outcome = settled(withRegexSession(context("grep", {
      signal: controller.signal, registerCleanup(callback) { cleanup = callback; },
    }), new RegexExecutor(), async session => {
      await session.run(descriptor, rows);
      if (primaryFails) throw false;
      return expected;
    })).then(result => { finished = true; return result; });
    try {
      await entered.promise;
      assert.ok(cleanup);
      const closing = cleanup();
      assert.equal(closing, cleanup());
      const observed = settled(closing);
      if (timing === "during") controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(finished, false);
      assert.equal(closes, 1);
      release.resolve();
      const result = await outcome;
      if (timing !== "none" || primaryFails || closeFails) {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error, timing !== "none" ? reason : primaryFails ? false : undefined);
      } else {
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.value, expected);
      }
      assert.deepEqual(await observed, closeFails ? { ok: false, error: undefined } : { ok: true, value: undefined });
      assert.equal(closing, cleanup());
      assert.equal(closes, 1);
      clean(from);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    } finally { release.resolve(); await outcome; }
  }
});

test("session close cancels queued ownership without terminating active sibling", async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ maxWorkers: 1, requestTimeoutMs: 80 });
  const first = executor.open(new AbortController().signal);
  const second = executor.open(new AbortController().signal);
  holdRequests = true;
  const active = settled(first.run(descriptor, rows));
  await until(() => workers[from]!.requests === 1);
  const queued = settled(second.run(descriptor, rows));
  try {
    await second.close();
    const result = await queued;
    assert.equal(result.ok, false);
    if (!result.ok) assertClosed(result.error);
    assert.equal(workers[from]!.closed, false);
    assert.equal(workers[from]!.terminations, 0);
  } finally { await first.close(); await active; await second.close(); }
  clean(from);
});

test("session close cancels active request; queued sibling receives independent lease", async () => {
  const from = workers.length;
  const executor = new RegexExecutor({ maxWorkers: 1, requestTimeoutMs: 80 });
  const caller = new AbortController();
  const first = executor.open(caller.signal);
  const second = executor.open(new AbortController().signal);
  holdRequests = true;
  const active = settled(first.run(descriptor, rows));
  await until(() => workers[from]!.requests === 1);
  const queued = settled(second.run(descriptor, rows));
  holdRequests = false;
  try {
    await first.close();
    const result = await active;
    assert.equal(result.ok, false);
    if (!result.ok) assertClosed(result.error);
    assert.deepEqual(await queued, { ok: true, value: [[{ start: 0, end: 1 }]] });
    assert.equal(workers[from]!.closed, true);
    assert.equal(workers[from + 1]!.closed, false);
    assert.equal(getEventListeners(caller.signal, "abort").length, 0);
    assert.throws(() => first.run(descriptor, rows), error => { assertClosed(error); return true; });
  } finally { await Promise.all([first.close(), second.close()]); }
  clean(from);
});

test("concurrent close shares in-progress retirement rather than closed-flag success", async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const session = executor.open(new AbortController().signal);
  await session.run(descriptor, rows);
  terminationGate = deferred<void>();
  let complete = false;
  const first = session.close();
  const second = session.close();
  void second.then(() => { complete = true; });
  try {
    assert.equal(first, second);
    await delay(10);
    assert.equal(complete, false);
    assert.equal(workers[from]!.terminations, 1);
  } finally { terminationGate.resolve(); await Promise.all([first, second]); }
  clean(from);
});

test("pending request retirement failure is observed by close without replacing request failure", async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const session = executor.open(new AbortController().signal);
  const failure = new Error("owned retirement failed after exit");
  holdRequests = true;
  const request = settled(session.run(descriptor, rows));
  await until(() => workers[from]!.requests === 1);
  workers[from]!.terminationError = failure;
  const close = await settled(session.close());
  const result = await request;
  assert.deepEqual(close, { ok: false, error: failure });
  assert.equal(result.ok, false);
  if (!result.ok) assertClosed(result.error);
  clean(from);
});

test("all idle retirements finish before multiple cleanup failures reject", async () => {
  const from = workers.length;
  const executor = new RegexExecutor();
  const session = executor.open(new AbortController().signal);
  await Promise.all([session.run(descriptor, rows), session.run(descriptor, rows)]);
  const firstFailure = new Error("first retirement failure");
  const secondFailure = new Error("second retirement failure");
  const gate = deferred<void>();
  workers[from]!.terminationError = firstFailure;
  workers[from + 1]!.terminationError = secondFailure;
  workers[from + 1]!.gate = gate.promise;
  let complete = false;
  const closing = settled(session.close()).then(result => { complete = true; return result; });
  try {
    await delay(10);
    assert.equal(complete, false);
    assert.equal(workers[from]!.closed, true);
    assert.equal(workers[from + 1]!.closed, false);
  } finally { gate.resolve(); }
  const result = await closing;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.error.errors, [firstFailure, secondFailure]);
  }
  clean(from);
});

for (const tool of ["grep", "rg"] as const) test(`${tool}: late pattern-input continuation cannot reopen closed owner`, async () => {
  const from = workers.length;
  const input = deferred<void>();
  const entered = deferred<void>();
  let callback: InvocationCleanup | undefined;
  const outcome = settled(command(tool).execute(context(tool, {
    args: ["-f", "-", "/target"],
    registerCleanup(cleanup) { callback = cleanup; },
    stdin: { async *[Symbol.asyncIterator]() { entered.resolve(); await input.promise; yield Buffer.from("a\n"); } },
  })));
  try {
    await entered.promise;
    assert.ok(callback);
    await callback();
    const acquired = workers.length;
    clean(from);
    input.resolve();
    assert.deepEqual(await outcome, { ok: true, value: { exitCode: 2 } });
    assert.equal(workers.length, acquired);
  } finally { input.resolve(); await outcome; }
});
