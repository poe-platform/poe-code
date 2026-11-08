import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { ShellInput, type InputClock, type ShellInputOptions } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";

class ReviewClock implements InputClock {
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
    for (const [token, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(token);
      timer.expire();
    }
  }
}

function fixture(options: ShellInputOptions = {}, limits: ShellLimits = {}) {
  const root = new AbortController(), clock = new ReviewClock();
  const waiting: { resolve: (value: IteratorResult<Uint8Array>) => void; reject: (reason: unknown) => void }[] = [];
  let pulls = 0, returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      pulls++;
      return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => { waiting.push({ resolve, reject }); });
    },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits }, root.signal);
  const input = new ShellInput(source, budget, budget.signal, { provenance: "stream", clock, ...options });
  return {
    root, clock, budget, input, waiting,
    get pulls() { return pulls; }, get returns() { return returns; },
    send(value?: Uint8Array) {
      assert.equal(waiting.length, 1, "only one retained producer pull may exist");
      waiting.shift()!.resolve(value === undefined ? { done: true, value: undefined } : { done: false, value });
    },
    async close() {
      try { await input.close(); }
      catch (reason) { if (!budget.signal.aborted || !Object.is(reason, budget.signal.reason)) throw reason; }
      finally { budget.close(); budget.values.close(); }
    },
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("deadline review: repeated timeouts and released borrowed views retain exactly one pull", async () => {
  const subject = fixture();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const borrower = new ShellInput(subject.input, subject.budget);
      try {
        const reading = borrower.line(true, { timeoutMs: 2 });
        await turn();
        assert.equal(subject.pulls, 1);
        subject.clock.advance(2);
        const record = await reading;
        assert.equal(record.reason, "timeout");
        assert.equal(record.value, "");
        await record.release();
      } finally { await borrower.close(); }
      assert.equal(subject.returns, 0);
      assert.equal(subject.waiting.length, 1);
      assert.equal(subject.clock.timers.size, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    }
    subject.send(Uint8Array.of(255, 10, 128));
    await turn();
    assert.equal(subject.input.readiness(), "ready");
    const record = await subject.input.line(true);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255));
    await record.release();
    assert.deepEqual((await subject.input.next()).value, Uint8Array.of(128));
    assert.equal(subject.pulls, 1);
  } finally { await subject.close(); }
  assert.equal(subject.returns, 1);
});

test("deadline review: out-of-order queued expirations cannot consume or unlock the active record", async () => {
  const subject = fixture({ poll: () => "ready" });
  try {
    const first = subject.input.line(true);
    await turn();
    const queued = [3, 1, 2].map(timeoutMs => subject.input.line(true, { timeoutMs }));
    subject.clock.advance(3);
    const expired = await Promise.all(queued);
    for (const record of expired) {
      assert.equal(record.reason, "timeout");
      assert.equal(record.value, "");
      await record.release();
    }
    const last = subject.input.line(true);
    await turn();
    assert.equal(subject.input.readiness(), "blocked");
    assert.equal(subject.pulls, 1);
    subject.send(Uint8Array.of(65, 10, 66, 10));
    const [head, tail] = await Promise.all([first, last]);
    assert.equal(head.value, "A");
    assert.equal(tail.value, "B");
    assert.equal(subject.pulls, 1);
    await Promise.all([head.release(), tail.release()]);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

for (const reason of [undefined, null, false, 0, -0, "", NaN]) {
  test(`deadline review: retained producer rejection preserves exact falsey reason ${String(reason)} signed=${Object.is(reason, -0)}`, async () => {
    const subject = fixture({ poll: () => "eof" });
    try {
      const reading = subject.input.line(true, { timeoutMs: 1 });
      await turn();
      subject.clock.advance(1);
      const record = await reading;
      await record.release();
      subject.waiting.shift()!.reject(reason);
      await turn();
      assert.throws(() => subject.input.readiness(), error => Object.is(error, reason));
      await assert.rejects(subject.input.line(true), error => Object.is(error, reason));
      assert.equal(subject.pulls, 1);
      assert.equal(subject.clock.timers.size, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
  });
}

for (const abortFirst of [false, true]) {
  test(`deadline review: root false wins over queued expiry and a late rejected producer; abort first=${abortFirst}`, async () => {
    const subject = fixture();
    try {
      const active = subject.input.line(true);
      const activeRejected = assert.rejects(active, reason => reason === false);
      await turn();
      const queued = subject.input.line(true, { timeoutMs: 1 });
      const queuedRejected = assert.rejects(queued, reason => reason === false);
      if (abortFirst) subject.root.abort(false);
      subject.clock.advance(1);
      if (!abortFirst) subject.root.abort(false);
      subject.waiting.shift()!.reject(new Error("late producer rejection"));
      await Promise.all([activeRejected, queuedRejected]);
      assert.throws(() => subject.input.readiness(), reason => reason === false);
      assert.equal(subject.clock.timers.size, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
    assert.equal(subject.returns, 1);
  });
}

test("deadline review: timeout records survive producer reuse and release does not close pending input", async () => {
  const subject = fixture();
  try {
    const reading = subject.input.line(true, { timeoutMs: 1, byteCount: true });
    await turn();
    const reusable = Uint8Array.of(255, 32, 128);
    subject.send(reusable);
    await turn();
    assert.equal(subject.pulls, 2);
    reusable.fill(88);
    subject.clock.advance(1);
    const record = await reading;
    assert.equal(record.reason, "timeout");
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 32, 128));
    assert.deepEqual((await record.fields(" ")).map(field => [...shellValueBytes(field.value)]), [[255], [128]]);
    assert.ok(subject.budget.values.usage.bytes > 0);
    const releasing = record.release();
    assert.equal(record.release(), releasing);
    await releasing;
    await assert.rejects(record.fields(" "), /closed/);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.equal(subject.returns, 0);
    subject.send(Uint8Array.of(65, 10));
    const next = await subject.input.line(true);
    assert.equal(next.value, "A");
    await next.release();
    assert.equal(subject.pulls, 2);
  } finally { await subject.close(); }
});

for (const maximum of [3, 4]) {
  test(`deadline review: a timed record obeys payload budget ${maximum} and releases timer allocations`, async () => {
    const subject = fixture({}, { maxOutputBytes: maximum });
    try {
      const reading = subject.input.line(true, { timeoutMs: 1, byteCount: true });
      const rejected = maximum === 3 ? assert.rejects(reading, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes") : undefined;
      await turn();
      subject.send(Uint8Array.of(255, 128, 65, 66));
      await turn();
      if (rejected) await rejected;
      else {
        subject.clock.advance(1);
        const record = await reading;
        assert.equal(record.reason, "timeout");
        assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 128, 65, 66));
        await record.release();
      }
      assert.equal(subject.clock.timers.size, 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
  });
}

test("deadline review: timer reservation is refused before scheduling or pulling under a small arena budget", async () => {
  const subject = fixture({}, { maxExpansionBytes: 300 });
  try {
    await assert.rejects(subject.input.line(true, { timeoutMs: 1 }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal(subject.pulls, 0);
    assert.equal(subject.clock.timers.size, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("deadline review: unknown provenance cannot acquire timed semantics from a readiness callback", async () => {
  let polls = 0;
  const subject = fixture({ provenance: "unknown", poll: () => { polls++; return "ready"; } });
  try {
    assert.equal(subject.input.readiness(), "ready");
    await assert.rejects(subject.input.line(true, { timeoutMs: 1 }), /provenance/);
    assert.equal(polls, 1);
    assert.equal(subject.pulls, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("deadline review: regular provenance ignores timers but records observed EOF without repulling", async () => {
  let polls = 0;
  const subject = fixture({ provenance: "regular", poll: () => { polls++; return "blocked"; } });
  try {
    assert.equal(subject.input.readiness(), "ready");
    assert.equal(polls, 0);
    const reading = subject.input.line(true, { timeoutMs: 1 });
    await turn();
    subject.clock.advance(100);
    assert.equal(subject.clock.timers.size, 0);
    assert.equal(subject.input.readiness(), "blocked");
    subject.send();
    const record = await reading;
    assert.equal(record.reason, "eof");
    assert.equal(record.terminated, false);
    await record.release();
    assert.equal(subject.input.readiness(), "eof");
    assert.equal(polls, 0);
    assert.equal((await subject.input.next()).done, true);
    assert.equal(subject.pulls, 1);
  } finally { await subject.close(); }
});

test("deadline review: retained bytes and known EOF override stale polling without a competing read", async () => {
  let polls = 0;
  const subject = fixture({ poll: () => { polls++; return "blocked"; } });
  try {
    assert.equal(subject.input.readiness(), "blocked");
    const reading = subject.input.line(true, { timeoutMs: 1 });
    await turn();
    subject.clock.advance(1);
    const timeout = await reading;
    await timeout.release();
    subject.send(Uint8Array.of(65, 10, 66));
    await turn();
    assert.equal(subject.input.readiness(), "ready");
    assert.equal(polls, 1);
    const record = await subject.input.line(true);
    await record.release();
    assert.equal(subject.input.readiness(), "ready");
    assert.equal(polls, 1);
    assert.deepEqual((await subject.input.next()).value, Uint8Array.of(66));
    const next = subject.input.next();
    await turn();
    subject.send();
    assert.equal((await next).done, true);
    assert.equal(subject.input.readiness(), "eof");
    assert.equal(polls, 1);
    assert.equal(subject.pulls, 2);
  } finally { await subject.close(); }
});

test("deadline review: bytes arriving at an elapsed deadline stay available without timer dispatch", async () => {
  const subject = fixture();
  try {
    const reading = subject.input.line(true, { timeoutMs: 5 });
    await turn();
    subject.clock.time = 5;
    subject.send(Uint8Array.of(255, 10));
    const expired = await reading;
    assert.equal(expired.reason, "timeout");
    assert.equal(expired.value, "");
    await expired.release();
    assert.equal(subject.input.readiness(), "ready");
    const record = await subject.input.line(true);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255));
    assert.equal(record.reason, "delimiter");
    assert.equal(subject.pulls, 1);
    assert.equal(subject.clock.timers.size, 0);
    await record.release();
  } finally { await subject.close(); }
});

test("deadline review: local falsey cancellation leaves a retained pull usable by the owning input", async () => {
  const subject = fixture(), local = new AbortController();
  const borrower = new ShellInput(subject.input, subject.budget, local.signal);
  try {
    const reading = borrower.line(true, { timeoutMs: 10 });
    const rejected = assert.rejects(reading, reason => reason === false);
    await turn();
    local.abort(false);
    await rejected;
    await borrower.close();
    assert.equal(subject.budget.signal.aborted, false);
    assert.equal(subject.returns, 0);
    assert.equal(subject.clock.timers.size, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    subject.send(Uint8Array.of(128, 10));
    const record = await subject.input.line(true);
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(128));
    assert.equal(subject.pulls, 1);
    await record.release();
  } finally { await subject.close(); }
});

test("deadline review: releasing a timeout record joins suspended field scanning before freeing its arena", async () => {
  const subject = fixture();
  try {
    const reading = subject.input.line(true, { timeoutMs: 1 });
    await turn();
    subject.send(new Uint8Array(4096).fill(65));
    for (let attempt = 0; subject.pulls < 2 && attempt < 100; attempt++) await turn();
    assert.equal(subject.pulls, 2);
    subject.clock.advance(1);
    const record = await reading;
    assert.equal(record.reason, "timeout");
    const fields = record.fields(" ");
    const rejected = assert.rejects(fields, /closed/);
    const releasing = record.release();
    assert.equal(record.release(), releasing);
    assert.ok(subject.budget.values.usage.bytes > 0);
    await Promise.all([rejected, releasing]);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.equal(subject.returns, 0);
    assert.equal(subject.waiting.length, 1);
    assert.equal(subject.clock.timers.size, 0);
  } finally { await subject.close(); }
});
