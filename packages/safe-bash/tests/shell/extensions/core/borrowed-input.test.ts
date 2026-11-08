import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext, ShellInputBorrow } from "../../../../src/shell/extensions.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(execute: (command: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [{ name: "borrow-bridge", create: () => ({ builtins: [{ name: "consume", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

test("raw records retain NUL, delimiters and invalid bytes across descriptor aliases", async context => {
  const { fs, shell } = setup(async command => {
    const first = command.input.borrow(3);
    const second = command.input.borrow(4);
    const record = await first.record();
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"), "ff00610a");
    assert.equal(record.reason, "delimiter");
    await first.release();
    const next = await second.record({ delimiter: 0 });
    assert.equal(Buffer.from(shellValueBytes(next.shellValue)).toString("hex"), "6200");
    const tail = await second.read(true);
    assert.equal(tail.value, "tail");
    await record.release(); await next.release(); await tail.release(); await second.release();
    return 0;
  });
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("ff00610a62007461696c0a", "hex"));
  const result = await shell.exec("consume 3</input 4<&3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const readiness of ["ready", "blocked", "unknown", "eof"] as const) test(`borrow forwards owned readiness without consuming: ${readiness}`, async context => {
  let pulls = 0;
  const budget = new Budget(defaultLimits);
  const input = new ShellInput({ async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("record\n"); } }, budget, budget.signal, { provenance: "stream", poll: () => readiness });
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), readiness);
    assert.equal(pulls, 0);
    await lease.release();
    assert.throws(() => lease.readiness(), /closed/u);
    return 0;
  });
  context.after(async () => { await shell.dispose(); await input.close(); budget.close(); budget.values.close(); });
  const result = await shell.exec("consume", { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("invalid read deadlines and raw delimiters reject before source consumption", async context => {
  let pulls = 0;
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    for (const timeoutMs of [0, -1, Infinity, NaN]) await assert.rejects(lease.read(true, { timeoutMs }), /timeout|options/u);
    for (const delimiter of [-1, 256, 1.5, NaN]) await assert.rejects(lease.record({ delimiter }), /delimiter|options/u);
    assert.equal(pulls, 0);
    await lease.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("line\n"); } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("unknown provenance does not silently accept a positive deadline", async context => {
  let pulls = 0;
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "unknown");
    await assert.rejects(lease.read(true, { timeoutMs: 10 }), /provenance/u);
    assert.equal(pulls, 0);
    await lease.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("line\n"); } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("positive deadline reaches the owned clock and retains its timeout outcome", async context => {
  let expire: (() => void) | undefined;
  let scheduled: number | undefined;
  let cancellations = 0;
  let now = 0;
  const budget = new Budget(defaultLimits);
  const input = new ShellInput({ async *[Symbol.asyncIterator]() { now = 12.5; expire!(); yield Buffer.from("late\n"); } }, budget, budget.signal, {
    provenance: "stream", poll: () => "blocked", clock: { now: () => now, schedule(delay, callback) { scheduled = delay; expire = callback; return () => { cancellations++; }; } },
  });
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    const record = await lease.read(true, { timeoutMs: 12.5 });
    assert.equal(record.reason, "timeout");
    assert.equal(scheduled, 12.5);
    await record.release(); await lease.release();
    return 0;
  });
  context.after(async () => { await shell.dispose(); await input.close(); budget.close(); budget.values.close(); });
  const result = await shell.exec("consume", { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(cancellations, 0);
});

test("released and escaped borrows reject record and readiness operations", async context => {
  let escaped: ShellInputBorrow | undefined;
  const { shell } = setup(async command => {
    escaped = command.input.borrow(0);
    const record = await escaped.record();
    assert.equal(record.reason, "eof");
    await record.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume");
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(escaped!.record(), /closed/u);
  assert.throws(() => escaped!.readiness(), /closed/u);
  await escaped!.release();
});

test("read option capture forwards a deadline once and never admits capability overrides", async context => {
  let timeoutReads = 0;
  let cancellations = 0;
  const budget = new Budget(defaultLimits);
  const input = new ShellInput({ async *[Symbol.asyncIterator]() { yield Buffer.from("line\n"); } }, budget, budget.signal, {
    provenance: "stream", clock: { now: () => 0, schedule(delay) { assert.equal(delay, 8); return () => { cancellations++; }; } },
  });
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    const options = {
      get timeoutMs() { timeoutReads++; return 8; },
      get provenance(): never { throw new Error("must not consult caller provenance"); },
      get clock(): never { throw new Error("must not consult caller clock"); },
      get poll(): never { throw new Error("must not consult caller poll"); },
    };
    const record = await lease.read(true, options);
    assert.equal(record.reason, "delimiter");
    assert.equal(record.value, "line");
    await record.release(); await lease.release();
    return 0;
  });
  context.after(async () => { await shell.dispose(); await input.close(); budget.close(); budget.values.close(); });
  const result = await shell.exec("consume", { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(timeoutReads, 1);
  assert.equal(cancellations, 1);
});

test("concurrent borrowed raw records serialize on the same cursor and release idempotently", async context => {
  const { shell } = setup(async command => {
    const first = command.input.borrow(0);
    const second = command.input.borrow(0);
    const records = await Promise.all([first.record(), second.record(), first.record()]);
    assert.deepEqual(records.map(record => Buffer.from(shellValueBytes(record.shellValue)).toString()), ["one\n", "two\n", "last"]);
    assert.deepEqual(records.map(record => record.reason), ["delimiter", "delimiter", "eof"]);
    for (const record of records) {
      const released = record.release();
      assert.equal(record.release(), released);
      await released;
    }
    await first.release(); await second.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("consume", { stdin: Buffer.from("one\ntwo\nlast") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const reason of [false, 0, "", null]) test(`raw record cancellation drains cooperative producers: ${String(reason)}`, async context => {
  const controller = new AbortController();
  let finalized = false;
  const { shell } = setup(async command => {
    const lease = command.input.borrow(0);
    await lease.record();
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() { try { controller.abort(reason); yield Uint8Array.of(255, 0); } finally { finalized = true; } } };
  await assert.rejects(shell.exec("consume", { stdin, signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(finalized, true);
});
