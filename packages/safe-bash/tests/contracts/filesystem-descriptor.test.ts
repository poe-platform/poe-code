import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, FsError, type FileDescriptor, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { bindFileOutputBudget, writeFileOutputCounted, type CountedFileWrite } from "../../src/contracts/filesystem-output.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";

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

function rejectingClose(reason: unknown, ready: Promise<void> = Promise.resolve()) {
  const context = owner();
  const open = context.fs.open!.bind(context.fs);
  let closes = 0;
  context.fs.open = async (...args) => {
    const descriptor = await open(...args);
    const close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { closes++; await ready; await close(); throw reason; };
    return descriptor;
  };
  return { ...context, closes: () => closes };
}

for (const reason of [undefined, null, false, 0, -0, "", NaN, new FsError("EIO")]) {
  test(`acknowledged close retains exact rejection and repeated close: ${Object.is(reason, -0) ? "-0" : String(reason)}`, async () => {
    const context = rejectingClose(reason);
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
    try {
      assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
      const closing = descriptor.close();
      await assert.rejects(closing, error => Object.is(error, reason));
      const wrong = Object.is(reason, 0) ? -0 : Object.is(reason, -0) ? 0 : new FsError("EIO");
      assert.equal(descriptor.acknowledgeCloseFailure(wrong), false);
      await assert.rejects(Promise.resolve().then(() => context.cleanups[0]!()), error => Object.is(error, reason));
      assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
      assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
      assert.equal(descriptor.acknowledgeCloseFailure(wrong), false);
      await context.cleanups[0]!();
      await context.cleanups[0]!();
      assert.equal(descriptor.close(), closing);
      await assert.rejects(descriptor.close(), error => Object.is(error, reason));
      assert.equal(context.closes(), 1);
      await assert.rejects(descriptor.write(Uint8Array.of(1), null), { code: "EBADF" });
    } finally { await descriptor.close().catch(() => {}); }
  });
}

test("close acknowledgement refuses premature matching reasons and still drains admitted writes", async () => {
  const writeEntered = deferred();
  const writeRelease = deferred();
  const closeRelease = deferred();
  const reason = new FsError("EIO");
  const context = rejectingClose(reason, closeRelease.promise);
  const open = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => {
    const descriptor = await open(...args);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = async (...args) => { writeEntered.resolve(); await writeRelease.promise; return write(...args); };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  const writing = descriptor.write(Uint8Array.of(255, 254), null);
  await writeEntered.promise;
  const closing = descriptor.close();
  const rejected = assert.rejects(closing, error => error === reason);
  let cleaned = false;
  const cleanup = Promise.resolve().then(() => context.cleanups[0]!()).then(
    () => { cleaned = true; }, error => { cleaned = true; assert.equal(error, reason); },
  );
  try {
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    assert.equal(context.closes(), 0);
    assert.equal(cleaned, false);
    writeRelease.resolve();
    assert.equal(await writing, 2);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(context.closes(), 1);
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    assert.equal(cleaned, false);
    closeRelease.resolve();
    await rejected;
    await cleanup;
    assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
    await context.cleanups[0]!();
    assert.deepEqual(await context.fs.readFile("/file"), Uint8Array.of(255, 254));
  } finally { writeRelease.resolve(); closeRelease.resolve(); await writing; await rejected; await cleanup; }
});

test("successful close cannot acknowledge a write failure or an unknown reason", async () => {
  const context = owner();
  const reason = new FsError("ENOSPC");
  const open = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => {
    const descriptor = await open(...args);
    descriptor.write = async () => { throw reason; };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  try {
    const writing = descriptor.write(Uint8Array.of(1), null);
    await assert.rejects(writing, error => error === reason);
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    await descriptor.close();
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    assert.equal(descriptor.acknowledgeCloseFailure(undefined), false);
    await context.cleanups[0]!();
    await assert.rejects(writing, error => error === reason);
  } finally { await descriptor.close(); }
});

for (const scope of ["context", "open"] as const) for (const acknowledgeFirst of [false, true]) {
  test(`${scope} cancellation is never acknowledged or suppressed; acknowledged first=${acknowledgeFirst}`, async () => {
    const context = rejectingClose(new FsError("EIO"));
    const local = new AbortController();
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive", signal: local.signal });
    let failure: unknown;
    try { await descriptor.close(); } catch (reason) { failure = reason; }
    try {
      assert.ok(failure instanceof FsError);
      if (acknowledgeFirst) assert.equal(descriptor.acknowledgeCloseFailure(failure), true);
      (scope === "context" ? context.controller : local).abort(false);
      assert.equal(descriptor.acknowledgeCloseFailure(false), false);
      assert.equal(descriptor.acknowledgeCloseFailure(failure), acknowledgeFirst);
      await assert.rejects(Promise.resolve().then(() => context.cleanups[0]!()), reason => reason === false);
      await assert.rejects(descriptor.close(), reason => reason === failure);
    } finally { await descriptor.close().catch(() => {}); }
  });
}

test("cancellation with the identical close reason cannot be newly acknowledged", async () => {
  const context = rejectingClose(false);
  const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  await assert.rejects(descriptor.close(), reason => reason === false);
  context.controller.abort(false);
  assert.equal(descriptor.acknowledgeCloseFailure(false), false);
  await assert.rejects(Promise.resolve().then(() => context.cleanups[0]!()), reason => reason === false);
});

test("Shell recovery runs after an awaited diagnosed close failure is explicitly acknowledged", async context => {
  const fixture = rejectingClose(new FsError("EIO"));
  const shell = new Shell({ fs: fixture.fs });
  context.after(() => shell.dispose());
  shell.register({ name: "copy", async execute(command) {
    const descriptor = await openCommandFile(command, "/output", { access: "write", creation: "exclusive" });
    await descriptor.write(Buffer.from("WXYZ"), null);
    try { await descriptor.close(); }
    catch (reason) {
      await command.stderr.write(Buffer.from("copy: closing output file '/output': Input/output error\n"));
      assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
      return { exitCode: 1 };
    }
    throw new Error("expected close failure");
  } });
  shell.register({ name: "recover", async execute(command) {
    await command.stdout.write(await command.fs.readFile("/output"));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("copy || recover");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "WXYZ");
  assert.equal(result.stderr, "copy: closing output file '/output': Input/output error\n");
  assert.equal(fixture.closes(), 1);
});

test("acknowledging a close failure never consumes an escaping writer failure with identical identity", async context => {
  const reason = new ShellLimitError("maxOutputBytes");
  const fixture = rejectingClose(reason);
  const open = fixture.fs.open!.bind(fixture.fs);
  fixture.fs.open = async (...args) => {
    const descriptor = await open(...args);
    descriptor.write = async () => { throw reason; };
    return descriptor;
  };
  const shell = new Shell({ fs: fixture.fs });
  context.after(() => shell.dispose());
  shell.register({ name: "copy", async execute(command) {
    const descriptor = await openCommandFile(command, "/output", { access: "write", creation: "exclusive" });
    try { await descriptor.write(Uint8Array.of(1), null); }
    finally {
      try { await descriptor.close(); }
      catch (failure) { assert.equal(descriptor.acknowledgeCloseFailure(failure), true); }
    }
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("copy"), failure => failure === reason);
  assert.equal(fixture.closes(), 1);
});

test("open failures stay primary and do not expose acknowledgement authority", async () => {
  const fixture = owner();
  const reason = new FsError("EIO");
  fixture.fs.open = async () => { throw reason; };
  const opening = openCommandFile(fixture, "/output", { access: "write", creation: "exclusive" });
  await assert.rejects(opening, failure => failure === reason);
  await fixture.cleanups[0]!();
  await assert.rejects(opening, failure => failure === reason);
});

test("acknowledgement cannot suppress an unrelated failure from the close drain", async context => {
  const closeReason = new FsError("EIO");
  const drainReason = new Error("listener release failure");
  const fixture = rejectingClose(closeReason);
  const descriptor = await openCommandFile(fixture, "/file", { access: "write", creation: "exclusive" });
  const remove = context.mock.method(fixture.signal, "removeEventListener", () => { throw drainReason; });
  try {
    const closing = descriptor.close();
    await assert.rejects(closing, reason => reason === drainReason);
    assert.equal(descriptor.acknowledgeCloseFailure(drainReason), false);
    assert.equal(descriptor.acknowledgeCloseFailure(closeReason), true);
    await assert.rejects(Promise.resolve().then(() => fixture.cleanups[0]!()), reason => reason === drainReason);
    assert.equal(descriptor.close(), closing);
    assert.equal(fixture.closes(), 1);
  } finally { remove.mock.restore(); fixture.controller.abort(false); await descriptor.close().catch(() => {}); }
});

test("actual Shell root cancellation still wins after explicit close acknowledgement", async context => {
  const controller = new AbortController();
  const fixture = rejectingClose(new FsError("EIO"));
  const shell = new Shell({ fs: fixture.fs });
  context.after(() => shell.dispose());
  let recovered = false;
  shell.register({ name: "copy", async execute(command) {
    const descriptor = await openCommandFile(command, "/output", { access: "write", creation: "exclusive" });
    await descriptor.write(Uint8Array.of(255), null);
    try { await descriptor.close(); }
    catch (reason) { assert.equal(descriptor.acknowledgeCloseFailure(reason), true); }
    controller.abort(false);
    return { exitCode: 1 };
  } });
  shell.register({ name: "recover", execute() { recovered = true; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec("copy || recover", { signal: controller.signal }), reason => reason === false);
  assert.equal(recovered, false);
  assert.equal(fixture.closes(), 1);
  assert.deepEqual(await fixture.fs.readFile("/output"), Uint8Array.of(255));
});

test("an unrelated close-drain failure cannot be suppressed even when it aliases the retained close reason", async context => {
  const reason = new FsError("EIO");
  const fixture = rejectingClose(reason);
  const descriptor = await openCommandFile(fixture, "/file", { access: "write", creation: "exclusive" });
  const remove = context.mock.method(fixture.signal, "removeEventListener", () => { throw reason; });
  try {
    await assert.rejects(descriptor.close(), failure => failure === reason);
    assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
    await assert.rejects(Promise.resolve().then(() => fixture.cleanups[0]!()), failure => failure === reason);
  } finally { remove.mock.restore(); fixture.controller.abort(false); await descriptor.close().catch(() => {}); }
});

function positionOwner(capability: boolean | undefined, query?: (options?: FsOptions) => Promise<number>) {
  const context = owner();
  const events: string[] = [];
  const open = context.fs.open!.bind(context.fs);
  context.fs.open = async (...args) => {
    const descriptor = await open(...args);
    Object.defineProperty(descriptor, "capabilities", { value: { ...descriptor.capabilities, position: capability } });
    Object.defineProperty(descriptor, "getPosition", { value: query });
    const stat = descriptor.stat.bind(descriptor), close = descriptor.close.bind(descriptor);
    descriptor.stat = async options => { events.push("stat"); return stat(options); };
    descriptor.close = async () => { events.push("close"); await close(); };
    return descriptor;
  };
  return { ...context, events };
}

for (const position of [0, 7, Number.MAX_SAFE_INTEGER]) {
  test(`owned position query forwards ${position} without charging bytes or using size`, async () => {
    let queried = 0;
    const context = positionOwner(true, async options => {
      assert.equal(options?.signal?.aborted, false);
      queried++;
      return position;
    });
    await context.fs.writeFile("/file", Uint8Array.of(1));
    bindFileOutputBudget(context, () => { throw new Error("position query must not wrap output"); });
    const descriptor = await openCommandFile(context, "/file", { access: "read" });
    try {
      assert.equal(descriptor.capabilities.position, true);
      assert.equal(await descriptor.getPosition!(), position);
      assert.equal(queried, 1);
      assert.deepEqual(context.events, []);
    } finally { await descriptor.close(); }
  });
}

for (const [capability, method] of [[undefined, false], [undefined, true], [false, true], [true, false]] as const) {
  test(`owned position query requires affirmative capability and method: ${String(capability)}/${method}`, async () => {
    let queried = 0;
    const context = positionOwner(capability, method ? async () => { queried++; return 0; } : undefined);
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
    try {
      assert.equal(descriptor.getPosition, undefined);
      assert.notEqual(descriptor.capabilities.position, true);
      assert.equal(queried, 0);
    } finally { await descriptor.close(); }
  });
}

for (const position of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`owned position query rejects invalid result ${String(position)}`, async () => {
    const context = positionOwner(true, async () => position);
    const budget = ledger(0);
    bindFileOutputBudget(context, sink => sink, budget.counted);
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
    try {
      await assert.rejects(async () => descriptor.getPosition!(), { code: "EIO", syscall: "getPosition", path: "/file" });
      assert.equal(budget.used(), 0);
    } finally { await descriptor.close(); }
  });
}

for (const reason of [undefined, false, 0]) {
  test(`owned position query preserves falsey provider failure ${String(reason)}`, async () => {
    const context = positionOwner(true, async () => { throw reason; });
    const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
    try { await assert.rejects(async () => descriptor.getPosition!(), error => error === reason); }
    finally { await descriptor.close(); }
  });
}

test("owned position query serializes with descriptor work and close drains its admitted query", async () => {
  const started = deferred(), release = deferred<number>();
  const context = positionOwner(true, async () => { context.events.push("query"); started.resolve(); return release.promise; });
  const descriptor = await openCommandFile(context, "/file", { access: "write", creation: "exclusive" });
  try {
    const query = descriptor.getPosition!();
    await started.promise;
    const stat = descriptor.stat();
    const closing = descriptor.close();
    await assert.rejects(async () => descriptor.getPosition!(), { code: "EBADF", syscall: "getPosition", path: "/file" });
    assert.deepEqual(context.events, ["query"]);
    release.resolve(7);
    assert.equal(await query, 7);
    await stat;
    await closing;
    assert.deepEqual(context.events, ["query", "stat", "close"]);
  } finally { release.resolve(7); await descriptor.close(); }
});

for (const source of ["root", "open", "query"] as const) {
  test(`owned position query observes ${source} cancellation and drains before close`, async () => {
    const started = deferred(), release = deferred<number>();
    const controller = new AbortController();
    let forwarded: AbortSignal | undefined;
    const context = positionOwner(true, async options => {
      forwarded = options?.signal;
      started.resolve();
      return release.promise;
    });
    const descriptor = await openCommandFile(context, "/file", {
      access: "write", creation: "exclusive", ...(source === "open" ? { signal: controller.signal } : {}),
    });
    try {
      const query = descriptor.getPosition!(source === "query" ? { signal: controller.signal } : {});
      const rejected = assert.rejects(query, reason => reason === false);
      await started.promise;
      (source === "root" ? context.controller : controller).abort(false);
      const closing = descriptor.close();
      assert.equal(forwarded?.aborted, true);
      assert.equal(forwarded?.reason, false);
      assert.deepEqual(context.events, []);
      release.resolve(9);
      await rejected;
      await closing;
      assert.deepEqual(context.events, ["close"]);
    } finally { release.resolve(9); await descriptor.close(); }
  });
}
