import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, FsError, type FileDescriptor, type FileSystem } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { bindFileOutputBudget, writeFileOutputCounted, type CountedFileWrite } from "../../src/contracts/filesystem-output.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function owner(fs: FileSystem = createMemoryFileSystem()) {
  const cleanups: InvocationCleanup[] = [];
  const controller = new AbortController();
  return { fs, signal: controller.signal, controller, cleanups,
    registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); } };
}

function ledger(limit: number) {
  let used = 0;
  const counted: CountedFileWrite = async (chunk, write) => {
    if (chunk.byteLength > limit - used) throw new Error("test output limit");
    used += chunk.byteLength;
    const count = await write();
    assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= chunk.byteLength);
    used -= chunk.byteLength - count;
    return count;
  };
  return { counted, used: () => used };
}

test("standalone counted writes preserve validated successful partial counts", async () => {
  const context = { signal: new AbortController().signal };
  assert.equal(await writeFileOutputCounted(context, Uint8Array.of(1, 2, 3), async () => 2), 2);
  assert.equal(await writeFileOutputCounted(context, new Uint8Array(), async () => 0), 0);
});

test("sink enrollment without counted enrollment refuses before invoking a writer", async () => {
  const context = owner();
  bindFileOutputBudget(context, sink => sink);
  let calls = 0;
  await assert.rejects(writeFileOutputCounted(context, Uint8Array.of(1), async () => { calls++; return 1; }), { code: "ENOTSUP" });
  assert.equal(calls, 0);
});

test("counted bindings follow cleanup ownership across copied contexts and isolate other owners", async () => {
  const context = owner();
  const budget = ledger(4);
  bindFileOutputBudget(context, sink => sink, budget.counted);
  assert.equal(await writeFileOutputCounted({ ...context }, new Uint8Array(4), async () => 2), 2);
  assert.equal(budget.used(), 2);
  assert.equal(await writeFileOutputCounted(context, new Uint8Array(2), async () => 2), 2);
  await assert.rejects(writeFileOutputCounted(context, new Uint8Array(1), async () => 1), /test output limit/);
  assert.equal(await writeFileOutputCounted(owner(), new Uint8Array(5), async () => 5), 5);
});

for (const count of [-1, 1.5, NaN, Infinity, 4]) {
  test(`invalid successful count ${count} retains the full reservation`, async () => {
    const context = owner();
    const budget = ledger(3);
    bindFileOutputBudget(context, sink => sink, budget.counted);
    await assert.rejects(writeFileOutputCounted(context, new Uint8Array(3), async () => count), { code: "EIO" });
    assert.equal(budget.used(), 3);
  });
}

for (const reason of [undefined, null, false, 0, ""]) {
  test(`writer failure ${String(reason)} preserves identity and conservative charge`, async () => {
    const context = owner();
    const budget = ledger(3);
    bindFileOutputBudget(context, sink => sink, budget.counted);
    await assert.rejects(writeFileOutputCounted(context, new Uint8Array(3), async () => { throw reason; }), error => error === reason);
    assert.equal(budget.used(), 3);
  });
}

test("root cancellation during a successful partial write prevents a refund", async () => {
  const context = owner();
  const budget = ledger(3);
  bindFileOutputBudget(context, sink => sink, budget.counted);
  await assert.rejects(writeFileOutputCounted(context, new Uint8Array(3), async () => {
    context.controller.abort(false);
    return 1;
  }), error => error === false);
  assert.equal(budget.used(), 3);
});

test("owned acquisition registers cleanup before open and retains identity across pathname replacement", async () => {
  const context = owner();
  const originalOpen = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => {
    assert.equal(context.cleanups.length, 1);
    return originalOpen(...args);
  };
  const fd = await openCommandFile(context, "/file", { access: "readwrite", creation: "exclusive" });
  await fd.write(Uint8Array.of(1, 2, 3), null);
  const inode = (await fd.stat()).ino;
  await context.fs.rename("/file", "/old");
  await context.fs.rm("/old");
  await context.fs.writeFile("/file", Uint8Array.of(9));
  await fd.write(Uint8Array.of(4), 0);
  assert.equal((await fd.stat()).ino, inode);
  assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(9));
  const closing = fd.close();
  assert.equal(fd.close(), closing);
  await closing;
  await context.cleanups[0]!();
  await assert.rejects(fd.stat(), { code: "EBADF" });
});

test("missing counted enrollment blocks writable acquisition before truncation", async () => {
  const context = owner();
  await context.fs.writeFile("/file", Uint8Array.of(7));
  bindFileOutputBudget(context, sink => sink);
  await assert.rejects(openCommandFile(context, "/file", { access: "write", truncate: true }), { code: "ENOTSUP" });
  assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(7));
});

test("descriptor writes use counted admission once and retain partial counts", async () => {
  const context = owner();
  const budget = ledger(3);
  bindFileOutputBudget(context, sink => sink, budget.counted);
  const originalOpen = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => {
    const fd = await originalOpen(...args);
    const write = fd.write.bind(fd);
    fd.write = (chunk, position, options) => write(chunk.subarray(0, 1), position, options);
    return fd;
  };
  const fd = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  for (let left = 3; left > 0; left--) assert.equal(await fd.write(new Uint8Array(left).fill(left), null), 1);
  assert.equal(budget.used(), 3);
  await assert.rejects(fd.write(Uint8Array.of(4), null), /test output limit/);
  await fd.close();
  assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(3, 2, 1));
});

test("late acquisition joins close before rejecting root cancellation, despite close failure", async () => {
  const context = owner();
  const opened = deferred<FileDescriptor>();
  const started = deferred();
  const entered = deferred();
  const release = deferred();
  const original = await context.fs.open!("/file", { access: "write", creation: "exclusive" });
  const originalClose = original.close.bind(original);
  let closed = 0;
  original.close = async () => { closed++; entered.resolve(); await release.promise; await originalClose(); throw 0; };
  context.fs.open = async () => { started.resolve(); return opened.promise; };
  const opening = openCommandFile(context, "/file", { access: "write" });
  let settled = false;
  void opening.then(() => { settled = true; }, () => { settled = true; });
  await started.promise;
  context.controller.abort(false);
  opened.resolve(original);
  await entered.promise;
  assert.equal(settled, false);
  release.resolve();
  await assert.rejects(opening, error => error === false);
  assert.equal(closed, 1);
});

test("close blocks new work and waits for admitted cooperative writes without premature buffer release", async () => {
  const context = owner();
  const entered = deferred();
  const release = deferred();
  const originalOpen = context.fs.open!.bind(context.fs);
  let closed = 0;
  context.fs.open = async (...args) => {
    const fd = await originalOpen(...args);
    const write = fd.write.bind(fd), close = fd.close.bind(fd);
    fd.write = async (...args) => { entered.resolve(); await release.promise; return write(...args); };
    fd.close = async () => { closed++; await close(); };
    return fd;
  };
  const fd = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  const writing = fd.write(Uint8Array.of(1), null);
  await entered.promise;
  const closing = fd.close();
  await assert.rejects(fd.write(Uint8Array.of(2), null), { code: "EBADF" });
  assert.equal(closed, 0);
  release.resolve();
  assert.equal(await writing, 1);
  await closing;
  assert.equal(closed, 1);
});

test("an unsupported provider is refused rather than emulated through path writes", async () => {
  const context = owner();
  const fs: FileSystem = { ...context.fs, capabilities: { ...context.fs.capabilities, open: false } } as FileSystem;
  fs.open = async () => { throw new Error("must not open"); };
  await assert.rejects(openCommandFile({ ...context, fs }, "/file", { access: "read" }), error => error instanceof FsError && error.code === "ENOTSUP");
});
