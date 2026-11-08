import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";

function fixture(source: ByteSource, limits: ShellLimits = {}) {
  const root = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000, ...limits }, root.signal);
  const input = new ShellInput(source, budget);
  return { root, budget, input, async close() {
    try { await input.close(); }
    catch (reason) { if (!budget.signal.aborted || !Object.is(reason, budget.signal.reason)) throw reason; }
    finally { budget.close(); budget.values.close(); }
  } };
}

function controlled(limits: ShellLimits = {}) {
  const waiting: { resolve: (result: IteratorResult<Uint8Array>) => void; reject: (reason: unknown) => void }[] = [];
  let pulls = 0, returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() {
      pulls++;
      return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => { waiting.push({ resolve, reject }); });
    },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  return { ...fixture(source, limits), waiting,
    get pulls() { return pulls; }, get returns() { return returns; },
    send(value?: Uint8Array) {
      assert.equal(waiting.length, 1, "there must be exactly one admitted producer pull");
      waiting.shift()!.resolve(value === undefined ? { done: true, value: undefined } : { done: false, value });
    },
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

for (const delimiter of [0, 10, 128, 255]) for (const fragmentSize of [1, 7, 129]) {
  test(`raw review: every byte survives reusable fragments of ${fragmentSize}, delimiter=${delimiter}`, async () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, index) => index % 256);
    const reusable = new Uint8Array(fragmentSize);
    const subject = fixture({ async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < bytes.length; offset += fragmentSize) {
        const length = Math.min(fragmentSize, bytes.length - offset);
        reusable.set(bytes.subarray(offset, offset + length));
        yield reusable.subarray(0, length);
        reusable.fill(238);
      }
    } });
    try {
      const first = await subject.input.record({ delimiter });
      const second = await subject.input.record({ delimiter });
      const tail = await subject.input.record({ delimiter });
      assert.equal(first.reason, "delimiter");
      assert.equal(second.reason, "delimiter");
      assert.equal(tail.reason, "eof");
      assert.deepEqual(shellValueBytes(first.shellValue), bytes.slice(0, delimiter + 1));
      assert.deepEqual(shellValueBytes(second.shellValue), bytes.slice(delimiter + 1, delimiter + 257));
      assert.deepEqual(shellValueBytes(tail.shellValue), bytes.slice(delimiter + 257));
      shellValueBytes(first.shellValue).fill(42);
      assert.deepEqual(shellValueBytes(first.shellValue), bytes.slice(0, delimiter + 1));
      assert.ok(Object.isFrozen(first));
      await Promise.all([first.release(), second.release(), tail.release()]);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
  });
}

test("raw review: record, read line, source line and byte readers share one ordered cursor", async () => {
  const subject = controlled();
  const borrower = new ShellInput(subject.input, subject.budget);
  try {
    const raw = subject.input.record({ delimiter: 0 });
    const line = borrower.line(false);
    const binary = borrower.record({ delimiter: 255 });
    const source = subject.input.sourceLine();
    const last = borrower.next();
    await turn();
    subject.send(Uint8Array.of(255, 0, 97, 92, 10, 98, 0, 99, 10, 128, 255, 120, 0, 121, 10, 254));
    const [rawResult, lineResult, binaryResult, sourceResult, lastResult] = await Promise.all([raw, line, binary, source, last]);
    assert.deepEqual(shellValueBytes(rawResult.shellValue), Uint8Array.of(255, 0));
    assert.equal(lineResult.reason, "delimiter");
    assert.deepEqual(shellValueBytes(lineResult.shellValue), Uint8Array.of(97, 98, 99));
    assert.deepEqual(shellValueBytes(binaryResult.shellValue), Uint8Array.of(128, 255));
    assert.deepEqual(sourceResult, Uint8Array.of(120, 0, 121, 10));
    assert.deepEqual(lastResult.value, Uint8Array.of(254));
    assert.equal(subject.pulls, 1);
    await Promise.all([rawResult.release(), lineResult.release(), binaryResult.release()]);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await borrower.close(); await subject.close(); }
});

test("raw review: closing a partial borrowed record retains its pending pull without replaying consumed bytes", async () => {
  const subject = controlled();
  const borrower = new ShellInput(subject.input, subject.budget);
  try {
    const reading = borrower.record();
    const rejected = assert.rejects(reading, /closed/);
    await turn();
    subject.send(Uint8Array.of(255, 0));
    await turn();
    assert.equal(subject.pulls, 2);
    const closing = borrower.close();
    assert.equal(borrower.close(), closing);
    await Promise.all([rejected, closing]);
    assert.equal(subject.returns, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    const resumed = subject.input.record();
    await turn();
    assert.equal(subject.pulls, 2);
    subject.send(Uint8Array.of(128, 0, 10));
    const record = await resumed;
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(128, 0, 10));
    await record.release();
  } finally { await borrower.close(); await subject.close(); }
  assert.equal(subject.returns, 1);
});

test("raw review: a cancelled queued borrower cannot release the active owner's cursor lock", async () => {
  const subject = controlled(), local = new AbortController();
  const borrower = new ShellInput(subject.input, subject.budget, local.signal);
  try {
    const first = subject.input.record();
    await turn();
    const cancelled = borrower.record({ delimiter: 0 });
    const rejected = assert.rejects(cancelled, reason => reason === false);
    const last = subject.input.record();
    local.abort(false);
    await rejected;
    await borrower.close();
    await turn();
    assert.equal(subject.pulls, 1);
    assert.equal(subject.input.readiness(), "blocked");
    subject.send(Uint8Array.of(1, 0, 10, 2, 10));
    const [head, tail] = await Promise.all([first, last]);
    assert.deepEqual(shellValueBytes(head.shellValue), Uint8Array.of(1, 0, 10));
    assert.deepEqual(shellValueBytes(tail.shellValue), Uint8Array.of(2, 10));
    await Promise.all([head.release(), tail.release()]);
    assert.equal(subject.returns, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await borrower.close(); await subject.close(); }
});

test("raw review: closing a borrower releases only its records, not another view's held result", async () => {
  const subject = controlled();
  const borrower = new ShellInput(subject.input, subject.budget);
  const consumer = subject.budget.values.scope();
  try {
    const first = borrower.record();
    const second = subject.input.record();
    await turn();
    subject.send(Uint8Array.of(255, 0, 10, 128, 10));
    const [borrowed, owned] = await Promise.all([first, second]);
    const held = consumer.hold(borrowed.shellValue);
    await borrower.close();
    assert.equal(subject.returns, 0);
    assert.deepEqual(shellValueBytes(held.value), Uint8Array.of(255, 0, 10));
    assert.deepEqual(shellValueBytes(owned.shellValue), Uint8Array.of(128, 10));
    assert.ok(subject.budget.values.usage.bytes > 0);
    const releasing = borrowed.release();
    assert.equal(borrowed.release(), releasing);
    await Promise.all([releasing, owned.release()]);
    assert.ok(subject.budget.values.usage.bytes > 0);
    consumer.close();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { consumer.close(); await borrower.close(); await subject.close(); }
});

for (const reason of [undefined, null, false, 0, -0, "", NaN]) {
  test(`raw review: a partial record preserves producer rejection ${String(reason)}, negative zero=${Object.is(reason, -0)}`, async () => {
    const subject = controlled();
    try {
      const reading = subject.input.record();
      const rejected = assert.rejects(reading, error => Object.is(error, reason));
      await turn();
      subject.send(Uint8Array.of(255, 0, 128));
      await turn();
      assert.equal(subject.pulls, 2);
      subject.waiting.shift()!.reject(reason);
      await rejected;
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
      assert.throws(() => subject.input.readiness(), error => Object.is(error, reason));
    } finally { await subject.close(); }
    assert.equal(subject.returns, 1);
  });
}

for (const maxExpansionBytes of [200, 320]) {
  test(`raw review: arena rejection at ${maxExpansionBytes} precedes payload copying`, async () => {
    const bytes = Uint8Array.of(255, 0, 10);
    const subject = fixture({ async *[Symbol.asyncIterator]() { yield bytes; } }, { maxExpansionBytes });
    const NativeBytes = Uint8Array;
    let bufferAllocations = 0, payloadCopies = 0;
    globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
      const first: unknown = args[0];
      if (typeof first === "number" && first > 0) bufferAllocations++;
      if (first instanceof NativeBytes && first.byteLength > 0) payloadCopies++;
      return Reflect.construct(target, args, receiver);
    } });
    try {
      await assert.rejects(subject.input.record(), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
      assert.equal(payloadCopies, 0);
      if (maxExpansionBytes === 200) assert.equal(bufferAllocations, 0);
      else assert.ok(bufferAllocations > 0);
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { globalThis.Uint8Array = NativeBytes; await subject.close(); }
  });
}

for (const maxOutputBytes of [2, 3]) {
  test(`raw review: retained NUL and delimiter both count against output budget ${maxOutputBytes}`, async () => {
    const subject = controlled({ maxOutputBytes });
    try {
      const reading = subject.input.record();
      const rejected = maxOutputBytes === 2 ? assert.rejects(reading, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes") : undefined;
      await turn();
      subject.send(Uint8Array.of(255, 0, 10));
      if (rejected) await rejected;
      else {
        const record = await reading;
        assert.equal(record.reason, "delimiter");
        assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
        await record.release();
      }
      assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    } finally { await subject.close(); }
  });
}

test("raw review: a queued record's arena failure cancels a partial active record without a competing pull", async () => {
  const subject = controlled({ maxExpansionBytes: 450 });
  const failures: unknown[] = [];
  const rejected = (error: unknown): boolean => {
    failures.push(error);
    return error instanceof ShellLimitError && error.limit === "maxExpansionBytes";
  };
  try {
    const active = subject.input.record();
    const activeRejected = assert.rejects(active, rejected);
    await turn();
    subject.send(Uint8Array.of(255, 0));
    await turn();
    assert.equal(subject.pulls, 2);
    await assert.rejects(subject.input.record(), rejected);
    await activeRejected;
    assert.equal(failures.length, 2);
    assert.equal(failures[0], failures[1]);
    assert.equal(subject.pulls, 2);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
  assert.equal(subject.returns, 1);
});

test("raw review: root false supersedes late producer failure and drains active and queued records", async () => {
  const subject = controlled();
  try {
    const first = subject.input.record();
    const firstRejected = assert.rejects(first, reason => reason === false);
    await turn();
    subject.send(Uint8Array.of(255, 0));
    await turn();
    const queued = subject.input.record();
    const queuedRejected = assert.rejects(queued, reason => reason === false);
    subject.root.abort(false);
    subject.waiting.shift()!.reject(new Error("late producer"));
    await Promise.all([firstRejected, queuedRejected]);
    assert.equal(subject.pulls, 2);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
  assert.equal(subject.returns, 1);
});
