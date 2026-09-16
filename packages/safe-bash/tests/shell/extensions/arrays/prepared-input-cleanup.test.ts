import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { openCommandFile } from "../../../../src/contracts/filesystem-descriptor.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { inputBufferUsage, prepareFileInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";

function intercept<Target extends object>(target: Target, overrides: Partial<Target>): Target {
  return new Proxy(target, { get(original, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(original, key, original);
    return typeof value === "function" ? value.bind(original) : value;
  } });
}

async function fixture(reason: unknown, explicitPriority: boolean, options: { legacy?: boolean; fails?: boolean } = {}) {
  const root = new AbortController(), parent = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 }, root.signal);
  const memory = new MemoryFileSystem();
  await memory.writeFile("/input", Uint8Array.of(255, 0, 10));
  let closes = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const fs = intercept<FileSystem>(memory, {
    ...(options.legacy ? { capabilities: { ...memory.capabilities, open: false, retainedRead: false } } : {}),
    async open(...args) {
      if (options.legacy) throw new FsError("ENOTSUP", { syscall: "open" });
      const descriptor = await memory.open(...args);
      return intercept(descriptor, { async close() {
        closes++;
        await descriptor.close();
        if (options.fails !== false) throw reason;
      } });
    },
    readStream(...args) {
      if (!options.legacy) return memory.readStream(...args);
      let sent = false;
      const iterator: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (sent) return { done: true as const, value: undefined };
          sent = true;
          return { done: false as const, value: Uint8Array.of(255, 0, 10) };
        },
        async return() {
          closes++;
          if (options.fails !== false) throw reason;
          return { done: true as const, value: undefined };
        },
      };
      return iterator;
    },
  });
  return { root, parent, budget, cleanups, closes: () => closes,
    context: { fs, signal: parent.signal,
      registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
      ...(explicitPriority ? { cleanupFailurePrioritySignal: budget.signal } : {}),
    },
    async dispose() {
      await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
      assert.equal(closes, 1);
      assert.deepEqual(inputBufferUsage(budget), { bytes: 0, buffers: 0 });
      budget.close();
      budget.values.close();
    },
  };
}

const failures = [undefined, null, false, 0, "", new FsError("EIO"), new FsError("EPIPE")];

for (const legacy of [false, true]) for (const reason of failures) test(`prepared cleanup: explicit root priority preserves genuine close failure ${String(reason)}, legacy=${legacy}`, async () => {
  const subject = await fixture(reason, true, { legacy });
  try {
    const prepared = await prepareFileInput(subject.context, "/input", subject.budget);
    await prepared.source[Symbol.asyncIterator]().next();
    const local = new Error("handled stage cancellation");
    subject.parent.abort(local);
    await assert.rejects(prepared.close(), error => Object.is(error, reason));
    assert.equal(subject.cleanups.length, legacy ? 1 : 2);
    await assert.rejects(Promise.resolve().then(subject.cleanups[0]!), error => Object.is(error, reason));
    if (!legacy) await assert.rejects(Promise.resolve().then(subject.cleanups[1]!), error => Object.is(error, reason));
  } finally { await subject.dispose(); }
});

for (const reason of [false, null, 0, ""]) test(`prepared cleanup: explicit undefined keeps default parent priority ${JSON.stringify(reason)}`, async () => {
  const subject = await fixture(new FsError("EIO"), false);
  try {
    const context = { ...subject.context, cleanupFailurePrioritySignal: undefined };
    const prepared = await prepareFileInput(context, "/input", subject.budget);
    subject.parent.abort(reason);
    await assert.rejects(prepared.close(), error => Object.is(error, reason));
    for (const cleanup of subject.cleanups) {
      await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, reason));
    }
  } finally { await subject.dispose(); }
});

for (const prepared of [false, true]) test(`cleanup priority is captured once and installs no priority listeners, prepared=${prepared}`, async context => {
  const failure = new FsError("EIO");
  const subject = await fixture(failure, true);
  const priority = new AbortController(), replacement = new AbortController();
  replacement.abort(false);
  let captures = 0;
  Object.defineProperty(subject.context, "cleanupFailurePrioritySignal", { get() {
    captures++;
    return captures === 1 ? priority.signal : replacement.signal;
  } });
  const listening = context.mock.method(priority.signal, "addEventListener");
  try {
    const owner = prepared
      ? await prepareFileInput(subject.context, "/input", subject.budget)
      : await openCommandFile(subject.context, "/input", { access: "read" });
    assert.equal(captures, 1);
    assert.equal(listening.mock.callCount(), 0);
    subject.parent.abort(new Error("handled stage cancellation"));
    await assert.rejects(owner.close(), error => error === failure);
    for (const cleanup of subject.cleanups) {
      await assert.rejects(Promise.resolve().then(cleanup), error => error === failure);
    }
    assert.equal(captures, 1);
    assert.equal(listening.mock.callCount(), 0);
  } finally { await subject.dispose(); }
});

for (const acknowledge of [false, true]) for (const parentAborts of [false, true]) test(`descriptor cleanup keeps acknowledgement semantics: acknowledged=${acknowledge}, parentAborts=${parentAborts}`, async () => {
  const failure = new FsError("EIO");
  const subject = await fixture(failure, true);
  try {
    const descriptor = await openCommandFile(subject.context, "/input", { access: "read" });
    await assert.rejects(descriptor.close(), error => error === failure);
    if (acknowledge) assert.equal(descriptor.acknowledgeCloseFailure(failure), true);
    subject.root.abort(false);
    if (parentAborts) subject.parent.abort(null);
    const cleanup = Promise.resolve().then(subject.cleanups[0]!);
    if (acknowledge && !parentAborts) await cleanup;
    else await assert.rejects(cleanup, error => Object.is(error, acknowledge ? null : false));
    if (acknowledge) assert.equal(descriptor.acknowledgeCloseFailure(failure), true);
    else if (parentAborts) assert.equal(descriptor.acknowledgeCloseFailure(failure), false);
    await assert.rejects(descriptor.close(), error => error === failure);
  } finally { await subject.dispose(); }
});

test("cleanup priority is ignored for successful cleanup; ordinary parent checks remain", async () => {
  const subject = await fixture(undefined, true, { fails: false });
  try {
    const descriptor = await openCommandFile(subject.context, "/input", { access: "read" });
    subject.root.abort(false);
    await descriptor.close();
    await subject.cleanups[0]!();
    subject.parent.abort(null);
    await assert.rejects(Promise.resolve().then(subject.cleanups[0]!), error => error === null);
  } finally { await subject.dispose(); }
});

test("explicit undefined adds no signal compositions or listeners compared with omission", async context => {
  const compositions = context.mock.method(AbortSignal, "any");
  const listeners = context.mock.method(AbortSignal.prototype, "addEventListener");
  const counts: { compositions: number; listeners: number }[] = [];
  for (const explicit of [false, true]) {
    const subject = await fixture(undefined, false, { fails: false });
    try {
      const compositionStart = compositions.mock.callCount();
      const listenerStart = listeners.mock.callCount();
      const request = explicit ? { ...subject.context, cleanupFailurePrioritySignal: undefined } : subject.context;
      const prepared = await prepareFileInput(request, "/input", subject.budget);
      counts.push({ compositions: compositions.mock.callCount() - compositionStart, listeners: listeners.mock.callCount() - listenerStart });
      await prepared.close();
    } finally { await subject.dispose(); }
  }
  assert.deepEqual(counts[1], counts[0]);
});

for (const reason of failures) test(`descriptor cleanup: explicit root priority preserves genuine close failure ${String(reason)}`, async () => {
  const subject = await fixture(reason, true);
  try {
    const descriptor = await openCommandFile(subject.context, "/input", { access: "read", signal: subject.parent.signal });
    subject.parent.abort(new Error("handled stage cancellation"));
    await assert.rejects(descriptor.close(), error => Object.is(error, reason));
    for (const cleanup of subject.cleanups) {
      await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, reason));
    }
  } finally { await subject.dispose(); }
});

for (const reason of [false, null, 0, ""]) test(`prepared cleanup: default parent cancellation priority remains ${JSON.stringify(reason)}`, async () => {
  const failure = new FsError("EIO");
  const subject = await fixture(failure, false);
  try {
    const prepared = await prepareFileInput(subject.context, "/input", subject.budget);
    subject.parent.abort(reason);
    await assert.rejects(prepared.close(), error => Object.is(error, reason));
    for (const cleanup of subject.cleanups) {
      await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, reason));
    }
  } finally { await subject.dispose(); }
});

for (const reason of [false, null, 0, ""]) test(`prepared cleanup: explicit root cancellation outranks earlier local cancellation and close failure ${JSON.stringify(reason)}`, async () => {
  const subject = await fixture(new FsError("EIO"), true);
  try {
    const prepared = await prepareFileInput(subject.context, "/input", subject.budget);
    subject.parent.abort(new Error("handled stage cancellation"));
    subject.root.abort(reason);
    await assert.rejects(prepared.close(), error => Object.is(error, reason));
    for (const cleanup of subject.cleanups) {
      await assert.rejects(Promise.resolve().then(cleanup), error => Object.is(error, reason));
    }
  } finally { await subject.dispose(); }
});
