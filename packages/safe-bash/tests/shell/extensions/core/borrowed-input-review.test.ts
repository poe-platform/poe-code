import assert from "node:assert/strict";
import test from "node:test";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext, ShellInputBorrow } from "../../../../src/shell/extensions.js";
import { ShellInput, type InputClock, type ShellInputOptions } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

class Clock implements InputClock {
  time = 0;
  readonly timers = new Map<object, { at: number; expire: () => void }>();
  now(): number { return this.time; }
  schedule(delay: number, expire: () => void): () => void {
    const token = {};
    this.timers.set(token, { at: this.time + delay, expire });
    return () => { this.timers.delete(token); };
  }
  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [token, timer] of [...this.timers]) if (timer.at <= this.time) {
      this.timers.delete(token); timer.expire();
    }
  }
}

function owned(options: ShellInputOptions = {}) {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 }), clock = new Clock(), entered = deferred<void>();
  let pulls = 0, returns = 0;
  const pending: ((result: IteratorResult<Uint8Array>) => void)[] = [];
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    next() { pulls++; entered.resolve(); return new Promise<IteratorResult<Uint8Array>>(resolve => { pending.push(resolve); }); },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } }, budget, budget.signal, { provenance: "stream", poll: () => "blocked", clock, ...options });
  return { input, budget, clock, entered, get pulls() { return pulls; }, get returns() { return returns; },
    send(value: Uint8Array) { assert.equal(pending.length, 1); pending.shift()!({ done: false, value }); },
    async close() { try { await input.close(); } finally { budget.close(); budget.values.close(); } },
  };
}

function setup(execute: (context: ShellExtensionContext) => Promise<number>, limits: ShellLimits = {}) {
  const fs = createMemoryFileSystem();
  return { fs, shell: new Shell({ fs, limits, extensions: [{ name: "borrow-review", create: () => ({ builtins: [{ name: "consume", execute }] }) }] }) };
}

test("borrow review: raw records and counted reads preserve one descriptor-alias cursor and exact remaining bytes", async () => {
  const subject = setup(async context => {
    const first = context.input.borrow(3), second = context.input.borrow(4);
    const record = await first.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await first.release();
    const counted = await second.read(true, { count: 1 });
    assert.deepEqual(shellValueBytes(counted.shellValue), Uint8Array.of(128));
    const nul = await second.record({ delimiter: 0 });
    const tail = await second.record();
    assert.deepEqual(shellValueBytes(nul.shellValue), Uint8Array.of(0));
    assert.deepEqual(shellValueBytes(tail.shellValue), Uint8Array.of(254, 10));
    await Promise.all([record.release(), counted.release(), nul.release(), tail.release(), second.release()]);
    return 0;
  });
  try {
    await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10, 128, 0, 254, 10));
    const result = await subject.shell.exec("consume 3</input 4<&3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await subject.shell.dispose(); }
});

test("borrow review: timed lease release retains one pending pull for a later raw-record lease", async () => {
  const source = owned(), expired = deferred<void>();
  const subject = setup(async context => {
    const first = context.input.borrow(0);
    const timed = await first.read(true, { timeoutMs: 2 });
    assert.equal(timed.reason, "timeout");
    assert.equal(timed.value, "");
    await timed.release(); await first.release();
    const second = context.input.borrow(0);
    expired.resolve();
    const record = await second.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await record.release(); await second.release();
    return 0;
  });
  try {
    const execution = subject.shell.exec("consume", { stdin: source.input });
    await source.entered.promise;
    source.clock.advance(2);
    await expired.promise;
    assert.equal(source.pulls, 1);
    assert.equal(source.returns, 0);
    source.send(Uint8Array.of(255, 0, 10));
    const result = await execution;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(source.pulls, 1);
    assert.equal(source.clock.timers.size, 0);
  } finally { await subject.shell.dispose(); await source.close(); }
});

test("borrow review: queued deadlines do not consume the active raw record or unlock its successor", async () => {
  const source = owned(), queued = deferred<void>(), expired = deferred<void>();
  const subject = setup(async context => {
    const first = context.input.borrow(0), second = context.input.borrow(0);
    const head = first.record();
    const timeout = second.read(true, { timeoutMs: 3 });
    queued.resolve();
    const timed = await timeout;
    assert.equal(timed.reason, "timeout");
    await timed.release(); await second.release();
    const tail = first.record();
    expired.resolve();
    const [headRecord, tailRecord] = await Promise.all([head, tail]);
    assert.deepEqual(shellValueBytes(headRecord.shellValue), Uint8Array.of(255, 0, 10));
    assert.deepEqual(shellValueBytes(tailRecord.shellValue), Uint8Array.of(128, 10));
    await Promise.all([headRecord.release(), tailRecord.release()]);
    await first.release();
    return 0;
  });
  try {
    const execution = subject.shell.exec("consume", { stdin: source.input });
    await Promise.all([source.entered.promise, queued.promise]);
    source.clock.advance(3);
    await expired.promise;
    assert.equal(source.pulls, 1);
    source.send(Uint8Array.of(255, 0, 10, 128, 10));
    const result = await execution;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(source.pulls, 1);
  } finally { await subject.shell.dispose(); await source.close(); }
});

test("borrow review: explicit regular provenance ignores deadlines without allocating clock work", async () => {
  const source = owned({ provenance: "regular" });
  const subject = setup(async context => {
    const lease = context.input.borrow(0);
    const record = await lease.read(true, { timeoutMs: 1 });
    assert.equal(record.reason, "delimiter");
    assert.equal(record.value, "A");
    await record.release(); await lease.release();
    return 0;
  });
  try {
    const execution = subject.shell.exec("consume", { stdin: source.input });
    await source.entered.promise;
    assert.equal(source.clock.timers.size, 0);
    source.clock.advance(100);
    source.send(Uint8Array.of(65, 10));
    const result = await execution;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await subject.shell.dispose(); await source.close(); }
});

test("borrow review: invalid zero timeout and unknown positive timeout leave raw input untouched", async () => {
  let pulls = 0;
  const subject = setup(async context => {
    const lease = context.input.borrow(0);
    const { read, record, readiness, release } = lease;
    assert.equal(readiness(), "unknown");
    for (const timeoutMs of [0, -0, -1, NaN, Infinity]) await assert.rejects(read(true, { timeoutMs }), /options/);
    await assert.rejects(read(true, { timeoutMs: 2 }), /provenance/);
    assert.equal(pulls, 0);
    const result = await record();
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255, 0, 10));
    await result.release(); await release();
    return 0;
  });
  try {
    const result = await subject.shell.exec("consume", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255, 0, 10); } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(pulls, 1);
  } finally { await subject.shell.dispose(); }
});

test("borrow review: reentrant lease release from an option getter prevents consumption", async () => {
  let pulls = 0;
  const subject = setup(async context => {
    const lease = context.input.borrow(0);
    let releasing: Promise<void> | undefined;
    await assert.rejects(lease.record({ get delimiter() { releasing = lease.release(); return 10; } }), /closed/);
    await releasing;
    assert.equal(pulls, 0);
    const next = context.input.borrow(0);
    const record = await next.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
    await record.release(); await next.release();
    return 0;
  });
  try {
    const result = await subject.shell.exec("consume", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255, 0, 10); } } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await subject.shell.dispose(); }
});

test("borrow review: closed invocation rejects before consulting escaped option getters or polling", async () => {
  let escaped: ShellInputBorrow | undefined, optionsRead = 0, polls = 0;
  const source = owned({ poll: () => { polls++; return "ready"; } });
  const subject = setup(async context => { escaped = context.input.borrow(0); return 0; });
  try {
    const result = await subject.shell.exec("consume", { stdin: source.input });
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(escaped!.record({ get delimiter() { optionsRead++; return 10; } }), /closed/);
    await assert.rejects(escaped!.read(true, { get timeoutMs() { optionsRead++; return 1; } }), /closed/);
    assert.throws(() => escaped!.readiness(), /closed/);
    assert.deepEqual({ optionsRead, polls, pulls: source.pulls }, { optionsRead: 0, polls: 0, pulls: 0 });
    assert.equal(escaped!.release(), escaped!.release());
    await escaped!.release();
  } finally { await subject.shell.dispose(); await source.close(); }
});

test("borrow review: raw option capture ignores attempted readiness and deadline capability overrides", async () => {
  let delimiters = 0;
  const subject = setup(async context => {
    const lease = context.input.borrow(0);
    const options = { get delimiter() { delimiters++; return 0; },
      get timeoutMs(): never { throw new Error("record does not accept a timeout"); },
      get provenance(): never { throw new Error("record cannot replace provenance"); },
      get poll(): never { throw new Error("record cannot replace readiness"); },
    };
    const record = await lease.record(options);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0));
    await record.release(); await lease.release();
    assert.equal(delimiters, 1);
    return 0;
  });
  try {
    const result = await subject.shell.exec("consume", { stdin: Uint8Array.of(255, 0, 10) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await subject.shell.dispose(); }
});

for (const reason of [false, 0, "", null, NaN]) {
  test(`borrow review: readiness forwards exact falsey provider failure ${String(reason)}`, async () => {
    const source = owned({ poll: () => { throw reason; } });
    const subject = setup(async context => {
      const lease = context.input.borrow(0);
      assert.throws(() => lease.readiness(), error => Object.is(error, reason));
      await lease.release();
      return 0;
    });
    try {
      const result = await subject.shell.exec("consume", { stdin: source.input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(source.pulls, 0);
    } finally { await subject.shell.dispose(); await source.close(); }
  });
}

test("borrow review: raw record budget rejection escapes the Shell and leaves escaped lease closed", async () => {
  let escaped: ShellInputBorrow | undefined;
  const subject = setup(async context => {
    escaped = context.input.borrow(0);
    await escaped.record();
    throw new Error("must not return an over-budget record");
  }, { maxOutputBytes: 2 });
  try {
    await assert.rejects(subject.shell.exec("consume", { stdin: Uint8Array.of(255, 0, 10) }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    await escaped!.release();
    await assert.rejects(escaped!.record(), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await subject.shell.dispose(); }
});
