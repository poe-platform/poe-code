import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput, writeFileOutputCounted } from "../../src/contracts/filesystem-output.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

const outputLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxOutputBytes";

for (const script of ["copy", "delegate", "bash -c copy"]) test(`Shell shares stdout and partial named writes without double charging: ${script}`, async context => {
  const fs = createMemoryFileSystem();
  const open = fs.open.bind(fs);
  let writes = 0;
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = (buffer, position, options) => { writes++; return write(buffer.subarray(0, 2), position, options); };
    return descriptor;
  };
  const shell = new Shell({ fs, limits: { maxOutputBytes: 6 } });
  context.after(() => shell.dispose());
  shell.register({ name: "copy", async execute(command) {
    await command.stdout.write(Buffer.from("xy"));
    const descriptor = await openCommandFile(command, "/out", { access: "write", creation: "exclusive" });
    const bytes = Buffer.from("abcd");
    assert.equal(await descriptor.write(bytes, null), 2);
    assert.equal(await descriptor.write(bytes.subarray(2), null), 2);
    return { exitCode: 0 };
  } });
  shell.register({ name: "delegate", execute: command => command.invoke!("copy", []) });
  const result = await shell.exec(script);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "xy");
  assert.equal(result.stderr, "");
  assert.equal(writes, 2);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "abcd");
});

test("shebang middleware receives the counted budget binding", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/script", Buffer.from("#!/usr/bin/env bash\n:\n"));
  await fs.chmod!("/script", 0o755);
  const shell = new Shell({ fs, limits: { maxOutputBytes: 2 } });
  context.after(() => shell.dispose());
  let counted = 0;
  shell.use(async (command, next) => {
    if (command.command === "env") {
      assert.equal(await writeFileOutputCounted(command, Buffer.from("xy"), async () => { counted++; return 2; }), 2);
    }
    return next();
  });
  const result = await shell.exec("/script");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(counted, 1);
});

test("stdout, streaming named output and counted descriptors use one ledger", async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxOutputBytes: 4 } });
  context.after(() => shell.dispose());
  shell.register({ name: "mixed", async execute(command) {
    await command.stdout.write(Buffer.from("a"));
    const output = await openFileOutput(command, "/stream", "w");
    await output.sink.write(Buffer.from("b"));
    await output.finish();
    const descriptor = await openCommandFile(command, "/counted", { access: "write", creation: "exclusive" });
    assert.equal(await descriptor.write(Buffer.from("cd"), null), 2);
    return { exitCode: 0 };
  } });
  const result = await shell.exec("mixed");
  assert.equal(result.stdout, "a");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/stream")).toString(), "b");
  assert.equal(Buffer.from(await fs.readFile("/counted")).toString(), "cd");
});

test("output reservation refuses an oversized request before the writer runs", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 2 } });
  context.after(() => shell.dispose());
  let called = false;
  shell.register({ name: "overflow", async execute(command) {
    await command.stdout.write(Buffer.from("x"));
    await assert.rejects(writeFileOutputCounted(command, Buffer.from("yz"), async () => { called = true; return 1; }), outputLimit);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("overflow"), outputLimit);
  assert.equal(called, false);
});

for (const count of [-1, 1.5, NaN, Infinity, 4]) test(`invalid count retains reservation in actual Shell: ${count}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 3 } });
  context.after(() => shell.dispose());
  let called = 0;
  shell.register({ name: "invalid", async execute(command) {
    await assert.rejects(writeFileOutputCounted(command, new Uint8Array(3), async () => { called++; return count; }), { code: "EIO" });
    await command.stdout.write(Uint8Array.of(1));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("invalid"), outputLimit);
  assert.equal(called, 1);
});

for (const reason of [false, 0, "", null]) test(`unknown failed effects retain reservation and falsey failure: ${String(reason)}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 3 } });
  context.after(() => shell.dispose());
  let called = 0;
  shell.register({ name: "failed", async execute(command) {
    await assert.rejects(writeFileOutputCounted(command, new Uint8Array(3), async () => { called++; throw reason; }), error => Object.is(error, reason));
    await command.stdout.write(Uint8Array.of(1));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("failed"), outputLimit);
  assert.equal(called, 1);
});

test("valid partial and zero counts settle once and permit retries", async context => {
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: 4 });
  context.after(() => budget.close());
  assert.equal(await budget.writeCounted(new Uint8Array(4), async () => 0), 0);
  assert.equal(budget.bytes, 0);
  assert.equal(await budget.writeCounted(new Uint8Array(4), () => new Promise<number>(resolve => { resolve(2); resolve(0); })), 2);
  assert.equal(budget.bytes, 2);
  assert.equal(await budget.writeCounted(new Uint8Array(2), async () => 2), 2);
  assert.equal(budget.bytes, 4);
  assert.equal(await budget.writeCounted(new Uint8Array(), async () => 0), 0);
});

for (const reason of [false, 0, "", null]) test(`cancellation accounting distinguishes direct validated counts from guarded rejection: ${String(reason)}`, async context => {
  for (const guarded of [false, true]) {
    const controller = new AbortController();
    const budget = new Budget({ ...defaultLimits, maxOutputBytes: 3 }, controller.signal);
    context.after(() => budget.close());
    const write = async () => { controller.abort(reason); return 1; };
    const command = { signal: controller.signal, registerCleanup: () => {} };
    bindFileOutputBudget(command, sink => sink, (chunk, callback) => budget.writeCounted(chunk, callback));
    const operation = guarded ? writeFileOutputCounted(command, new Uint8Array(3), write) : budget.writeCounted(new Uint8Array(3), write);
    await assert.rejects(operation, error => Object.is(error, reason));
    assert.equal(budget.bytes, guarded ? 3 : 1);
  }
});

for (const count of [-1, 0.5, NaN, Infinity, 4]) test(`Budget independently validates count ${count} before any refund`, async context => {
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: 3 });
  context.after(() => budget.close());
  await assert.rejects(budget.writeCounted(new Uint8Array(3), async () => count), { code: "EIO" });
  assert.equal(budget.bytes, 3);
});

test("Budget retains reservations when the writer throws synchronously", async context => {
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: 3 });
  context.after(() => budget.close());
  await assert.rejects(budget.writeCounted(new Uint8Array(3), () => { throw false; }), error => error === false);
  assert.equal(budget.bytes, 3);
});

test("partial settlement uses the reserved length even if the writer transfers its buffer", async context => {
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: 4 });
  context.after(() => budget.close());
  const chunk = new Uint8Array(4);
  assert.equal(await budget.writeCounted(chunk, async () => {
    structuredClone(chunk, { transfer: [chunk.buffer] });
    return 2;
  }), 2);
  assert.equal(chunk.byteLength, 0);
  assert.equal(budget.bytes, 2);
});

test("unknown descriptor failure after a real partial effect does not refund", async context => {
  const fs = createMemoryFileSystem();
  const open = fs.open.bind(fs);
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = async (buffer, position, options) => {
      await write(buffer.subarray(0, 1), position, options);
      throw false;
    };
    return descriptor;
  };
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } });
  context.after(() => shell.dispose());
  shell.register({ name: "effect", async execute(command) {
    const descriptor = await openCommandFile(command, "/out", { access: "write", creation: "exclusive" });
    await assert.rejects(descriptor.write(Buffer.from("abc"), null), error => error === false);
    await command.stdout.write(Buffer.from("x"));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("effect"), outputLimit);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "a");
});

test("in-flight reservations prevent concurrent output oversubscription", async context => {
  const budget = new Budget({ ...defaultLimits, maxOutputBytes: 4 });
  context.after(() => budget.close());
  const entered = deferred(), release = deferred();
  const pending = budget.writeCounted(new Uint8Array(4), async () => { entered.resolve(); await release.promise; return 2; });
  const checked = assert.rejects(pending, outputLimit);
  try {
    await entered.promise;
    assert.equal(budget.bytes, 4);
    let invoked = false;
    await assert.rejects(budget.writeCounted(new Uint8Array(1), async () => { invoked = true; return 1; }), outputLimit);
    assert.equal(invoked, false);
  } finally { release.resolve(); await checked; }
  assert.equal(budget.bytes, 2);
});

for (const reason of [false, 0, "", null]) test(`root cancellation awaits counted write and failing descriptor close: ${String(reason)}`, { timeout: 2000 }, async () => {
  const fs = createMemoryFileSystem();
  const open = fs.open.bind(fs);
  const entered = deferred(), releaseWrite = deferred(), closing = deferred(), releaseClose = deferred();
  let closed = 0;
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    const close = descriptor.close.bind(descriptor);
    descriptor.write = async () => { entered.resolve(); await releaseWrite.promise; return 1; };
    descriptor.close = async () => { closed++; closing.resolve(); await releaseClose.promise; await close(); throw new Error("secondary close"); };
    return descriptor;
  };
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } });
  shell.register({ name: "held", async execute(command) {
    const descriptor = await openCommandFile(command, "/out", { access: "write", creation: "exclusive" });
    await descriptor.write(new Uint8Array(3), null);
    return { exitCode: 0 };
  } });
  const controller = new AbortController();
  const operation = shell.exec("held", { signal: controller.signal });
  const checked = assert.rejects(operation, error => Object.is(error, reason));
  let settled = false;
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    controller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(closed, 0);
    releaseWrite.resolve();
    await closing.promise;
    assert.equal(settled, false);
  } finally {
    releaseWrite.resolve();
    releaseClose.resolve();
    await checked;
    await shell.dispose();
  }
  assert.equal(closed, 1);
});
