import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileDescriptor, type FileSystem } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, writeFileOutputCounted, type CountedFileWrite } from "../../src/contracts/filesystem-output.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function owner() {
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const fs: FileSystem = createMemoryFileSystem();
  return { fs, controller, signal: controller.signal, cleanups,
    registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); } };
}

function ledger(limit: number) {
  let used = 0;
  const counted: CountedFileWrite = async (chunk, write) => {
    if (chunk.length > limit - used) throw new FsError("EFBIG");
    used += chunk.length;
    const count = await write();
    used -= chunk.length - count;
    return count;
  };
  return { counted, used: () => used };
}

test("review: failing counted binding drains already admitted buffer work before settlement", async () => {
  const context = owner();
  const entered = deferred(), release = deferred();
  let writing: Promise<number> | undefined;
  let touched = false, settled = false;
  bindFileOutputBudget(context, sink => sink, async (_chunk, write) => {
    writing = write();
    void writing.catch(() => {});
    throw false;
  });
  const operation = writeFileOutputCounted(context, Uint8Array.of(1), async () => {
    entered.resolve();
    await release.promise;
    touched = true;
    return 1;
  });
  const checked = assert.rejects(operation, error => error === false);
  void operation.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(touched, false);
    assert.equal(settled, false, "a released caller buffer must not be touched by outstanding admitted work");
  } finally {
    release.resolve();
    await Promise.all([checked, writing]);
  }
});

test("review: a counted binding cannot invoke a saved writer after helper settlement", async () => {
  const context = owner();
  let saved: (() => Promise<number>) | undefined;
  let calls = 0;
  bindFileOutputBudget(context, sink => sink, async (_chunk, write) => { saved = write; throw 0; });
  await assert.rejects(writeFileOutputCounted(context, Uint8Array.of(1), async () => { calls++; return 1; }), error => error === 0);
  assert.ok(saved);
  await assert.rejects(saved);
  assert.equal(calls, 0);
});

test("review: registration may close admission synchronously before capability lookup or open", async () => {
  const context = owner();
  let acquired = 0, inspected = 0;
  let closing: Promise<void> | undefined;
  context.fs.capabilitiesFor = async () => { inspected++; return context.fs.capabilities; };
  const open = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => { acquired++; return open(...args); };
  await assert.rejects(openCommandFile({ ...context, registerCleanup(cleanup) {
    context.cleanups.push(cleanup);
    closing = Promise.resolve(cleanup());
  } }, "/file", { access: "write", creation: "exclusive" }), { code: "EBADF" });
  await closing;
  assert.equal(inspected, 0);
  assert.equal(acquired, 0);
  assert.deepEqual(await context.fs.readdir("/"), []);
});

test("review: late owned acquisition drains close without requiring root cancellation", async () => {
  const context = owner();
  const retained = await context.fs.open!("/file", { access: "readwrite", creation: "exclusive" });
  const started = deferred(), entered = deferred(), release = deferred();
  const delivered = deferred<FileDescriptor>();
  const close = retained.close.bind(retained);
  let closes = 0, settled = false;
  retained.close = async () => { closes++; entered.resolve(); await release.promise; await close(); };
  context.fs.open = async () => { assert.equal(context.cleanups.length, 1); started.resolve(); return delivered.promise; };
  const opening = openCommandFile(context, "/file", { access: "readwrite" });
  const checked = assert.rejects(opening, { code: "EBADF" });
  void opening.then(() => { settled = true; }, () => { settled = true; });
  await started.promise;
  const closing = Promise.resolve(context.cleanups[0]!());
  delivered.resolve(retained);
  try {
    await entered.promise;
    assert.equal(settled, false);
  } finally {
    release.resolve();
    await Promise.all([closing, checked]);
  }
  assert.equal(closes, 1);
});

test("review: falsey capability failure remains primary over acquisition cleanup failure", async () => {
  const context = owner();
  const retained = await context.fs.open!("/file", { access: "read", creation: "exclusive" });
  const close = retained.close.bind(retained);
  let closes = 0;
  Object.defineProperty(retained, "capabilities", { get() { throw false; } });
  retained.close = async () => { closes++; await close(); throw 0; };
  context.fs.open = async () => retained;
  await assert.rejects(openCommandFile(context, "/file", { access: "read" }), error => error === false);
  assert.equal(closes, 1);
  await assert.rejects(retained.stat(), { code: "EBADF" });
});

test("review: root cancellation during late cleanup overrides falsey acquisition failure", async () => {
  const context = owner();
  const retained = await context.fs.open!("/file", { access: "read", creation: "exclusive" });
  const close = retained.close.bind(retained);
  Object.defineProperty(retained, "capabilities", { get() { throw false; } });
  retained.close = async () => { context.controller.abort(0); await close(); throw null; };
  context.fs.open = async () => retained;
  await assert.rejects(openCommandFile(context, "/file", { access: "read" }), error => error === 0);
  await assert.rejects(retained.stat(), { code: "EBADF" });
});

test("review: two descriptors share an enrolled partial-count budget without filling short writes", async () => {
  const context = owner();
  const budget = ledger(3);
  bindFileOutputBudget(context, sink => sink, budget.counted);
  const open = context.fs.open!.bind(context.fs);
  let calls = 0;
  context.fs.open = async (...args) => {
    const retained = await open(...args);
    const write = retained.write.bind(retained);
    retained.write = (chunk, position, options) => { calls++; return write(chunk.subarray(0, 1), position, options); };
    return retained;
  };
  const first = await openCommandFile(context, "/first", { access: "write", creation: "exclusive" });
  const second = await openCommandFile({ ...context }, "/second", { access: "write", creation: "exclusive" });
  try {
    assert.equal(await first.write(Uint8Array.of(1, 2), null), 1);
    assert.equal(await second.write(Uint8Array.of(3, 4), null), 1);
    assert.equal(budget.used(), 2);
    await assert.rejects(first.write(Uint8Array.of(5, 6), null), { code: "EFBIG" });
    assert.equal(calls, 2);
    assert.deepEqual(await context.fs.readFile("/first"), Uint8Array.of(1));
    assert.deepEqual(await context.fs.readFile("/second"), Uint8Array.of(3));
  } finally { await Promise.all([first.close(), second.close()]); }
});

for (const outcome of ["invalid", "unknown"] as const) {
  test(`review: ${outcome} descriptor write outcome never refunds the offered bytes`, async () => {
    const context = owner();
    const budget = ledger(3);
    bindFileOutputBudget(context, sink => sink, budget.counted);
    const open = context.fs.open!.bind(context.fs);
    context.fs.open = async (...args) => {
      const retained = await open(...args);
      retained.write = async () => { if (outcome === "unknown") throw undefined; return 4; };
      return retained;
    };
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
    try {
      await assert.rejects(descriptor.write(new Uint8Array(3), null), error => outcome === "unknown" ? error === undefined : error instanceof FsError && error.code === "EIO");
      assert.equal(budget.used(), 3);
    } finally { await descriptor.close(); }
  });
}

test("review: enrolled sink-only owners refuse writes but standalone owners remain usable", async () => {
  const context = owner();
  await context.fs.writeFile("/file", Uint8Array.of(7));
  bindFileOutputBudget(context, sink => sink);
  await assert.rejects(openCommandFile(context, "/file", { access: "write", truncate: true }), { code: "ENOTSUP" });
  const reader = await openCommandFile(context, "/file", { access: "read" });
  try {
    const buffer = new Uint8Array(1);
    assert.equal(await reader.read(buffer, null), 1);
    assert.equal(buffer[0], 7);
    await assert.rejects(reader.write(Uint8Array.of(8), null), { code: "EBADF" });
  } finally { await reader.close(); }
  const standalone = await openCommandFile({ fs: context.fs, signal: context.signal }, "/file", { access: "write" });
  try { assert.equal(await standalone.write(Uint8Array.of(9), 0), 1); }
  finally { await standalone.close(); }
  assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(9));
});

test("review: admitted queued work drains on close while cancellation suppresses dispatch", async () => {
  const context = owner();
  const entered = deferred(), release = deferred();
  const open = context.fs.open!.bind(context.fs);
  const canceled = new AbortController();
  let writes = 0, closes = 0;
  context.fs.open = async (...args) => {
    const retained = await open(...args);
    const write = retained.write.bind(retained), close = retained.close.bind(retained);
    retained.write = async (...request) => { writes++; entered.resolve(); await release.promise; return write(...request); };
    retained.close = async () => { closes++; await close(); };
    return retained;
  };
  const descriptor = await openCommandFile(context, "/file", { access: "readwrite", creation: "exclusive" });
  const active = descriptor.write(Uint8Array.of(1), null);
  const pending = descriptor.write(Uint8Array.of(2), null, { signal: canceled.signal });
  const checked = assert.rejects(pending, error => error === false);
  await entered.promise;
  canceled.abort(false);
  const closing = descriptor.close();
  try {
    assert.equal(descriptor.close(), closing);
    for (const operation of [() => descriptor.stat(), () => descriptor.read(new Uint8Array(1), null), () => descriptor.truncate(0), () => descriptor.sync(false)]) {
      await assert.rejects(operation, { code: "EBADF" });
    }
    assert.equal(closes, 0);
  } finally {
    release.resolve();
    await Promise.all([active, checked, closing]);
  }
  assert.equal(writes, 1);
  assert.equal(closes, 1);
  assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(1));
});

for (const limit of [5, 6]) {
  test(`review: nested Shell invocations share counted files, stdout, and stderr at limit ${limit}`, async context => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs, limits: { maxOutputBytes: limit } });
    context.after(() => shell.dispose());
    shell.register({ name: "review-leaf", async execute(command) {
      const descriptor = await openCommandFile(command, command.args[0]!, { access: "write", creation: "exclusive" });
      assert.equal(await descriptor.write(Uint8Array.of(255), null), 1);
      await command.stdout.write(Uint8Array.of(65));
      await command.stderr.write(Uint8Array.of(66));
      return { exitCode: 0 };
    } });
    shell.register({ name: "review-parent", async execute(command) {
      await command.invoke!("review-leaf", ["/first"]);
      return command.invoke!("review-leaf", ["/second"]);
    } });
    if (limit === 6) {
      const result = await shell.exec("review-parent");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "AA");
      assert.equal(result.stderr, "BB");
    } else await assert.rejects(shell.exec("review-parent"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(await fs.readFile("/first"), Uint8Array.of(255));
    assert.deepEqual(await fs.readFile("/second"), Uint8Array.of(255));
  });
}

test("review: actual Shell root cancellation wins over falsey writer and close failures after partial effects", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  const open = fs.open.bind(fs);
  let closes = 0;
  fs.open = async (...args) => {
    const descriptor = await open(...args);
    const write = descriptor.write.bind(descriptor), close = descriptor.close.bind(descriptor);
    descriptor.write = async (chunk, position, options) => {
      await write(chunk.subarray(0, 1), position, options);
      controller.abort(false);
      throw 0;
    };
    descriptor.close = async () => { closes++; await close(); throw undefined; };
    return descriptor;
  };
  const shell = new Shell({ fs, limits: { maxOutputBytes: 3 } });
  shell.register({ name: "review-cancel", async execute(command) {
    const descriptor = await openCommandFile(command, "/out", { access: "write", creation: "exclusive" });
    await descriptor.write(Uint8Array.of(255, 0, 128), null);
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("review-cancel", { signal: controller.signal }), error => error === false);
    assert.equal(closes, 1);
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(255));
  } finally { await shell.dispose(); }
});
