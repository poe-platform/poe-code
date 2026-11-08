import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { collectBytes } from "../../../../src/contracts/io.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { inputBufferUsage, prepareBytesInput, prepareFileInput, ShellInput } from "../../../../src/shell/input.js";
import type { PreparedShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { setup } from "../../helpers.js";

function budgetFixture(maxInputBytes = 5, maxExpansionBytes = 0) {
  const controller = new AbortController();
  const budget = new Budget({ ...defaultLimits, maxInputBytes, maxExpansionBytes, maxExpansionFields: 0, maxWallClockMs: 1000 }, controller.signal);
  const cleanups: (() => void | Promise<void>)[] = [];
  return { budget, controller, cleanups,
    async close(prepared?: PreparedShellInput) {
      try {
        const results = await Promise.allSettled([...(prepared ? [prepared.close()] : []), ...cleanups.map(cleanup => Promise.resolve().then(cleanup))]);
        for (const result of results) if (result.status === "rejected") assert.ok(budget.signal.aborted && Object.is(result.reason, budget.signal.reason));
        assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
        assert.deepEqual(inputBufferUsage(budget), { bytes: 0, buffers: 0 });
      } finally { budget.close(); budget.values.close(); }
    },
  };
}

for (const source of ["pass <<EOF\néé\nEOF\n", "pass <<<éé"]) test(`input retention budget: original five-byte inline boundary ${JSON.stringify(source)}`, { timeout: 1500 }, async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec(source, { limits: { maxExpansionBytes: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    const result = await shell.exec(source, { limits: { maxExpansionBytes: 5 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("éé\n"));
  } finally { await shell.dispose(); }
});

test("input retention budget: simultaneous finite inputs have independent allowances and ownership", async () => {
  const subject = budgetFixture();
  const other = budgetFixture();
  let first: PreparedShellInput | undefined, second: PreparedShellInput | undefined;
  try {
    first = prepareBytesInput("first", subject.budget);
    second = prepareBytesInput("other", subject.budget);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 10, buffers: 2 });
    assert.deepEqual(inputBufferUsage(other.budget), { bytes: 0, buffers: 0 });
    assert.throws(() => prepareBytesInput("excess", subject.budget), error => error instanceof FsError && error.code === "EFBIG");
    await first.close();
    await first.close();
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    assert.deepEqual(await collectBytes(second.source, { maxBytes: 5 }), new TextEncoder().encode("other"));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await first?.close(); await subject.close(second); await other.close(); }
});

test("input retention budget: simultaneous canonical files keep separate caps and retained buffers", async () => {
  const subject = budgetFixture();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("first"));
  await fs.writeFile("/second", Buffer.from("other"));
  await fs.writeFile("/excess", Buffer.from("excess"));
  const context = { fs, signal: subject.budget.signal, registerCleanup(cleanup: () => void | Promise<void>) { subject.cleanups.push(cleanup); } };
  try {
    const first = await prepareFileInput(context, "/first", subject.budget);
    const second = await prepareFileInput(context, "/second", subject.budget);
    const excess = await prepareFileInput(context, "/excess", subject.budget);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    const firstIterator = first.source[Symbol.asyncIterator]();
    const secondIterator = second.source[Symbol.asyncIterator]();
    assert.deepEqual((await firstIterator.next()).value, new TextEncoder().encode("first"));
    const retained = await secondIterator.next();
    assert.deepEqual(retained.value, new TextEncoder().encode("other"));
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 10, buffers: 2 });
    await assert.rejects(collectBytes(excess.source, { maxBytes: 6 }), error => error instanceof FsError && error.code === "EFBIG");
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 10, buffers: 2 });
    await first.close();
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    assert.deepEqual(retained.value, new TextEncoder().encode("other"));
    assert.equal((await secondIterator.next()).done, true);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("input retention budget: ownership admission precedes the single finite copy", context => {
  const subject = budgetFixture();
  const NativeBytes = Uint8Array;
  const original = NativeBytes.of(255, 0, 254, 1, 10);
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === original) {
      copies++;
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    }
    return Reflect.construct(target, args, receiver);
  } }));
  const prepared = prepareBytesInput(original, subject.budget);
  assert.equal(copies, 1);
  return subject.close(prepared);
});

test("input retention budget: failed allocation rolls back only its own reservation", async context => {
  const subject = budgetFixture();
  const held = prepareBytesInput("first", subject.budget);
  const NativeBytes = Uint8Array;
  const original = NativeBytes.of(1, 2, 3);
  const failure = new Error("allocation");
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === original) {
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 8, buffers: 2 });
      throw failure;
    }
    return Reflect.construct(target, args, receiver);
  } }));
  try {
    assert.throws(() => prepareBytesInput(original, subject.budget), error => error === failure);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
  } finally { await subject.close(held); }
});

for (const reason of [false, null, 0, ""]) test(`input retention budget: live finite ownership releases on cancellation ${JSON.stringify(reason)}`, async () => {
  const subject = budgetFixture();
  const prepared = prepareBytesInput("first", subject.budget);
  try {
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    subject.controller.abort(reason);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
    await assert.rejects(prepared.source[Symbol.asyncIterator]().next(), error => Object.is(error, reason));
  } finally { await subject.close(prepared); }
});

for (const size of [0, 1, 5, 65_537]) test(`input retention budget: canonical cap ${size} bounds transport and overflow scratch before allocation`, async context => {
  const subject = budgetFixture(size);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(size));
  const prepared = await prepareFileInput({ fs, signal: subject.budget.signal, registerCleanup(cleanup) { subject.cleanups.push(cleanup); } }, "/input", subject.budget);
  const NativeBytes = Uint8Array;
  const capacities: number[] = [];
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (typeof args[0] === "number") {
      capacities.push(args[0]);
      assert.equal(args[0], Math.min(65_536, size) || 1);
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: args[0], buffers: 1 });
    }
    return Reflect.construct(target, args, receiver);
  } }));
  try {
    const iterator = prepared.source[Symbol.asyncIterator]();
    let consumed = 0;
    for (;;) {
      const result = await iterator.next();
      if (result.done) break;
      consumed += result.value.byteLength;
    }
    assert.equal(consumed, size);
    assert.deepEqual(capacities, [Math.min(65_536, size) || 1]);
    context.mock.restoreAll();
    await fs.appendFile("/input", Uint8Array.of(1));
    await assert.rejects(iterator.next(), error => error instanceof FsError && error.code === "EFBIG");
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
  } finally { context.mock.restoreAll(); await subject.close(prepared); }
});

test("input retention budget: zero-cap finite sources allocate nothing and reject nonempty input", async context => {
  const subject = budgetFixture(0);
  const NativeBytes = Uint8Array;
  let allocations = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    allocations++;
    return Reflect.construct(target, args, receiver);
  } }));
  const prepared = prepareBytesInput("", subject.budget);
  try {
    assert.equal((await prepared.source[Symbol.asyncIterator]().next()).done, true);
    assert.throws(() => prepareBytesInput("x", subject.budget), error => error instanceof FsError && error.code === "EFBIG");
    assert.equal(allocations, 0);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
  } finally { await subject.close(prepared); }
});

for (const reason of [false, null, 0, ""]) test(`input retention budget: allocation cancellation wins and releases reservation ${JSON.stringify(reason)}`, async context => {
  const subject = budgetFixture();
  const NativeBytes = Uint8Array;
  const original = NativeBytes.of(255, 10);
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === original) {
      assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 2, buffers: 1 });
      subject.controller.abort(reason);
      throw new Error("allocation failed after cancellation");
    }
    return Reflect.construct(target, args, receiver);
  } }));
  try {
    assert.throws(() => prepareBytesInput(original, subject.budget), error => Object.is(error, reason));
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
  } finally { await subject.close(); }
});

for (const reason of [false, null, 0, ""]) test(`input retention budget: canonical cancellation drains before releasing its active buffer ${JSON.stringify(reason)}`, { timeout: 1500 }, async () => {
  const subject = budgetFixture();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Uint8Array.of(255, 10));
  let entered!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let closes = 0;
  const originalOpen = fs.open.bind(fs);
  fs.open = async (...args) => {
    const descriptor = await originalOpen(...args);
    return new Proxy(descriptor, { get(target, key) {
      if (key === "read") return async (...readArgs: Parameters<typeof descriptor.read>) => {
        entered();
        await gate;
        return descriptor.read(...readArgs);
      };
      if (key === "close") return async () => { closes++; await descriptor.close(); };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  const prepared = await prepareFileInput({ fs, signal: subject.budget.signal, registerCleanup(cleanup) { subject.cleanups.push(cleanup); } }, "/input", subject.budget);
  const reading = prepared.source[Symbol.asyncIterator]().next();
  const rejected = assert.rejects(reading, error => Object.is(error, reason));
  try {
    await admitted;
    subject.controller.abort(reason);
    const closing = prepared.close();
    void closing.catch(() => {});
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 5, buffers: 1 });
    assert.equal(closes, 0);
    release();
    await rejected;
    await assert.rejects(closing, error => Object.is(error, reason));
    assert.equal(closes, 1);
    assert.deepEqual(inputBufferUsage(subject.budget), { bytes: 0, buffers: 0 });
  } finally { release(); await rejected; await subject.close(prepared); }
});

for (const value of ["éé\n", Uint8Array.of(255, 0, 254, 1, 10)]) test(`input retention budget: finite ${typeof value} bytes do not consume expansion-value slots`, { timeout: 1500 }, async () => {
  const subject = budgetFixture();
  const expected = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let prepared: PreparedShellInput | undefined;
  try {
    prepared = prepareBytesInput(value, subject.budget);
    if (typeof value !== "string") value.fill(0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    assert.deepEqual(await collectBytes(prepared.source, { maxBytes: 5, signal: subject.budget.signal }), expected);
    await prepared.close();
    const again = prepareBytesInput(expected, subject.budget);
    try { assert.deepEqual(await collectBytes(again.source, { maxBytes: 5 }), expected); }
    finally { await again.close(); }
  } finally { await subject.close(prepared); }
});

test("input retention budget: oversized finite input is rejected before its ownership copy", context => {
  const NativeBytes = Uint8Array;
  const value = NativeBytes.of(1, 2, 3, 4, 5, 6);
  const subject = budgetFixture();
  let copies = 0;
  context.mock.method(globalThis, "Uint8Array", new Proxy(NativeBytes, { construct(target, args, receiver) {
    if (args[0] === value) copies++;
    return Reflect.construct(target, args, receiver);
  } }));
  try {
    assert.throws(() => prepareBytesInput(value, subject.budget), error => error instanceof FsError && error.code === "EFBIG");
    assert.equal(copies, 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { subject.budget.close(); subject.budget.values.close(); }
});

test("input retention budget: canonical file transport buffer does not exhaust expansion values", { timeout: 1500 }, async () => {
  const subject = budgetFixture();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("éé\n"));
  let prepared: PreparedShellInput | undefined;
  try {
    prepared = await prepareFileInput({ fs, signal: subject.budget.signal, registerCleanup(cleanup) { subject.cleanups.push(cleanup); } }, "/input", subject.budget);
    assert.deepEqual(await collectBytes(prepared.source, { maxBytes: 5, signal: subject.budget.signal }), new TextEncoder().encode("éé\n"));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(prepared); }
});

test("input retention budget: conversion to an owned read value still enforces the value arena", { timeout: 1500 }, async () => {
  const subject = budgetFixture();
  let prepared: PreparedShellInput | undefined;
  let input: ShellInput | undefined;
  try {
    prepared = prepareBytesInput(Uint8Array.of(255, 10), subject.budget);
    input = new ShellInput(prepared.source, subject.budget, subject.budget.signal, prepared.options);
    await assert.rejects(input.record(), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  } finally {
    if (input) await input.close().catch(error => { assert.ok(subject.budget.signal.aborted && Object.is(error, subject.budget.signal.reason)); });
    await subject.close(prepared);
  }
});

for (const reason of [false, null, 0, ""]) test(`input retention budget: cancelled preparation preserves ${JSON.stringify(reason)}`, async () => {
  const subject = budgetFixture();
  try {
    subject.controller.abort(reason);
    assert.throws(() => prepareBytesInput(Uint8Array.of(255), subject.budget), error => Object.is(error, reason));
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});
