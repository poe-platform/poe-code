import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { FileSystem } from "../../../../src/contracts/index.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";
import { observeDescriptor, type DescriptorObservationSource } from "../../../../src/shell/descriptors.js";
import type { ShellExtensionContext, ShellInputObserver, ShellReadProbe } from "../../../../src/shell/extensions.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function override<Value extends object>(target: Value, replacements: Partial<Value>): Value {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const value: unknown = Reflect.get(object, key);
    return typeof value === "function" ? value.bind(object) : value;
  } });
}

function setup(execute: (context: ShellExtensionContext) => Promise<number>, fs: FileSystem = createMemoryFileSystem()) {
  const shell = new Shell({ fs, limits: { maxWallClockMs: 2000 }, extensions: [{ name: "observer-review", create: () => ({ builtins: [{ name: "observerreview", execute }] }) }] });
  return { shell, fs };
}

function owner(limits: ShellLimits = {}) {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits });
  const scope = new InvocationScope(budget.signal);
  return { budget, scope, async close() {
    try { await scope.close(); }
    finally { budget.close(); budget.values.close(); }
  } };
}

test("observer review: synchronous metadata reentry cannot finish release before the admitted probe drains", async context => {
  const backing = createMemoryFileSystem();
  const gate = deferred<void>();
  let observer!: ShellInputObserver;
  let releasing: Promise<void> | undefined;
  let releaseFinished = false;
  let metadataFinished = false;
  let earlyRelease = false;
  let closes = 0;
  const subject = setup(async invocation => {
    observer = invocation.input.observe(1);
    const rejected = assert.rejects(observer.probeRead(), { code: "EBADF" });
    try {
      await nextTurn();
      assert.ok(releasing);
      earlyRelease = releaseFinished && !metadataFinished;
      assert.equal(closes, 0);
      await assert.rejects(observer.probeRead(), { code: "EBADF" });
    } finally {
      gate.resolve();
      await Promise.all([rejected, releasing, observer.release()]);
    }
    await invocation.stdout.write(Uint8Array.of(255, 0, 254));
    return 0;
  }, override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async stat(options) {
        releasing = observer.release().then(() => { releaseFinished = true; });
        await gate.promise;
        metadataFinished = true;
        options?.signal?.throwIfAborted();
        return descriptor.stat(options);
      },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observerreview >out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(255, 0, 254));
  assert.equal(closes, 1);
  assert.equal(earlyRelease, false, "release settled while its synchronously admitted metadata was still pending");
});

test("observer review: source methods and forwarded wait options remain captured across pending metadata", async context => {
  const subject = owner();
  context.after(() => subject.close());
  const gate = deferred<void>();
  const entered = deferred<void>();
  const original = new AbortController();
  const replacement = new AbortController();
  replacement.abort(false);
  let probeReads = 0;
  let waitReads = 0;
  let readableReads = 0;
  let timeoutReads = 0;
  let signalReads = 0;
  let timeoutMs = 7.25;
  let forwarded = original.signal;
  let replaced = false;
  let waited = false;
  const source: DescriptorObservationSource = {
    get readable() { readableReads++; return !replaced; },
    get probeRead() {
      probeReads++;
      assert.equal(replaced, false);
      return async function(this: DescriptorObservationSource): Promise<ShellReadProbe> {
        assert.equal(this, source);
        entered.resolve();
        await gate.promise;
        return { readiness: "blocked", timeout: "honor" };
      };
    },
    get waitRead() {
      waitReads++;
      assert.equal(replaced, false);
      return async function(this: DescriptorObservationSource, options: { readonly timeoutMs: number; readonly signal: AbortSignal }) {
        assert.equal(this, source);
        assert.equal(options.timeoutMs, 7.25);
        assert.equal(options.signal.aborted, false);
        waited = true;
        return "timeout" as const;
      };
    },
  };
  const observer = observeDescriptor(source, subject.scope, subject.budget, subject.budget.signal);
  const pending = observer.waitRead({
    get timeoutMs() { timeoutReads++; return timeoutMs; },
    get signal() { signalReads++; return forwarded; },
  });
  await entered.promise;
  replaced = true;
  timeoutMs = -1;
  forwarded = replacement.signal;
  gate.resolve();
  assert.equal(await pending, "timeout");
  assert.equal(observer.readable, true);
  assert.equal(waited, true);
  assert.deepEqual([probeReads, waitReads, readableReads, timeoutReads, signalReads], [1, 1, 1, 1, 1]);
  await observer.release();
});

for (const reason of [false, 0, "", null, new Error("genuine metadata failure")]) {
  test(`observer review: genuine metadata rejection retains identity ${String(reason)}`, async context => {
    const backing = createMemoryFileSystem();
    let stats = 0;
    const subject = setup(async invocation => {
      const observer = invocation.input.observe(1);
      await assert.rejects(observer.probeRead(), error => Object.is(error, reason));
      await assert.rejects(observer.waitRead({ timeoutMs: 1 }), error => Object.is(error, reason));
      assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
      await observer.release();
      await invocation.stdout.write(Uint8Array.of(255));
      return 0;
    }, override(backing, { async open(path, options) {
      const descriptor = await backing.open!(path, options);
      return override(descriptor, { async stat(options) {
        if (++stats <= 2) throw reason;
        return descriptor.stat(options);
      } });
    } }));
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec("observerreview >out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(stats, 3);
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(255));
  });
}

for (const reason of [false, 0, "", null]) {
  test(`observer review: cancellation during metadata is local and retains identity ${String(reason)}`, async context => {
    const backing = createMemoryFileSystem();
    const entered = deferred<void>();
    const gate = deferred<void>();
    const controller = new AbortController();
    let metadataSignal: AbortSignal | undefined;
    let stats = 0;
    const subject = setup(async invocation => {
      const observer = invocation.input.observe(1);
      const rejected = assert.rejects(observer.waitRead({ timeoutMs: 10, signal: controller.signal }), error => Object.is(error, reason));
      await entered.promise;
      controller.abort(reason);
      const cancelled = metadataSignal?.aborted;
      const capturedReason = metadataSignal?.reason;
      gate.resolve();
      await rejected;
      assert.equal(cancelled, true);
      assert.ok(Object.is(capturedReason, reason));
      assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
      await observer.release();
      await invocation.stdout.write(Uint8Array.of(128));
      return 0;
    }, override(backing, { async open(path, options) {
      const descriptor = await backing.open!(path, options);
      return override(descriptor, { async stat(options) {
        if (++stats === 1) {
          metadataSignal = options?.signal;
          entered.resolve();
          await gate.promise;
          throw new Error("late genuine metadata failure");
        }
        return descriptor.stat(options);
      } });
    } }));
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec("observerreview >out");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(128));
  });
}

test("observer review: reentrant source release must enroll the current operation before calling its source", async context => {
  const subject = owner();
  context.after(() => subject.close());
  const gate = deferred<void>();
  const entered = deferred<void>();
  let releasing: Promise<void> | undefined;
  let releaseFinished = false;
  let metadataFinished = false;
  const observer: ShellInputObserver = observeDescriptor({ readable: true, async probeRead(signal) {
    releasing = observer.release().then(() => { releaseFinished = true; });
    entered.resolve();
    await gate.promise;
    metadataFinished = true;
    signal.throwIfAborted();
    return { readiness: "ready", timeout: "ignore" };
  } }, subject.scope, subject.budget, subject.budget.signal);
  const rejected = assert.rejects(observer.probeRead(), { code: "EBADF" });
  await entered.promise;
  await nextTurn();
  const earlyRelease = releaseFinished && !metadataFinished;
  gate.resolve();
  await Promise.all([rejected, releasing, observer.release()]);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  assert.equal(earlyRelease, false, "observer release completed before its reentrant source operation drained");
});

test("observer review: closed root scope refuses acquisition before source getters or allocation", async context => {
  const subject = owner();
  context.after(() => subject.close());
  await subject.scope.close();
  let touches = 0;
  const source: DescriptorObservationSource = { get readable() { touches++; return true; }, async probeRead() { touches++; return { readiness: "ready", timeout: "ignore" }; } };
  const before = subject.budget.values.usage;
  assert.throws(() => observeDescriptor(source, subject.scope, subject.budget, subject.budget.signal));
  assert.equal(touches, 0);
  assert.deepEqual(subject.budget.values.usage, before);
});

for (const maxExpansionBytes of [0, 64]) test(`observer review: acquisition failure at ${maxExpansionBytes} bytes retains cleanup and releases reservations`, async context => {
  const subject = owner({ maxExpansionBytes });
  context.after(() => subject.close());
  let touches = 0;
  let registrations = 0;
  const scope = override(subject.scope, { register(cleanup) { registrations++; return subject.scope.register(cleanup); } });
  const source: DescriptorObservationSource = { get readable() { touches++; return true; }, async probeRead() { touches++; return { readiness: "ready", timeout: "ignore" }; } };
  assert.throws(() => observeDescriptor(source, scope, subject.budget, subject.budget.signal), ShellLimitError);
  assert.equal(registrations, 1);
  assert.equal(touches, 0);
  await subject.scope.close();
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  assert.deepEqual(subject.scope.failures, []);
});

for (const rootReason of [false, 0, "", null]) test(`observer review: root reason ${String(rootReason)} outranks local cancellation and metadata failure`, async context => {
  const subject = owner();
  context.after(() => subject.close());
  const entered = deferred<void>();
  const gate = deferred<void>();
  const local = new AbortController();
  const observer = observeDescriptor({ readable: true, async probeRead() {
    entered.resolve();
    await gate.promise;
    throw new Error("metadata failure after both cancellations");
  } }, subject.scope, subject.budget, subject.budget.signal);
  const rejected = assert.rejects(observer.waitRead({ timeoutMs: 1, signal: local.signal }), error => Object.is(error, rootReason));
  await entered.promise;
  local.abort(new Error("local observer cancellation"));
  subject.budget.controller.abort(rootReason);
  const closing = subject.scope.close();
  gate.resolve();
  await Promise.all([closing, rejected]);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  assert.deepEqual(subject.scope.failures, []);
});

for (const probe of [
  { readiness: "unknown", timeout: "honor" },
  { readiness: "blocked", timeout: "unknown" },
  { readiness: "blocked", timeout: "ignore" },
] as const) test(`observer review: ${probe.readiness}/${probe.timeout} does not invent a wait capability`, async context => {
  const subject = owner();
  context.after(() => subject.close());
  let waits = 0;
  const observer = observeDescriptor({ readable: false, async probeRead() { return probe; }, async waitRead() { waits++; return "ready"; } }, subject.scope, subject.budget, subject.budget.signal);
  assert.equal(await observer.waitRead({ timeoutMs: 0.125 }), "unknown");
  assert.equal(waits, 0);
  assert.equal(observer.readable, false);
  await observer.release();
});

test("observer review: concurrent operation reserve failure cancels and drains earlier metadata", async context => {
  const subject = owner({ maxExpansionBytes: 500 });
  context.after(() => subject.close());
  const gate = deferred<void>();
  const entered = deferred<void>();
  let calls = 0;
  let firstSignal: AbortSignal | undefined;
  const observer = observeDescriptor({ readable: true, async probeRead(signal) {
    calls++;
    firstSignal = signal;
    entered.resolve();
    await gate.promise;
    signal.throwIfAborted();
    return { readiness: "blocked", timeout: "honor" };
  } }, subject.scope, subject.budget, subject.budget.signal);
  const first = assert.rejects(observer.probeRead(), ShellLimitError);
  await entered.promise;
  await assert.rejects(observer.probeRead(), ShellLimitError);
  assert.equal(calls, 1);
  assert.equal(firstSignal?.aborted, true);
  let released = false;
  const releasing = observer.release().then(() => { released = true; });
  await nextTurn();
  const earlyRelease = released;
  gate.resolve();
  await Promise.all([first, releasing]);
  assert.equal(earlyRelease, false);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("observer review: repeated release joins every concurrent probe and closes new admission", async context => {
  const subject = owner();
  context.after(() => subject.close());
  const gates = [deferred<void>(), deferred<void>()];
  let calls = 0;
  const observer = observeDescriptor({ readable: true, async probeRead(signal) {
    const gate = gates[calls++];
    assert.ok(gate);
    await gate.promise;
    signal.throwIfAborted();
    return { readiness: "ready", timeout: "ignore" };
  } }, subject.scope, subject.budget, subject.budget.signal);
  const probes = [assert.rejects(observer.probeRead(), { code: "EBADF" }), assert.rejects(observer.probeRead(), { code: "EBADF" })];
  let released = 0;
  const releases = [observer.release().then(() => { released++; }), observer.release().then(() => { released++; })];
  gates[0]!.resolve();
  await nextTurn();
  const earlyReleases = released;
  await assert.rejects(observer.probeRead(), { code: "EBADF" });
  await assert.rejects(observer.waitRead({ timeoutMs: 1 }), { code: "EBADF" });
  gates[1]!.resolve();
  await Promise.all([...probes, ...releases]);
  assert.equal(earlyReleases, 0);
  assert.equal(released, 2);
  assert.equal(calls, 2);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("observer review: unknown readable source remains unknown without producer pulls or read access changes", async context => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  let pulls = 0;
  let returns = 0;
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; return { done: false, value: Uint8Array.of(255, 0, 10) }; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } }, budget, budget.signal);
  const subject = setup(async invocation => {
    const observer = invocation.input.observe(0);
    assert.equal(observer.readable, true);
    assert.deepEqual(await observer.probeRead(), { readiness: "unknown", timeout: "unknown" });
    assert.equal(await observer.waitRead({ timeoutMs: 0.5 }), "unknown");
    await observer.release();
    assert.deepEqual([pulls, returns], [0, 0]);
    const borrowed = invocation.input.borrow(0);
    const record = await borrowed.record();
    assert.equal(pulls, 1);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await record.release();
    await borrowed.release();
    return 0;
  });
  context.after(async () => {
    try { await subject.shell.dispose(); await input.close(); }
    finally { budget.close(); budget.values.close(); }
  });
  const result = await subject.shell.exec("observerreview", { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
});
