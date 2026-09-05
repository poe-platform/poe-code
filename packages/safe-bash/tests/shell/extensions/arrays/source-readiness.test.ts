import assert from "node:assert/strict";
import test from "node:test";
import type { FileDescriptor, FileSystem } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { createBytePipe } from "../../../../src/contracts/io.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { fileInput, inputBufferUsage, prepareBytesInput, prepareFileInput, ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(limits: Partial<typeof defaultLimits> = {}) {
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits }, controller.signal);
  const cleanups: (() => void | Promise<void>)[] = [];
  const fs = new MemoryFileSystem();
  return { controller, budget, fs, cleanups,
    context: { fs: fs as FileSystem, signal: budget.signal, registerCleanup(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); } },
    async close() {
      try { await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup))); }
      finally { budget.close(); budget.values.close(); }
    },
  };
}

function intercept<Target extends object>(fs: Target, overrides: Partial<Target>): Target {
  return new Proxy(fs, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

for (const value of ["", "x\n", Uint8Array.of(255, 0, 10)]) test(`finite source readiness ${JSON.stringify(value)}`, async () => {
  const subject = fixture();
  const prepared = prepareBytesInput(value, subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
  try {
    assert.equal(prepared.options.provenance, "stream");
    assert.equal(input.readiness(), value.length ? "ready" : "eof");
    assert.equal(input.readiness(), value.length ? "ready" : "eof");
    const result = await input.record();
    assert.deepEqual(shellValueBytes(result.shellValue), typeof value === "string" ? new TextEncoder().encode(value) : value);
    await result.release();
    assert.equal(input.readiness(), "eof");
    assert.equal(prepared.close(), prepared.close());
  } finally { await input.close(); await prepared.close(); await subject.close(); }
});

test("finite input owns one admitted copy, preserves remainder across aliases, and releases without next", async () => {
  const subject = fixture();
  const bytes = Uint8Array.of(255, 10, 254, 10);
  const prepared = prepareBytesInput(bytes, subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
  const alias = new ShellInput(input, subject.budget);
  try {
    bytes.fill(0);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 4, buffers: 1 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    const first = await input.record();
    assert.deepEqual(shellValueBytes(first.shellValue), Uint8Array.of(255, 10));
    await first.release();
    assert.equal(alias.readiness(), "ready");
    const second = await alias.record();
    assert.deepEqual(shellValueBytes(second.shellValue), Uint8Array.of(254, 10));
    await second.release();
    assert.equal(input.readiness(), "eof");
    await prepared.close();
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    const untouched = prepareBytesInput("unused", subject.budget);
    await untouched.close();
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await alias.close(); await input.close(); await prepared.close(); await subject.close(); }
});

test("finite preparation admits bytes before allocation and cleans failed reservations", async () => {
  const subject = fixture({ maxInputBytes: 8 });
  try {
    assert.throws(() => prepareBytesInput("too large", subject.budget), error => error instanceof FsError && error.code === "EFBIG");
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("empty default input needs no retained byte allocation or value slots", async () => {
  const subject = fixture({ maxInputBytes: 0, maxExpansionBytes: 0, maxExpansionFields: 0 });
  try {
    const prepared = prepareBytesInput("", subject.budget);
    assert.equal(prepared.options.poll!(), "eof");
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    await prepared.close();
  } finally { await subject.close(); }
});

test("pipe poll never pulls, preserves backpressure, and distinguishes requested close from drained EOF", async () => {
  const pipe = createBytePipe({ highWaterMark: 1 });
  try {
    assert.equal(pipe.readiness(), "blocked");
    await pipe.writable.write(Uint8Array.of(65));
    let completed = false;
    const writing = pipe.writable.write(Uint8Array.of(66)).then(() => { completed = true; });
    const closing = pipe.close();
    await turn();
    for (let count = 0; count < 10; count++) assert.equal(pipe.readiness(), "ready");
    assert.equal(completed, false);
    const reader = pipe.readable[Symbol.asyncIterator]();
    assert.deepEqual((await reader.next()).value, Uint8Array.of(65));
    await writing;
    assert.equal(pipe.readiness(), "ready");
    assert.deepEqual((await reader.next()).value, Uint8Array.of(66));
    await closing;
    assert.equal(pipe.readiness(), "eof");
    assert.equal((await reader.next()).done, true);
  } finally { await pipe.abort(); }
});

test("empty pipe closure is observable without a reader or speculative pull", async () => {
  const pipe = createBytePipe();
  await pipe.close();
  assert.equal(pipe.readiness(), "eof");
  await pipe.abort();
});

for (const reason of [false, null, 0, ""]) test(`pipe readiness preserves falsey failure ${JSON.stringify(reason)}`, async () => {
  const pipe = createBytePipe();
  await pipe.abort(reason);
  assert.throws(() => pipe.readiness(), error => Object.is(error, reason));
});

test("pipe-backed timed cursor retains one pending pull and later bytes", async () => {
  const subject = fixture();
  const pipe = createBytePipe();
  let expire!: () => void;
  let time = 0;
  const input = new ShellInput(pipe.readable, subject.budget, subject.budget.signal, {
    provenance: "stream", poll: () => pipe.readiness(),
    clock: { now: () => time, schedule(_delay, callback) { expire = callback; return () => {}; } },
  });
  try {
    const pending = input.line(true, { timeoutMs: 1 });
    await turn();
    time = 1;
    expire();
    const partial = await pending;
    assert.equal(partial.reason, "timeout");
    await partial.release();
    await pipe.writable.write(Uint8Array.of(255, 10));
    await turn();
    assert.equal(input.readiness(), "ready");
    const result = await input.record();
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255, 10));
    await result.release();
    assert.equal(input.readiness(), "blocked");
    await pipe.close();
    assert.equal(input.readiness(), "eof");
  } finally { await input.close(); await pipe.abort(); await subject.close(); }
});

test("canonical preparation enrolls before open, stats and reads one retained node, closes without next", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65, 10));
  let closes = 0;
  let stats = 0;
  const fs = intercept(subject.fs, {
    async open(path, options) {
      assert.ok(subject.cleanups.length > 0);
      const descriptor = await subject.fs.open(path, options);
      return intercept(descriptor, {
        async stat(options) { stats++; return descriptor.stat(options); },
        async close() { closes++; await descriptor.close(); },
      });
    },
    async stat() { throw new Error("pathname stat must not classify the open source"); },
    readStream() { throw new Error("canonical source must not reopen by path"); },
  });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  try {
    assert.equal(stats, 1);
    assert.equal(prepared.options.provenance, "regular");
    await subject.fs.rename("/input", "/old");
    await subject.fs.writeFile("/input", Uint8Array.of(66, 10));
    const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
    assert.equal(input.readiness(), "ready");
    const result = await input.line(true, { timeoutMs: 0.000001 });
    assert.equal(result.value, "A");
    await result.release();
    await input.close();
    await prepared.close();
    assert.equal(closes, 1);
    const unused = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    assert.equal(unused.options.provenance, "regular");
    await Promise.all(subject.cleanups.map(cleanup => cleanup()));
    assert.equal(closes, 2);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await prepared.close(); await subject.close(); }
});

test("cleanup during pending open waits for and closes the late descriptor exactly once", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  const descriptor = await subject.fs.open("/input", { access: "read" });
  let resolve!: (descriptor: FileDescriptor) => void;
  let closes = 0;
  const fs = intercept(subject.fs, { open: () => new Promise(done => { resolve = done; }) });
  const pending = prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const rejected = assert.rejects(pending);
  await turn();
  const closing = subject.cleanups[0]!();
  resolve(intercept(descriptor, { async close() { closes++; await descriptor.close(); } }));
  await rejected;
  await closing;
  assert.equal(closes, 1);
  await subject.close();
});

for (const code of ["ENOENT", "EACCES", "EIO"] as const) test(`canonical ${code} is not legacy fallback`, async () => {
  const subject = fixture();
  const failure = new FsError(code, { syscall: "open" });
  let legacy = 0;
  const fs = intercept(subject.fs, { async open() { throw failure; }, readStream() { legacy++; throw new Error("legacy"); } });
  try {
    await assert.rejects(prepareFileInput({ ...subject.context, fs }, "/input", subject.budget), error => error === failure);
    assert.equal(legacy, 0);
  } finally { await subject.close(); }
});

test("documented unsupported open falls back unchanged but leaves provenance unknown", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65, 10));
  const fs = intercept(subject.fs, { async open() { throw new FsError("ENOTSUP", { syscall: "open" }); } });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
  try {
    assert.equal(prepared.options.provenance, "unknown");
    assert.equal(input.readiness(), "unknown");
    await assert.rejects(input.line(true, { timeoutMs: 1 }), /provenance/);
    const result = await input.line(true);
    assert.equal(result.value, "A");
    await result.release();
    const legacy = await fileInput(fs, "/input", 100, subject.budget.signal);
    assert.deepEqual((await legacy[Symbol.asyncIterator]().next()).value, Uint8Array.of(65, 10));
  } finally { await input.close(); await prepared.close(); await subject.close(); }
});

for (const reason of [false, null, 0, ""]) test(`cancelled acquisition preserves ${JSON.stringify(reason)} without fallback`, async () => {
  const subject = fixture();
  let legacy = 0;
  const fs = intercept(subject.fs, {
    async open() { subject.controller.abort(reason); throw new FsError("ENOTSUP"); },
    readStream() { legacy++; throw new Error("legacy"); },
  });
  try {
    await assert.rejects(prepareFileInput({ ...subject.context, fs }, "/input", subject.budget), error => Object.is(error, reason));
    assert.equal(legacy, 0);
  } finally { await subject.close(); }
});

test("closing a prepared file cancels its cooperative pending read without aborting the root", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  let supplied: AbortSignal | undefined;
  let finish!: () => void;
  let closes = 0;
  const fs = intercept(subject.fs, { async open(path, options) {
    const descriptor = await subject.fs.open(path, options);
    return intercept(descriptor, {
      read(_buffer, _position, options) {
        supplied = options?.signal;
        return new Promise<number>((resolve, reject) => {
          finish = () => resolve(0);
          supplied?.addEventListener("abort", () => reject(supplied?.reason), { once: true });
        });
      },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const reading = prepared.source[Symbol.asyncIterator]().next();
  const rejected = assert.rejects(reading);
  await turn();
  const closing = prepared.close();
  try {
    await turn();
    assert.equal(supplied?.aborted, true);
    assert.equal(subject.budget.signal.aborted, false);
  } finally { finish(); await rejected; await closing; await subject.close(); }
  assert.equal(closes, 1);
  assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
});

test("EOF polling cannot hide an in-flight result retained after timeout", async () => {
  const subject = fixture();
  const prepared = prepareBytesInput("A\n", subject.budget);
  const reader = prepared.source[Symbol.asyncIterator]();
  let release!: () => void;
  const delivery = new Promise<void>(resolve => { release = resolve; });
  let expire!: () => void;
  let time = 0;
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { const result = await reader.next(); await delivery; return result; },
    return: () => reader.return!(),
  }; } }, subject.budget, subject.budget.signal, {
    ...prepared.options, clock: { now: () => time, schedule(_delay, callback) { expire = callback; return () => {}; } },
  });
  try {
    const pending = input.line(true, { timeoutMs: 1 });
    await turn();
    time = 1;
    expire();
    const timeout = await pending;
    await timeout.release();
    assert.equal(prepared.options.poll!(), "eof");
    assert.equal(input.readiness(), "unknown");
    release();
    await turn();
    assert.equal(input.readiness(), "ready");
    const result = await input.record();
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(65, 10));
    await result.release();
  } finally { release(); await input.close(); await prepared.close(); await subject.close(); }
});

for (const stage of ["stat", "read"] as const) test(`ENOTSUP at ${stage} is not permission to reopen by path`, async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  const failure = new FsError("ENOTSUP", { syscall: stage });
  let closes = 0;
  let legacy = 0;
  const fs = intercept(subject.fs, {
    async open(path, options) {
      const descriptor = await subject.fs.open(path, options);
      return intercept(descriptor, {
        [stage]: async () => { throw failure; },
        async close() { closes++; await descriptor.close(); },
      });
    },
    readStream() { legacy++; throw new Error("unexpected fallback"); },
  });
  try {
    if (stage === "stat") await assert.rejects(prepareFileInput({ ...subject.context, fs }, "/input", subject.budget), error => error === failure);
    else {
      const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
      await assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => error === failure);
      await prepared.close();
    }
    assert.equal(closes, 1);
    assert.equal(legacy, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const closing of [false, true]) test(`cleanup enrollment ${closing ? "closes synchronously" : "throws"} before open`, async () => {
  const subject = fixture();
  let opens = 0;
  let completion: void | Promise<void> = undefined;
  const fs = intercept(subject.fs, { async open() { opens++; throw new Error("must not open"); } });
  try {
    await assert.rejects(prepareFileInput({ ...subject.context, fs, registerCleanup(cleanup) {
      if (closing) completion = cleanup();
      else throw new Error("closed invocation");
    } }, "/input", subject.budget));
    await completion;
    assert.equal(opens, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const maximum of [0, 1, 3]) test(`canonical input limit ${maximum} checks bytes, not metadata size`, async () => {
  const subject = fixture({ maxInputBytes: maximum });
  await subject.fs.writeFile("/input", Uint8Array.of(65, 66, 67));
  const prepared = await prepareFileInput(subject.context, "/input", subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
  try {
    if (maximum < 3) await assert.rejects(input.record(), error => error instanceof FsError && error.code === "EFBIG");
    else {
      const result = await input.record();
      assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(65, 66, 67));
      await result.release();
    }
  } finally { await input.close(); await prepared.close(); await subject.close(); }
});

for (const count of [-1, 0.5, NaN, 100000]) test(`invalid descriptor count ${count} closes and releases`, async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  let closes = 0;
  const fs = intercept(subject.fs, { async open(path, options) {
    const descriptor = await subject.fs.open(path, options);
    return intercept(descriptor, { async read() { return count; }, async close() { closes++; await descriptor.close(); } });
  } });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    await assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => error instanceof FsError && error.code === "EIO");
    assert.equal(closes, 1);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const reason of [false, null, 0, ""]) test(`root cancellation outranks explicit cleanup failure after regular EOF ${JSON.stringify(reason)}`, async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", new Uint8Array());
  const fs = intercept(subject.fs, { async open(path, options) {
    const descriptor = await subject.fs.open(path, options);
    return intercept(descriptor, { async close() {
      await descriptor.close();
      subject.controller.abort(reason);
      throw new Error("cleanup failure");
    } });
  } });
  try {
    const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
    assert.equal((await prepared.source[Symbol.asyncIterator]().next()).done, true);
    assert.equal(subject.controller.signal.aborted, false);
    await assert.rejects(prepared.close(), error => Object.is(error, reason));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("legacy pending read receives owner-close cancellation and returns its iterator", async () => {
  const subject = fixture();
  let supplied: AbortSignal | undefined;
  let finish!: () => void;
  let returns = 0;
  const fs = intercept(subject.fs, {
    async open() { throw new FsError("ENOTSUP"); },
    readStream(_path, options) {
      supplied = options?.signal;
      return { [Symbol.asyncIterator]() { return {
        next() { return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
          finish = () => resolve({ done: true, value: undefined });
          supplied?.addEventListener("abort", () => reject(supplied?.reason), { once: true });
        }); },
        async return() { returns++; return { done: true as const, value: undefined }; },
      }; } };
    },
  });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const reading = prepared.source[Symbol.asyncIterator]().next();
  const rejected = assert.rejects(reading);
  await turn();
  const closing = prepared.close();
  try {
    await turn();
    assert.equal(supplied?.aborted, true);
    assert.equal(subject.budget.signal.aborted, false);
  } finally { finish(); await rejected; await closing; await subject.close(); }
  assert.equal(returns, 1);
});

test("character descriptor grants stream deadlines but no invented readiness", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65, 10));
  const fs = intercept(subject.fs, { async open(path, options) {
    const descriptor = await subject.fs.open(path, options);
    return intercept(descriptor, { async stat(options) { return { ...await descriptor.stat(options), type: "character" }; } });
  } });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  let timers = 0;
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, {
    ...prepared.options, clock: { now: () => 0, schedule() { timers++; return () => {}; } },
  });
  try {
    assert.equal(prepared.options.provenance, "stream");
    assert.equal(input.readiness(), "unknown");
    const result = await input.line(true, { timeoutMs: 1 });
    assert.equal(result.value, "A");
    assert.equal(timers, 1);
    await result.release();
  } finally { await input.close(); await prepared.close(); await subject.close(); }
});

test("borrowed regular cursor retains descriptor ownership and ignores timer creation", async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65, 10, 66, 10));
  let closes = 0;
  const fs = intercept(subject.fs, { async open(path, options) {
    const descriptor = await subject.fs.open(path, options);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); } });
  } });
  const prepared = await prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, {
    ...prepared.options, clock: { now() { throw new Error("regular file consulted clock"); }, schedule() { throw new Error("regular file set timer"); } },
  });
  const alias = new ShellInput(input, subject.budget);
  try {
    const first = await alias.line(true, { timeoutMs: 0.000001 });
    assert.equal(first.value, "A");
    await first.release();
    await alias.close();
    assert.equal(closes, 0);
    assert.equal(input.readiness(), "ready");
    const second = await input.line(true, { timeoutMs: 1 });
    assert.equal(second.value, "B");
    await second.release();
    await input.close();
    assert.equal(closes, 1);
  } finally { await alias.close(); await input.close(); await prepared.close(); await subject.close(); }
});

for (const reason of [false, null, 0, ""]) test(`late open after root cancellation ${JSON.stringify(reason)} closes without stat or read`, async () => {
  const subject = fixture();
  await subject.fs.writeFile("/input", Uint8Array.of(65));
  const descriptor = await subject.fs.open("/input", { access: "read" });
  let resolve!: (descriptor: FileDescriptor) => void;
  let closes = 0;
  const fs = intercept(subject.fs, { open: () => new Promise(done => { resolve = done; }) });
  const pending = prepareFileInput({ ...subject.context, fs }, "/input", subject.budget);
  const rejected = assert.rejects(pending, error => Object.is(error, reason));
  await turn();
  subject.controller.abort(reason);
  resolve(intercept(descriptor, {
    async stat() { assert.fail("late descriptor must not be inspected"); },
    async read() { assert.fail("late descriptor must not be consumed"); },
    async close() { closes++; await descriptor.close(); },
  }));
  await rejected;
  assert.equal(closes, 1);
  await subject.close();
});
