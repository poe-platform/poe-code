import assert from "node:assert/strict";
import test from "node:test";
import type { FileDescriptor, FileSystem, FsOptions } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { collectBytes } from "../../../../src/contracts/io.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { prepareBytesInput, prepareFileInput, ShellInput, type PreparedShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

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

interface ReadHook {
  (descriptor: FileDescriptor, buffer: Uint8Array, position: number | null, options?: FsOptions): Promise<number>;
}

function fixture(limits: Partial<typeof defaultLimits> = {}) {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxInputBytes: 4, maxExpansionBytes: 0, maxExpansionFields: 0, maxWallClockMs: 2000, ...limits }, controller.signal);
  const owners = new Set<PreparedShellInput>(), views = new Set<ShellInput>();
  const cleanups: (() => void | Promise<void>)[] = [], allowedCleanup: unknown[] = [];
  const hooks: { read?: ReadHook; close?: (descriptor: FileDescriptor) => Promise<void> } = {};
  const requests: { length: number; before: number; result?: number }[] = [];
  let opens = 0, closes = 0;
  const observed: FileSystem = intercept(fs, { async open(path, options) {
    opens++;
    const descriptor = await fs.open(path, options);
    let bytes = 0;
    return intercept(descriptor, {
      async read(buffer, position, options) {
        const request: (typeof requests)[number] = { length: buffer.length, before: bytes };
        requests.push(request);
        const count = hooks.read ? await hooks.read(descriptor, buffer, position, options) : await descriptor.read(buffer, position, options);
        request.result = count;
        bytes += count;
        return count;
      },
      async close() { closes++; if (hooks.close) await hooks.close(descriptor); else await descriptor.close(); },
    });
  } });
  return { fs, controller, budget, hooks, requests, allowedCleanup,
    get opens() { return opens; }, get closes() { return closes; },
    finite(value: string | Uint8Array) {
      const prepared = prepareBytesInput(value, budget);
      owners.add(prepared);
      return prepared;
    },
    async file(path: string) {
      const prepared = await prepareFileInput({ fs: observed, signal: budget.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } }, path, budget);
      owners.add(prepared);
      return prepared;
    },
    view(prepared: PreparedShellInput) {
      const input = new ShellInput(prepared.source, budget, budget.signal, prepared.options);
      views.add(input);
      return input;
    },
    async close() {
      try {
        const results = await Promise.allSettled([...views].map(view => view.close()).concat([...owners].map(owner => owner.close()), cleanups.map(cleanup => Promise.resolve().then(cleanup))));
        for (const result of results) if (result.status === "rejected") {
          assert.ok(budget.signal.aborted && Object.is(result.reason, budget.signal.reason) || allowedCleanup.some(reason => Object.is(reason, result.reason)), "Unexpected cleanup failure");
        }
        assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
        assert.equal(closes, opens);
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

for (const value of ["€", Uint8Array.of(255, 0, 254), Buffer.from([9, 255, 0, 254, 9]).subarray(1, 4)]) test(`budget review: finite ${typeof value} visible bytes use only their own input allowance`, async context => {
  const subject = fixture({ maxInputBytes: 3 });
  context.after(() => subject.close());
  const expected = new Uint8Array(typeof value === "string" ? Buffer.from(value) : value);
  const first = subject.finite(value), second = subject.finite(Uint8Array.of(128, 0, 129));
  if (typeof value !== "string") value.fill(42);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  assert.throws(() => subject.finite("€!"), { code: "EFBIG" });
  assert.equal(subject.budget.signal.aborted, false);
  assert.deepEqual(await collectBytes(first.source, { maxBytes: 3 }), expected);
  await first.close();
  assert.deepEqual(await collectBytes(second.source, { maxBytes: 3 }), Uint8Array.of(128, 0, 129));
});

test("budget review: simultaneous finite and two same-path file inputs each retain a full independent cap", async context => {
  const subject = fixture();
  context.after(() => subject.close());
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 254, 10));
  const first = await subject.file("/input"), second = await subject.file("/input"), finite = subject.finite("four");
  assert.equal(subject.opens, 2);
  const firstBytes = await collectBytes(first.source, { maxBytes: 4 });
  await first.close();
  assert.equal(subject.closes, 1);
  assert.deepEqual(await collectBytes(second.source, { maxBytes: 4 }), Uint8Array.of(255, 0, 254, 10));
  assert.deepEqual(Buffer.from(await collectBytes(finite.source, { maxBytes: 4 })), Buffer.from("four"));
  assert.deepEqual(firstBytes, Uint8Array.of(255, 0, 254, 10));
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("budget review: over-cap byte views are rejected before copying any visible data", context => {
  const subject = fixture({ maxInputBytes: 2 });
  context.after(() => subject.close());
  const NativeBytes = Uint8Array, backing = new NativeBytes(1024), value = backing.subarray(100, 103);
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === value || args[0] === backing.buffer) copies++;
    return Reflect.construct(target, args, receiver);
  } }));
  assert.throws(() => subject.finite(value), { code: "EFBIG" });
  assert.equal(copies, 0);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("budget review: UTF-8 byte admission rejects an oversized string before encoding", context => {
  const subject = fixture({ maxInputBytes: 2 });
  context.after(() => subject.close());
  let encodings = 0;
  context.mock.method(TextEncoder.prototype, "encode", () => { encodings++; throw new Error("Encoding before admission"); });
  assert.throws(() => subject.finite("€"), { code: "EFBIG" });
  assert.equal(encodings, 0);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("budget review: shadowed byteLength cannot admit a typed array exceeding the per-input cap", context => {
  const subject = fixture({ maxInputBytes: 2 });
  context.after(() => subject.close());
  const NativeBytes = Uint8Array, value = NativeBytes.of(255, 0, 254);
  Object.defineProperty(value, "byteLength", { value: 1 });
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === value) copies++;
    return Reflect.construct(target, args, receiver);
  } }));
  assert.throws(() => subject.finite(value), { code: "EFBIG" });
  assert.equal(copies, 0);
});

test("budget review: shadowed zero byteLength cannot silently discard fitting nonempty input", async context => {
  const subject = fixture({ maxInputBytes: 3 });
  context.after(() => subject.close());
  const value = Uint8Array.of(255, 0, 254);
  Object.defineProperty(value, "byteLength", { value: 0 });
  const prepared = subject.finite(value);
  assert.deepEqual(await collectBytes(prepared.source, { maxBytes: 3 }), Uint8Array.of(255, 0, 254));
});

for (const reason of [false, null, 0, ""]) test(`budget review: failed finite allocation ${JSON.stringify(reason)} preserves another input and exact failure`, async context => {
  const subject = fixture();
  context.after(() => subject.close());
  const held = subject.finite("kept");
  const NativeBytes = Uint8Array, value = NativeBytes.of(1, 2, 3, 4);
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === value) throw reason;
    return Reflect.construct(target, args, receiver);
  } }));
  assert.throws(() => subject.finite(value), error => Object.is(error, reason));
  assert.equal(subject.budget.signal.aborted, false);
  context.mock.restoreAll();
  assert.deepEqual(Buffer.from(await collectBytes(held.source, { maxBytes: 4 })), Buffer.from("kept"));
  const replacement = subject.finite("next");
  assert.deepEqual(Buffer.from(await collectBytes(replacement.source, { maxBytes: 4 })), Buffer.from("next"));
});

for (const reason of [false, null, 0, ""]) test(`budget review: pre-aborted input preparation ${JSON.stringify(reason)} does not copy or open`, async context => {
  const subject = fixture();
  context.after(() => subject.close());
  const NativeBytes = Uint8Array, value = NativeBytes.of(255);
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === value) copies++;
    return Reflect.construct(target, args, receiver);
  } }));
  subject.controller.abort(reason);
  assert.throws(() => subject.finite(value), error => Object.is(error, reason));
  await assert.rejects(subject.file("/never-opened"), error => Object.is(error, reason));
  assert.equal(copies, 0);
  assert.equal(subject.opens, 0);
});

for (const cap of [0, 1, 4, 65_537]) test(`budget review: cap ${cap} bounds each file read and overflow probe without resetting at EOF`, async context => {
  const subject = fixture({ maxInputBytes: cap });
  context.after(() => subject.close());
  await subject.fs.writeFile("/input", new Uint8Array(cap));
  const prepared = await subject.file("/input");
  const iterator = prepared.source[Symbol.asyncIterator]();
  let consumed = 0;
  for (;;) {
    const result = await iterator.next();
    if (result.done) break;
    consumed += result.value.length;
  }
  assert.equal(consumed, cap);
  assert.equal((await iterator.next()).done, true);
  await subject.fs.appendFile("/input", Uint8Array.of(255));
  await assert.rejects(iterator.next(), { code: "EFBIG" });
  for (const request of subject.requests) {
    assert.ok(request.length > 0);
    assert.ok(request.length <= cap - request.before + 1, "Probe exceeds remaining allowance plus one byte");
  }
  assert.equal(subject.closes, 1);
  assert.equal(subject.budget.signal.aborted, false);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  const other = subject.finite(new Uint8Array(cap));
  assert.equal((await collectBytes(other.source, { maxBytes: cap })).length, cap);
});

for (const arena of ["bytes", "slots"] as const) test(`budget review: actual ShellValue materialization still enforces expansion ${arena}`, async context => {
  const subject = fixture(arena === "bytes" ? { maxExpansionBytes: 0, maxExpansionFields: 100 } : { maxExpansionBytes: 65536, maxExpansionFields: 0 });
  context.after(() => subject.close());
  const prepared = subject.finite(Uint8Array.of(255, 0, 10));
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  const input = subject.view(prepared);
  await assert.rejects(input.record(), error => error instanceof ShellLimitError && error.limit === (arena === "bytes" ? "maxExpansionBytes" : "maxExpansionFields"));
});

test("budget review: a live ShellValue owns expansion resources while its file transport does not", async context => {
  const subject = fixture({ maxExpansionBytes: 65536, maxExpansionFields: 100 });
  context.after(() => subject.close());
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  const prepared = await subject.file("/input");
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  const input = subject.view(prepared);
  const result = await input.record();
  try {
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255, 0, 10));
    assert.ok(subject.budget.values.usage.bytes > 0);
    assert.ok(subject.budget.values.usage.slots > 0);
    assert.equal(subject.closes, 0);
  } finally { await result.release(); }
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  assert.equal(subject.closes, 0);
});

for (const reason of [false, null, 0, ""]) test(`budget review: root cancellation ${JSON.stringify(reason)} drains admitted file work before cleanup`, async context => {
  const subject = fixture();
  const entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.close());
  await subject.fs.writeFile("/input", Uint8Array.of(255));
  const prepared = await subject.file("/input");
  subject.hooks.read = async (descriptor, buffer, position, options) => {
    entered.resolve();
    await gate.promise;
    return descriptor.read(buffer, position, options);
  };
  const read = assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => Object.is(error, reason));
  await entered.promise;
  subject.controller.abort(reason);
  const closing = prepared.close();
  let settled = false;
  void closing.then(() => { settled = true; }, () => { settled = true; });
  const closed = assert.rejects(closing, error => Object.is(error, reason));
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(subject.closes, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { gate.resolve(); await Promise.all([read, closed]); }
  assert.equal(subject.closes, 1);
});

for (const reason of [false, null, 0, "", new FsError("EIO")]) test(`budget review: read failure ${String(reason)} is not replaced by an expansion or cleanup error`, async context => {
  const subject = fixture();
  const cleanup = new Error("secondary close failure");
  context.after(() => subject.close());
  await subject.fs.writeFile("/input", Uint8Array.of(255));
  const prepared = await subject.file("/input");
  subject.allowedCleanup.push(cleanup);
  subject.hooks.read = async () => { throw reason; };
  subject.hooks.close = async descriptor => { await descriptor.close(); throw cleanup; };
  await assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => Object.is(error, reason));
  await assert.rejects(prepared.close(), error => error === cleanup);
  assert.equal(subject.closes, 1);
  assert.equal(subject.budget.signal.aborted, false);
});
