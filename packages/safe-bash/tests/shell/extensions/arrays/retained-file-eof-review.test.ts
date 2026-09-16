import assert from "node:assert/strict";
import test from "node:test";
import type { FileDescriptor, FileSystem, FsOptions } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { prepareFileInput, ShellInput, type ShellInputOptions } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";

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

interface Hooks {
  read?: (descriptor: FileDescriptor, buffer: Uint8Array, position: number | null, options?: FsOptions) => Promise<number>;
  close?: (descriptor: FileDescriptor) => Promise<void>;
}

async function retained(initial: Uint8Array = new Uint8Array()) {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }, controller.signal);
  await fs.writeFile("/input", initial);
  const hooks: Hooks = {}, cleanups: (() => void | Promise<void>)[] = [], allowedCleanup: unknown[] = [];
  let opens = 0, reads = 0, stats = 0, closes = 0;
  let descriptor: FileDescriptor | undefined;
  const observed: FileSystem = intercept(fs, {
    async open(path, options) {
      opens++;
      const opened = await fs.open(path, options);
      descriptor = opened;
      return intercept(opened, {
        async stat(options) { stats++; return opened.stat(options); },
        async read(buffer, position, options) {
          reads++;
          assert.equal(position, null, "Retained input must use the shared descriptor position");
          return hooks.read ? hooks.read(opened, buffer, position, options) : opened.read(buffer, position, options);
        },
        async close() { closes++; if (hooks.close) await hooks.close(opened); else await opened.close(); },
      });
    },
    async stat() { throw new Error("No path restat after descriptor acquisition"); },
    async readFile() { throw new Error("No buffered fallback after retained descriptor acquisition"); },
    readStream() { throw new Error("No stream fallback after retained descriptor acquisition"); },
  });
  const prepared = await prepareFileInput({ fs: observed, signal: budget.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } }, "/input", budget);
  const input = new ShellInput(prepared.source, budget, budget.signal, prepared.options);
  return { fs, budget, controller, hooks, prepared, input, allowedCleanup,
    get opens() { return opens; }, get reads() { return reads; }, get stats() { return stats; }, get closes() { return closes; },
    position() { assert.ok(descriptor?.getPosition); return descriptor.getPosition(); },
    async close() {
      try {
        const outcomes = await Promise.allSettled([input.close(), prepared.close(), ...cleanups.map(cleanup => Promise.resolve().then(cleanup))]);
        for (const outcome of outcomes) if (outcome.status === "rejected") {
          assert.ok(controller.signal.aborted && Object.is(outcome.reason, controller.signal.reason) || allowedCleanup.some(reason => Object.is(reason, outcome.reason)), "Unexpected cleanup failure");
        }
        assert.equal(closes, 1);
        assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

async function record(input: ShellInput, bytes: Uint8Array, reason: "eof" | "delimiter") {
  const result = await input.record();
  try {
    assert.equal(result.reason, reason);
    assert.deepEqual(shellValueBytes(result.shellValue), bytes);
  } finally { await result.release(); }
}

for (const kind of ["line", "record", "sourceLine", "next"] as const) test(`EOF review: ${kind} starts a fresh serialized read on the same regular descriptor`, async context => {
  const subject = await retained();
  context.after(() => subject.close());
  assert.equal(subject.prepared.options.eof, "retryable");
  assert.equal(subject.prepared.options.provenance, "regular");
  await record(subject.input, new Uint8Array(), "eof");
  const reads = subject.reads;
  await subject.fs.appendFile("/input", Uint8Array.of(255, 10));
  for (let index = 0; index < 3; index++) assert.equal(subject.input.readiness(), "eof");
  assert.equal(subject.reads, reads);
  if (kind === "line") {
    const result = await subject.input.line(true);
    try { assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255)); assert.equal(result.reason, "delimiter"); }
    finally { await result.release(); }
  } else if (kind === "record") await record(subject.input, Uint8Array.of(255, 10), "delimiter");
  else if (kind === "sourceLine") assert.deepEqual(await subject.input.sourceLine(), Uint8Array.of(255, 10));
  else assert.deepEqual(await subject.input.next(), { done: false, value: Uint8Array.of(255, 10) });
  assert.equal(await subject.position(), 2);
  assert.equal(subject.reads, reads + 1);
  assert.equal(subject.opens, 1);
  assert.equal(subject.stats, 1);
  assert.equal(subject.closes, 0);
});

test("EOF review: zero-count read never retries the descriptor and append remains readable", async context => {
  const subject = await retained();
  context.after(() => subject.close());
  await record(subject.input, new Uint8Array(), "eof");
  const result = await subject.input.line(true, { count: 0, timeoutMs: 0.001 });
  try { assert.equal(result.reason, "count"); assert.equal(result.terminated, true); }
  finally { await result.release(); }
  assert.equal(subject.reads, 1);
  await subject.fs.appendFile("/input", Uint8Array.of(65, 0, 255, 10));
  await record(subject.input, Uint8Array.of(65, 0, 255, 10), "delimiter");
  assert.equal(await subject.position(), 4);
});

test("EOF review: unlink and replacement cannot redirect a retained reader or its alias", async context => {
  const subject = await retained();
  const alias = new ShellInput(subject.input, subject.budget);
  const writer = await subject.fs.open("/input", { access: "write", append: true });
  context.after(async () => { await alias.close(); await writer.close(); await subject.close(); });
  await record(alias, new Uint8Array(), "eof");
  await subject.fs.rm("/input");
  await subject.fs.writeFile("/input", Buffer.from("replacement\n"));
  await writer.write(Uint8Array.of(255, 0, 10), null);
  await record(alias, Uint8Array.of(255, 0, 10), "delimiter");
  await alias.close();
  await record(subject.input, new Uint8Array(), "eof");
  await writer.write(Uint8Array.of(128, 10), null);
  await record(subject.input, Uint8Array.of(128, 10), "delimiter");
  assert.equal(await subject.position(), 5);
  assert.equal(subject.opens, 1);
  assert.equal(subject.stats, 1);
  assert.deepEqual(Buffer.from(await subject.fs.readFile("/input")), Buffer.from("replacement\n"));
});

test("EOF review: truncate and regrow preserve byte offset and counted-read remainder", async context => {
  const subject = await retained(Uint8Array.of(255, 10));
  context.after(() => subject.close());
  await record(subject.input, Uint8Array.of(255, 10), "delimiter");
  await record(subject.input, new Uint8Array(), "eof");
  await subject.fs.truncate("/input", 0);
  await subject.fs.writeFile("/input", Uint8Array.of(88, 88, 195, 169, 0, 255, 10));
  const counted = await subject.input.line(true, { count: 2, byteCount: true });
  try { assert.equal(counted.reason, "count"); assert.deepEqual(shellValueBytes(counted.shellValue), Uint8Array.of(195, 169)); }
  finally { await counted.release(); }
  await record(subject.input, Uint8Array.of(0, 255, 10), "delimiter");
  assert.equal(await subject.position(), 7);
  assert.equal(subject.opens, 1);
});

test("EOF review: an unreleased partial EOF record owns its bytes across later descriptor-buffer reuse", async context => {
  const subject = await retained(Uint8Array.of(255, 0, 254));
  context.after(() => subject.close());
  const partial = await subject.input.record();
  try {
    assert.equal(partial.reason, "eof");
    assert.deepEqual(shellValueBytes(partial.shellValue), Uint8Array.of(255, 0, 254));
    await subject.fs.appendFile("/input", Uint8Array.of(128, 10));
    await record(subject.input, Uint8Array.of(128, 10), "delimiter");
    assert.deepEqual(shellValueBytes(partial.shellValue), Uint8Array.of(255, 0, 254));
    assert.equal(await subject.position(), 5);
    assert.equal(subject.opens, 1);
  } finally { await partial.release(); }
});

for (const reason of [false, null, 0, ""]) test(`EOF review: canceled queued operation ${JSON.stringify(reason)} never clears another operation's EOF`, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  const entered = deferred<void>(), gate = deferred<void>(), local = new AbortController();
  let pulls = 0;
  const owner = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() {
      pulls++;
      if (pulls === 1) { entered.resolve(); await gate.promise; return { done: true as const, value: undefined }; }
      return { done: false as const, value: Uint8Array.of(255, 10) };
    },
  }; } }, budget, budget.signal, { provenance: "regular", eof: "retryable" });
  const alias = new ShellInput(owner, budget, local.signal);
  try {
    const active = record(owner, new Uint8Array(), "eof");
    await entered.promise;
    const queued = assert.rejects(alias.record(), error => Object.is(error, reason));
    local.abort(reason);
    await queued;
    assert.equal(pulls, 1);
    gate.resolve();
    await active;
    await record(owner, Uint8Array.of(255, 10), "delimiter");
    assert.equal(pulls, 2);
  } finally { gate.resolve(); await alias.close(); await owner.close(); budget.close(); budget.values.close(); }
});

for (const reason of [false, null, 0, ""]) test(`EOF review: a locally canceled pending EOF ${JSON.stringify(reason)} remains one visible result before retry`, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  const entered = deferred<void>(), gate = deferred<void>(), local = new AbortController();
  let pulls = 0, returns = 0;
  const owner = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() {
      pulls++;
      if (pulls === 1) return { done: true as const, value: undefined };
      if (pulls === 2) { entered.resolve(); await gate.promise; return { done: true as const, value: undefined }; }
      return { done: false as const, value: Uint8Array.of(254, 10) };
    },
    async return() { returns++; return { done: true as const, value: undefined }; },
  }; } }, budget, budget.signal, { provenance: "regular", eof: "retryable" });
  const alias = new ShellInput(owner, budget, local.signal);
  try {
    await record(owner, new Uint8Array(), "eof");
    const reading = assert.rejects(alias.record(), error => Object.is(error, reason));
    await entered.promise;
    local.abort(reason);
    await reading;
    await alias.close();
    assert.equal(returns, 0);
    gate.resolve();
    await record(owner, new Uint8Array(), "eof");
    assert.equal(pulls, 2);
    await record(owner, Uint8Array.of(254, 10), "delimiter");
    assert.equal(pulls, 3);
  } finally { gate.resolve(); await alias.close(); await owner.close(); assert.equal(returns, 1); budget.close(); budget.values.close(); }
});

for (const reason of [false, null, 0, ""]) test(`EOF review: root cancellation ${JSON.stringify(reason)} drains admitted retained retry before descriptor cleanup`, async context => {
  const subject = await retained();
  const entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.close());
  await record(subject.input, new Uint8Array(), "eof");
  subject.hooks.read = async (descriptor, buffer, position, options) => {
    entered.resolve();
    await gate.promise;
    return descriptor.read(buffer, position, options);
  };
  const reading = assert.rejects(subject.input.record(), error => Object.is(error, reason));
  await entered.promise;
  const queued = assert.rejects(subject.input.record(), error => Object.is(error, reason));
  subject.controller.abort(reason);
  let settled = false;
  const closing = subject.prepared.close();
  void closing.then(() => { settled = true; }, () => { settled = true; });
  const closed = assert.rejects(closing, error => Object.is(error, reason));
  try {
    await Promise.all([reading, queued]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(subject.closes, 0);
  } finally { gate.resolve(); await closed; }
  assert.equal(subject.reads, 2);
  assert.equal(subject.closes, 1);
  await assert.rejects(subject.input.record(), error => Object.is(error, reason));
});

for (const target of ["cursor", "prepared"] as const) test(`EOF review: ${target} close after EOF awaits descriptor close and rejects further reads`, async context => {
  const subject = await retained();
  const entered = deferred<void>(), gate = deferred<void>();
  context.after(() => subject.close());
  await record(subject.input, new Uint8Array(), "eof");
  subject.hooks.close = async descriptor => { entered.resolve(); await gate.promise; await descriptor.close(); };
  const closing = target === "cursor" ? subject.input.close() : subject.prepared.close();
  let settled = false;
  void closing.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    const rejected = target === "cursor" ? subject.input.record() : subject.prepared.source[Symbol.asyncIterator]().next();
    await assert.rejects(rejected);
    assert.equal(subject.reads, 1);
  } finally { gate.resolve(); await closing; }
  assert.equal(subject.closes, 1);
});

for (const reason of [false, null, 0, "", new FsError("ENOTSUP"), new FsError("EIO")]) test(`EOF review: post-EOF descriptor failure ${String(reason)} remains exact and never reopens or falls back`, async context => {
  const subject = await retained();
  context.after(() => subject.close());
  await record(subject.input, new Uint8Array(), "eof");
  subject.hooks.read = async () => { throw reason; };
  await assert.rejects(subject.input.record(), error => Object.is(error, reason));
  assert.throws(() => subject.input.readiness(), error => Object.is(error, reason));
  await assert.rejects(subject.prepared.source[Symbol.asyncIterator]().next(), { code: "EBADF" });
  assert.equal(subject.opens, 1);
  assert.equal(subject.stats, 1);
  assert.equal(subject.reads, 2);
  assert.equal(subject.closes, 1);
});

for (const reason of [false, null, new Error("close after EOF")]) test(`EOF review: explicit close failure after EOF ${String(reason)} stays idempotent and exact`, async context => {
  const subject = await retained();
  context.after(() => subject.close());
  await record(subject.input, new Uint8Array(), "eof");
  subject.allowedCleanup.push(reason);
  subject.hooks.close = async descriptor => { await descriptor.close(); throw reason; };
  const first = subject.input.close();
  assert.equal(subject.input.close(), first);
  await assert.rejects(first, error => Object.is(error, reason));
  await assert.rejects(subject.prepared.close(), error => Object.is(error, reason));
  assert.equal(subject.closes, 1);
});

for (const provenance of ["regular", "stream", "unknown"] as const) test(`EOF review: default-terminal ${provenance} policy stays terminal across all reader APIs`, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  let pulls = 0;
  const options: ShellInputOptions = { provenance };
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; return pulls === 1 ? { done: true as const, value: undefined } : { done: false as const, value: Uint8Array.of(88, 10) }; },
  }; } }, budget, budget.signal, options);
  try {
    await record(input, new Uint8Array(), "eof");
    assert.equal((await input.next()).done, true);
    assert.equal(await input.sourceLine(), undefined);
    const result = await input.line(true);
    try { assert.equal(result.reason, "eof"); assert.equal(result.value, ""); }
    finally { await result.release(); }
    assert.equal(pulls, 1);
    assert.equal(input.readiness(), "eof");
  } finally { await input.close(); budget.close(); budget.values.close(); }
});
