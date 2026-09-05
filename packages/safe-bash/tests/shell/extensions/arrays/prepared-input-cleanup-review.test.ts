import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem, FsOptions } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { openCommandFile } from "../../../../src/contracts/filesystem-descriptor.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { inputBufferUsage, prepareFileInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";

type Kind = "descriptor" | "prepared" | "legacy";
type Mode = "omitted" | "undefined" | "supplied";
type Context = Parameters<typeof prepareFileInput>[0] & { cleanupFailurePrioritySignal?: AbortSignal | undefined };

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function intercept<Target extends object>(target: Target, overrides: Partial<Target>): Target {
  return new Proxy(target, { get(original, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(original, key, original);
    return typeof value === "function" ? value.bind(original) : value;
  } });
}

async function fixture(kind: Kind, mode: Mode = "supplied", priorityIsBudgetRoot = false) {
  const memory = new MemoryFileSystem(), parent = new AbortController(), priority = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, priorityIsBudgetRoot ? priority.signal : undefined);
  await memory.writeFile("/input", Uint8Array.of(255, 0, 10));
  const cleanups: (() => void | Promise<void>)[] = [];
  const hooks: {
    open?: () => Promise<void>;
    read?: (buffer: Uint8Array, options?: FsOptions) => Promise<number>;
    legacyRead?: () => Promise<IteratorResult<Uint8Array>>;
    close?: () => Promise<void>;
  } = {};
  let opens = 0, reads = 0, closes = 0;
  const fs: FileSystem = kind === "legacy" ? intercept<FileSystem>(memory, {
    readStream() { return { [Symbol.asyncIterator]() { opens++; return {
      async next() { reads++; return hooks.legacyRead ? hooks.legacyRead() : reads === 1 ? { done: false, value: Uint8Array.of(255, 0, 10) } : { done: true, value: undefined }; },
      async return() { closes++; await hooks.close?.(); return { done: true, value: undefined }; },
    }; } }; },
  }) : intercept<FileSystem>(memory, { async open(path, options) {
    await hooks.open?.();
    opens++;
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, {
      async read(buffer, position, options) { reads++; return hooks.read ? hooks.read(buffer, options) : descriptor.read(buffer, position, options); },
      async close() { closes++; await descriptor.close(); await hooks.close?.(); },
    });
  } });
  if (kind === "legacy") Object.defineProperty(fs, "open", { value: undefined });
  const context: Context = { fs, signal: parent.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } };
  if (mode !== "omitted") context.cleanupFailurePrioritySignal = mode === "supplied" ? priority.signal : undefined;
  let close: (() => Promise<void>) | undefined;
  return { kind, budget, parent, priority, context, hooks, cleanups,
    get opens() { return opens; }, get reads() { return reads; }, get closes() { return closes; },
    async acquire() {
      if (kind === "descriptor") {
        const descriptor = await openCommandFile(context, "/input", { access: "read", signal: parent.signal });
        close = descriptor.close;
        return { close: descriptor.close, descriptor, next: async () => {
          const bytes = new Uint8Array(3), length = await descriptor.read(bytes, null);
          return length ? { done: false as const, value: bytes.subarray(0, length) } : { done: true as const, value: undefined };
        } };
      }
      const prepared = await prepareFileInput(context, "/input", budget);
      close = prepared.close;
      return { close: prepared.close, descriptor: undefined, next: () => prepared.source[Symbol.asyncIterator]().next() };
    },
    async dispose() {
      try {
        await Promise.allSettled([...(close ? [close()] : []), ...cleanups.map(cleanup => Promise.resolve().then(cleanup))]);
        assert.equal(closes, opens);
        assert.deepEqual(inputBufferUsage(budget), { bytes: 0, buffers: 0 });
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

const kinds: readonly Kind[] = ["descriptor", "prepared", "legacy"];
const failures = [undefined, null, false, 0, -0, "", NaN, new FsError("EIO"), new FsError("EPIPE")];

for (const kind of kinds) for (const reason of failures) test(`cleanup review: ${kind} supplied priority retains raw ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  subject.hooks.close = async () => { throw reason; };
  const resource = await subject.acquire();
  subject.parent.abort(new Error("handled local stop"));
  const closing = resource.close();
  assert.equal(resource.close(), closing);
  await assert.rejects(closing, error => Object.is(error, reason));
  for (const [index, cleanup] of subject.cleanups.entries()) await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, kind === "legacy" && index === 1 ? subject.parent.signal.reason : reason));
  assert.equal(subject.closes, 1);
});

for (const kind of kinds) for (const mode of ["omitted", "undefined"] as const) test(`cleanup review: ${kind} ${mode} preserves the legacy direct-versus-registered cancellation behavior`, async context => {
  const subject = await fixture(kind, mode);
  context.after(() => subject.dispose());
  const failure = new FsError("EIO");
  subject.hooks.close = async () => { throw failure; };
  const resource = await subject.acquire();
  subject.parent.abort(false);
  await assert.rejects(resource.close(), error => Object.is(error, kind === "descriptor" ? failure : false));
  for (const cleanup of subject.cleanups) await assert.rejects(Promise.resolve().then(cleanup), error => error === false);
});

for (const kind of kinds) test(`cleanup review: ${kind} captures priority once and does not subscribe it as an operation signal`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  const replacement = new AbortController();
  replacement.abort(new Error("replacement priority must never be used"));
  let current = subject.priority.signal, captures = 0, subscriptions = 0;
  Object.defineProperty(subject.context, "cleanupFailurePrioritySignal", { get() { captures++; return current; } });
  context.mock.method(subject.priority.signal, "addEventListener", () => { subscriptions++; throw new Error("Failure priority must not allocate an abort subscription"); });
  const resource = await subject.acquire();
  assert.equal(captures, 1);
  current = replacement.signal;
  subject.hooks.close = async () => { throw 0; };
  subject.parent.abort(new Error("handled local stop"));
  await assert.rejects(resource.close(), error => Object.is(error, 0));
  for (const [index, cleanup] of subject.cleanups.entries()) await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, kind === "legacy" && index === 1 ? subject.parent.signal.reason : 0));
  assert.equal(captures, 1);
  assert.equal(subscriptions, 0);
});

for (const kind of kinds) test(`cleanup review: ${kind} already-aborted priority does not cancel acquisition, ordinary reads, or successful cleanup`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  subject.priority.abort(false);
  const resource = await subject.acquire();
  const result = await resource.next();
  assert.equal(result.done, false);
  assert.deepEqual(result.value, Uint8Array.of(255, 0, 10));
  await resource.close();
  for (const cleanup of subject.cleanups) await cleanup();
  assert.equal(subject.closes, 1);
});

for (const kind of kinds) test(`cleanup review: ${kind} successful teardown still reports local cancellation through registered cleanup`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  const resource = await subject.acquire();
  subject.parent.abort("");
  if (kind === "descriptor") await resource.close();
  else await assert.rejects(resource.close(), error => error === "");
  for (const cleanup of subject.cleanups) await assert.rejects(Promise.resolve().then(cleanup), error => error === "");
  assert.equal(subject.closes, 1);
});

for (const kind of kinds) test(`cleanup review: ${kind} ordinary read failure is not relabeled by a separate priority cancellation or close failure`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  subject.priority.abort(new Error("cleanup priority only"));
  subject.hooks.read = async () => { throw false; };
  subject.hooks.legacyRead = async () => { throw false; };
  const failure = new FsError("EIO");
  subject.hooks.close = async () => { throw failure; };
  const resource = await subject.acquire();
  await assert.rejects(resource.next(), error => error === false);
  await assert.rejects(resource.close(), error => error === (kind === "descriptor" ? failure : subject.priority.signal.reason));
  for (const [index, cleanup] of subject.cleanups.entries()) {
    if (kind === "legacy" && index === 1) await cleanup();
    else await assert.rejects(Promise.resolve().then(cleanup), error => error === subject.priority.signal.reason);
  }
});

for (const kind of kinds) test(`cleanup review: ${kind} local operation cancellation stays separate from the genuine teardown failure`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  const failure = new FsError("EIO");
  subject.hooks.read = async () => { subject.parent.abort(false); throw null; };
  subject.hooks.legacyRead = async () => { subject.parent.abort(false); throw null; };
  subject.hooks.close = async () => { throw failure; };
  const resource = await subject.acquire();
  await assert.rejects(resource.next(), error => error === false);
  await assert.rejects(resource.close(), error => error === failure);
  for (const [index, cleanup] of subject.cleanups.entries()) await assert.rejects(Promise.resolve().then(cleanup), error => error === (kind === "legacy" && index === 1 ? subject.parent.signal.reason : failure));
});

for (const kind of kinds) for (const reason of [false, null, 0, ""]) test(`cleanup review: ${kind} captured root reason ${JSON.stringify(reason)} wins while genuine close is pending`, async context => {
  const subject = await fixture(kind), entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.dispose());
  const failure = new FsError("EIO");
  subject.hooks.close = async () => { entered.resolve(); await gate.promise; throw failure; };
  const resource = await subject.acquire();
  subject.parent.abort(new Error("handled stage stop"));
  const closing = resource.close();
  const rejection = assert.rejects(closing, error => Object.is(error, kind === "descriptor" ? failure : reason));
  await entered.promise;
  subject.priority.abort(reason);
  gate.resolve();
  await rejection;
  for (const [index, cleanup] of subject.cleanups.entries()) await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, kind === "legacy" && index === 1 ? subject.parent.signal.reason : reason));
});

for (const kind of kinds) test(`cleanup review: ${kind} late root cancellation wins in registered cleanup without changing cached close rejection`, async context => {
  const subject = await fixture(kind, "supplied", true);
  context.after(() => subject.dispose());
  const failure = new FsError("EIO");
  subject.hooks.close = async () => { throw failure; };
  const resource = await subject.acquire();
  const closing = resource.close();
  await assert.rejects(closing, error => error === failure);
  subject.priority.abort(false);
  assert.equal(resource.close(), closing);
  await assert.rejects(resource.close(), error => error === failure);
  for (const cleanup of subject.cleanups) await assert.rejects(Promise.resolve().then(cleanup), error => error === false);
});

test("cleanup review: acknowledgement retains successful-cleanup checks instead of consulting failure-only priority", async context => {
  const subject = await fixture("descriptor");
  context.after(() => subject.dispose());
  const failure = new FsError("EIO");
  subject.hooks.close = async () => { throw failure; };
  const resource = await subject.acquire();
  assert.ok(resource.descriptor);
  assert.equal(resource.descriptor.acknowledgeCloseFailure(failure), false);
  const closing = resource.close();
  await assert.rejects(closing, error => error === failure);
  assert.equal(resource.descriptor.acknowledgeCloseFailure(new FsError("EIO")), false);
  assert.equal(resource.descriptor.acknowledgeCloseFailure(failure), true);
  for (const cleanup of subject.cleanups) await cleanup();
  subject.priority.abort(null);
  for (const cleanup of subject.cleanups) await cleanup();
  subject.parent.abort(null);
  for (const cleanup of subject.cleanups) await assert.rejects(Promise.resolve().then(cleanup), error => error === null);
  assert.equal(resource.close(), closing);
  await assert.rejects(resource.close(), error => error === failure);
});

test("cleanup review: supplied priority does not authorize acknowledgement after local cancellation", async context => {
  const subject = await fixture("descriptor");
  context.after(() => subject.dispose());
  subject.hooks.close = async () => { throw false; };
  const resource = await subject.acquire();
  assert.ok(resource.descriptor);
  await assert.rejects(resource.close(), error => error === false);
  subject.parent.abort(new Error("local canceled"));
  assert.equal(resource.descriptor.acknowledgeCloseFailure(false), false);
  for (const cleanup of subject.cleanups) await assert.rejects(Promise.resolve().then(cleanup), error => error === false);
});

for (const kind of kinds) test(`cleanup review: ${kind} concurrent registered cleanup drains one pending close and closes admission`, async context => {
  const subject = await fixture(kind), entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.dispose());
  subject.hooks.close = async () => { entered.resolve(); await gate.promise; throw false; };
  const resource = await subject.acquire();
  const closing = resource.close();
  const rejected = assert.rejects(closing, error => error === false);
  await entered.promise;
  const drainingCleanups = kind === "legacy" ? subject.cleanups.slice(0, 1) : subject.cleanups;
  if (kind === "legacy") await subject.cleanups[1]!();
  const pending = drainingCleanups.map(cleanup => Promise.resolve().then(cleanup));
  let settled = 0;
  for (const work of [closing, ...pending]) void work.then(() => { settled++; }, () => { settled++; });
  const checks = pending.map(work => assert.rejects(work, error => error === false));
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, 0);
    await assert.rejects(resource.next(), { code: "EBADF" });
    assert.equal(subject.reads, 0);
    assert.equal(subject.closes, 1);
  } finally { gate.resolve(); await Promise.all([rejected, ...checks]); }
  assert.equal(subject.closes, 1);
});

for (const kind of ["descriptor", "prepared"] as const) test(`cleanup review: ${kind} acquisition failure remains an operation outcome despite aborted cleanup priority`, async context => {
  const subject = await fixture(kind);
  context.after(() => subject.dispose());
  subject.priority.abort(new Error("cleanup-only cancellation"));
  subject.hooks.open = async () => { throw false; };
  await assert.rejects(subject.acquire(), error => error === false);
  assert.equal(subject.closes, 0);
});

for (const kind of kinds) test(`cleanup review: ${kind} omitted and undefined priority have identical resource admission`, async context => {
  const compositions = context.mock.method(AbortSignal, "any");
  const listeners = context.mock.method(AbortSignal.prototype, "addEventListener");
  const snapshots = [];
  for (const mode of ["omitted", "undefined"] as const) {
    const subject = await fixture(kind, mode);
    try {
      const compositionsBefore = compositions.mock.callCount(), listenersBefore = listeners.mock.callCount();
      const resource = await subject.acquire();
      snapshots.push({
        compositions: compositions.mock.callCount() - compositionsBefore,
        listeners: listeners.mock.callCount() - listenersBefore,
        cleanups: subject.cleanups.length,
        opens: subject.opens,
        reads: subject.reads,
        buffers: inputBufferUsage(subject.budget),
      });
      assert.equal(subject.opens, 1);
      assert.equal(subject.reads, 0);
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
      await resource.close();
    } finally { await subject.dispose(); }
  }
  assert.deepEqual(snapshots[1], snapshots[0]);
});

for (const kind of ["descriptor", "prepared"] as const) test(`cleanup review: ${kind} cleanup drains an admitted read before closing its descriptor`, async context => {
  const subject = await fixture(kind), entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.dispose());
  subject.hooks.read = async () => { entered.resolve(); await gate.promise; throw false; };
  subject.hooks.close = async () => { throw null; };
  const resource = await subject.acquire();
  const reading = resource.next();
  const readRejection = assert.rejects(reading, error => kind === "prepared" ? error instanceof FsError && error.code === "EBADF" : error === false);
  await entered.promise;
  const closing = resource.close();
  const closeRejection = assert.rejects(closing, error => error === null);
  const registered = subject.cleanups.map(cleanup => Promise.resolve().then(cleanup));
  const cleanupRejections = registered.map(cleanup => assert.rejects(cleanup, error => error === null));
  let settled = 0;
  for (const pending of [closing, ...registered]) void pending.then(() => { settled++; }, () => { settled++; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, 0);
    assert.equal(subject.closes, 0);
    await assert.rejects(resource.next(), { code: "EBADF" });
    assert.equal(subject.reads, 1);
  } finally {
    gate.resolve();
    await Promise.all([readRejection, closeRejection, ...cleanupRejections]);
  }
  assert.equal(subject.closes, 1);
});

for (const kind of ["descriptor", "prepared"] as const) test(`cleanup review: ${kind} registered cleanup before acquisition settles drains the eventual descriptor`, async context => {
  const subject = await fixture(kind), entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.dispose());
  subject.hooks.open = async () => { entered.resolve(); await gate.promise; };
  subject.hooks.close = async () => { throw null; };
  const acquiring = subject.acquire();
  const rejected = assert.rejects(acquiring, { code: "EBADF" });
  await entered.promise;
  const pending = subject.cleanups.map(cleanup => Promise.resolve().then(cleanup));
  const rejections = pending.map((cleanup, index) => kind === "prepared" && index === 0
    ? cleanup : assert.rejects(cleanup, error => error === null));
  let settled = 0;
  for (const cleanup of pending) void cleanup.then(() => { settled++; }, () => { settled++; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, 0);
    assert.equal(subject.opens, 0);
    assert.equal(subject.closes, 0);
  } finally {
    gate.resolve();
    await Promise.all([rejected, ...rejections]);
  }
  assert.equal(subject.closes, 1);
  assert.equal(subject.reads, 0);
});
