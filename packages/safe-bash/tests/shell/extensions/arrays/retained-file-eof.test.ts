import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { prepareFileInput, ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";

function intercept<Target extends object>(target: Target, overrides: Partial<Target>): Target {
  return new Proxy(target, { get(original, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(original, key, original);
    return typeof value === "function" ? value.bind(original) : value;
  } });
}

async function fixture(initial = "one\n", maxInputBytes = defaultLimits.maxInputBytes) {
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxInputBytes, maxWallClockMs: 1000 }, controller.signal);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from(initial));
  let opens = 0, reads = 0, closes = 0;
  const cleanups: (() => void | Promise<void>)[] = [];
  const observed: FileSystem = intercept(fs, { async open(path, options) {
    opens++;
    const descriptor = await fs.open(path, options);
    return intercept(descriptor, {
      async read(...args) { reads++; return descriptor.read(...args); },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  const prepared = await prepareFileInput({ fs: observed, signal: budget.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } }, "/input", budget);
  const input = new ShellInput(prepared.source, budget, budget.signal, prepared.options);
  return { fs, budget, controller, prepared, input,
    get opens() { return opens; }, get reads() { return reads; }, get closes() { return closes; },
    async close() {
      try {
        const results = await Promise.allSettled([input.close(), prepared.close(), ...cleanups.map(cleanup => Promise.resolve().then(cleanup))]);
        for (const result of results) if (result.status === "rejected") {
          assert.ok(budget.signal.aborted && Object.is(result.reason, budget.signal.reason), "cleanup may only reject with this fixture's root cancellation");
        }
        assert.equal(closes, 1);
        assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

async function expectRecord(input: ShellInput, text: string, reason: "delimiter" | "eof") {
  const result = await input.record();
  try {
    assert.equal(result.reason, reason);
    assert.deepEqual(shellValueBytes(result.shellValue), new TextEncoder().encode(text));
  } finally { await result.release(); }
}

test("retained file EOF: canonical source retries the same descriptor after append", { timeout: 1500 }, async () => {
  const subject = await fixture();
  try {
    const iterator = subject.prepared.source[Symbol.asyncIterator]();
    assert.deepEqual((await iterator.next()).value, new TextEncoder().encode("one\n"));
    assert.equal((await iterator.next()).done, true);
    await subject.fs.appendFile("/input", Buffer.from("two\n"));
    const next = await iterator.next();
    assert.equal(next.done, false, "EOF terminates a read operation, not the retained regular descriptor");
    assert.deepEqual(next.value, new TextEncoder().encode("two\n"));
    assert.equal(subject.opens, 1);
    assert.equal(subject.closes, 0);
  } finally { await subject.close(); }
});

for (const operation of ["line", "record"] as const) test(`retained file EOF: ${operation} retries across operations and retains bytes`, { timeout: 1500 }, async () => {
  const subject = await fixture();
  const read = () => operation === "line" ? subject.input.line(true) : subject.input.record();
  try {
    const first = await read();
    assert.equal(first.reason, "delimiter");
    await first.release();
    const eof = await read();
    assert.equal(eof.reason, "eof");
    assert.equal(shellValueBytes(eof.shellValue).length, 0);
    await eof.release();
    assert.ok(["ready", "eof"].includes(subject.input.readiness()));
    await subject.fs.appendFile("/input", Uint8Array.of(255, 0, 10));
    const next = await read();
    try {
      assert.equal(next.reason, "delimiter");
      assert.deepEqual(shellValueBytes(next.shellValue), operation === "line" ? Uint8Array.of(255) : Uint8Array.of(255, 0, 10));
    } finally { await next.release(); }
    assert.equal(subject.opens, 1);
  } finally { await subject.close(); }
});

test("retained file EOF: empty operations are bounded and retry once on the next operation", { timeout: 1500 }, async () => {
  const subject = await fixture("");
  try {
    for (let count = 1; count <= 3; count++) {
      await expectRecord(subject.input, "", "eof");
      assert.equal(subject.reads, count, "one zero-byte descriptor result ends this operation without spinning");
    }
    await subject.fs.appendFile("/input", Buffer.from("later\n"));
    await expectRecord(subject.input, "later\n", "delimiter");
    assert.equal(subject.opens, 1);
  } finally { await subject.close(); }
});

test("retained file EOF: borrowed aliases share the offset and cannot retire the owner", { timeout: 1500 }, async () => {
  const subject = await fixture();
  const alias = new ShellInput(subject.input, subject.budget);
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(alias, "", "eof");
    await alias.close();
    await subject.fs.appendFile("/input", Buffer.from("two\nthree\n"));
    const laterAlias = new ShellInput(subject.input, subject.budget);
    try {
      await expectRecord(laterAlias, "two\n", "delimiter");
      await expectRecord(subject.input, "three\n", "delimiter");
    } finally { await laterAlias.close(); }
    assert.equal(subject.opens, 1);
    assert.equal(subject.closes, 0);
  } finally { await alias.close(); await subject.close(); }
});

test("retained file EOF: rename and pathname replacement cannot change the retained node", { timeout: 1500 }, async () => {
  const subject = await fixture();
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(subject.input, "", "eof");
    await subject.fs.rename("/input", "/retained");
    await subject.fs.writeFile("/input", Buffer.from("wrong\n"));
    await subject.fs.appendFile("/retained", Buffer.from("two\n"));
    await expectRecord(subject.input, "two\n", "delimiter");
    assert.equal(subject.opens, 1);
  } finally { await subject.close(); }
});

test("retained file EOF: unlinked node grows through its independently retained writer", { timeout: 1500 }, async () => {
  const subject = await fixture();
  const writer = await subject.fs.open("/input", { access: "write", append: true });
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(subject.input, "", "eof");
    await subject.fs.rm("/input");
    assert.equal(await writer.write(Buffer.from("two\n"), null), 4);
    await expectRecord(subject.input, "two\n", "delimiter");
    assert.equal(subject.opens, 1);
  } finally { await writer.close(); await subject.close(); }
});

test("retained file EOF: truncation never rewinds the shared offset", { timeout: 1500 }, async () => {
  const subject = await fixture();
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(subject.input, "", "eof");
    await subject.fs.truncate("/input", 0);
    await subject.fs.appendFile("/input", Buffer.from("x\n"));
    await expectRecord(subject.input, "", "eof");
    await subject.fs.appendFile("/input", Buffer.from("ABtwo\n"));
    await expectRecord(subject.input, "two\n", "delimiter");
    assert.equal(subject.opens, 1);
  } finally { await subject.close(); }
});

test("retained file EOF: input-byte allowance remains cumulative across empty reads", { timeout: 1500 }, async () => {
  const subject = await fixture("one\n", 6);
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(subject.input, "", "eof");
    await subject.fs.appendFile("/input", Buffer.from("two\n"));
    await assert.rejects(subject.input.record(), error => error instanceof FsError && error.code === "EFBIG");
  } finally { await subject.close(); }
});

test("retained file EOF: explicit owner close releases a descriptor that only returned EOF", { timeout: 1500 }, async () => {
  const subject = await fixture("");
  try {
    await expectRecord(subject.input, "", "eof");
    assert.equal(subject.closes, 0, "regular EOF must not close an otherwise retained descriptor");
    await subject.input.close();
    assert.equal(subject.closes, 1, "cursor close must not skip cleanup merely because its last result was EOF");
  } finally { await subject.close(); }
});

for (const reason of [false, null, 0, ""]) test(`retained file EOF: root cancellation ${JSON.stringify(reason)} forbids a later retry`, { timeout: 1500 }, async () => {
  const subject = await fixture();
  try {
    await expectRecord(subject.input, "one\n", "delimiter");
    await expectRecord(subject.input, "", "eof");
    await subject.fs.appendFile("/input", Buffer.from("two\n"));
    const reads = subject.reads;
    subject.controller.abort(reason);
    await assert.rejects(subject.input.record(), error => Object.is(error, reason));
    assert.equal(subject.reads, reads);
  } finally { await subject.close(); }
});

for (const provenance of ["stream", "unknown", "regular"] as const) test(`retained file EOF: ${provenance} terminal sources are never repulled`, { timeout: 1500 }, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  let pulls = 0;
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() {
      pulls++;
      return pulls === 1 ? { done: true as const, value: undefined } : { done: false as const, value: Buffer.from("must not revive\n") };
    },
  }; } }, budget, budget.signal, { provenance });
  try {
    await expectRecord(input, "", "eof");
    await expectRecord(input, "", "eof");
    await expectRecord(input, "", "eof");
    assert.equal(pulls, 1);
  } finally { await input.close(); budget.close(); budget.values.close(); }
});

for (const provenance of ["stream", "unknown", undefined] as const) test(`retained file EOF: retryable policy rejects ${String(provenance)} before source acquisition`, () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  let acquisitions = 0;
  const source = { [Symbol.asyncIterator]() { acquisitions++; return { async next() { return { done: true as const, value: undefined }; } }; } };
  const options = { ...(provenance === undefined ? {} : { provenance }), eof: "retryable" as const };
  try {
    assert.throws(() => new ShellInput(source, budget, budget.signal, options), TypeError);
    assert.equal(acquisitions, 0);
  } finally { budget.close(); budget.values.close(); }
});

test("retained file EOF: malformed policy is rejected before source acquisition", () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  let acquisitions = 0;
  const source = { [Symbol.asyncIterator]() { acquisitions++; return { async next() { return { done: true as const, value: undefined }; } }; } };
  try {
    assert.throws(() => Reflect.construct(ShellInput, [source, budget, budget.signal, { provenance: "regular", eof: "invalid" }]), TypeError);
    assert.equal(acquisitions, 0);
  } finally { budget.close(); budget.values.close(); }
});

test("retained file EOF: policy is captured once and aliases cannot override it", { timeout: 1500 }, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  let captures = 0, pulls = 0;
  const options = { provenance: "regular" as const, get eof() { captures++; return "retryable" as const; } };
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; return pulls === 2 ? { done: false as const, value: Buffer.from("later\n") } : { done: true as const, value: undefined }; },
  }; } }, budget, budget.signal, options);
  const alias = new ShellInput(input, budget);
  try {
    assert.equal(captures, 1);
    Object.defineProperty(options, "eof", { value: "terminal" });
    assert.throws(() => new ShellInput(input, budget, budget.signal, options), /Borrowed input/);
    await expectRecord(input, "", "eof");
    await expectRecord(alias, "later\n", "delimiter");
    assert.equal(captures, 1);
    assert.equal(pulls, 2);
  } finally { await alias.close(); await input.close(); budget.close(); budget.values.close(); }
});

test("retained file EOF: a queued operation resets EOF only after the preceding operation ends", { timeout: 1500 }, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  let admit!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { admit = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pulls = 0;
  const options = { provenance: "regular" as const, eof: "retryable" as const };
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() {
      pulls++;
      if (pulls === 1) return { done: false as const, value: Buffer.from("partial") };
      if (pulls === 2) { admit(); await gate; return { done: true as const, value: undefined }; }
      return { done: false as const, value: Buffer.from("later\n") };
    },
  }; } }, budget, budget.signal, options);
  try {
    const first = input.record();
    await waiting;
    const second = input.record();
    release();
    const results = await Promise.all([first, second]);
    try {
      assert.equal(results[0].reason, "eof");
      assert.deepEqual(shellValueBytes(results[0].shellValue), new TextEncoder().encode("partial"));
      assert.equal(results[1].reason, "delimiter");
      assert.deepEqual(shellValueBytes(results[1].shellValue), new TextEncoder().encode("later\n"));
      assert.equal(pulls, 3);
    } finally { await Promise.all(results.map(result => result.release())); }
  } finally { release(); await input.close(); budget.close(); budget.values.close(); }
});

test("retained file EOF: local cancellation preserves the single pending retry for the owner", { timeout: 1500 }, async () => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 1000 });
  const local = new AbortController();
  let admit!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { admit = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pulls = 0;
  const options = { provenance: "regular" as const, eof: "retryable" as const };
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() {
      pulls++;
      if (pulls === 1) return { done: true as const, value: undefined };
      admit(); await gate;
      return { done: false as const, value: Uint8Array.of(255, 10) };
    },
  }; } }, budget, budget.signal, options);
  const alias = new ShellInput(input, budget, local.signal);
  try {
    await expectRecord(input, "", "eof");
    const reading = alias.record();
    const reached = await Promise.race([waiting.then(() => true), reading.then(() => false, () => false)]);
    assert.equal(reached, true, "a new operation must issue the retained-descriptor retry");
    local.abort(false);
    await assert.rejects(reading, reason => reason === false);
    await alias.close();
    release();
    const record = await input.record();
    try { assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 10)); }
    finally { await record.release(); }
    assert.equal(pulls, 2);
  } finally { release(); await alias.close(); await input.close(); budget.close(); budget.values.close(); }
});
