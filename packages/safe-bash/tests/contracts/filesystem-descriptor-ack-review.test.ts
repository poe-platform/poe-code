import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError } from "poe-code/safe-fs";
import { commandRuntimeIdentity, type InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function owner() {
  const fs = createMemoryFileSystem(), controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  return { fs, controller, signal: controller.signal, cleanups,
    registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); } };
}

for (const fixture of [
  { name: "Error identity", reason: new FsError("EIO"), wrong: new FsError("EIO") },
  { name: "false", reason: false, wrong: 0 },
  { name: "undefined", reason: undefined, wrong: null },
  { name: "null", reason: null, wrong: undefined },
  { name: "empty string", reason: "", wrong: false },
  { name: "positive zero", reason: 0, wrong: -0 },
  { name: "negative zero", reason: -0, wrong: 0 },
  { name: "NaN", reason: NaN, wrong: undefined },
]) {
  test(`ack review: only the settled exact close reason is acknowledged: ${fixture.name}`, async () => {
    const context = owner(), open = context.fs.open.bind(context.fs);
    let closes = 0;
    context.fs.open = async (...args) => {
      const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
      descriptor.close = async () => { closes++; await close(); throw fixture.reason; };
      return descriptor;
    };
    const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
    assert.equal(descriptor.acknowledgeCloseFailure(fixture.reason), false);
    const closing = descriptor.close();
    assert.equal(descriptor.close(), closing);
    await assert.rejects(closing, error => Object.is(error, fixture.reason));
    assert.equal(descriptor.acknowledgeCloseFailure(fixture.wrong), false);
    assert.equal(context.cleanups.length, 1);
    await assert.rejects(Promise.resolve().then(() => context.cleanups[0]!()), error => Object.is(error, fixture.reason));
    assert.equal(descriptor.acknowledgeCloseFailure(fixture.reason), true);
    assert.equal(descriptor.acknowledgeCloseFailure(fixture.wrong), false);
    await context.cleanups[0]!();
    await context.cleanups[0]!();
    assert.equal(descriptor.close(), closing);
    await assert.rejects(descriptor.close(), error => Object.is(error, fixture.reason));
    await assert.rejects(descriptor.write(Uint8Array.of(1), null), { code: "EBADF" });
    assert.equal(closes, 1);
  });
}

test("ack review: successful close never fabricates an acknowledgeable failure", async () => {
  const context = owner();
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  await descriptor.close();
  for (const reason of [undefined, null, false, 0, NaN, new FsError("EIO")]) assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
  await context.cleanups[0]!();
});

test("ack review: pending close and borrowed writes cannot be acknowledged or released early", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs);
  const entered = deferred(), release = deferred(), reason = new FsError("EIO");
  const content = Uint8Array.of(255, 0, 128);
  let closes = 0, closeSettled = false, cleanupSettled = false;
  context.fs.open = async (...args) => {
    const descriptor = await open(...args), write = descriptor.write.bind(descriptor), close = descriptor.close.bind(descriptor);
    descriptor.write = async (buffer, position, options) => {
      entered.resolve();
      await release.promise;
      assert.equal(buffer, content);
      assert.deepEqual(buffer, Uint8Array.of(255, 0, 128));
      return write(buffer, position, options);
    };
    descriptor.close = async () => { closes++; await close(); throw reason; };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  const writing = descriptor.write(content, null);
  await entered.promise;
  const closing = descriptor.close();
  const checkedClose = assert.rejects(closing, error => error === reason);
  void closing.then(() => { closeSettled = true; }, () => { closeSettled = true; });
  const cleaning = Promise.resolve().then(() => context.cleanups[0]!());
  const checkedCleanup = assert.rejects(cleaning, error => error === reason);
  void cleaning.then(() => { cleanupSettled = true; }, () => { cleanupSettled = true; });
  try {
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closeSettled, false);
    assert.equal(cleanupSettled, false);
    assert.equal(closes, 0);
  } finally { release.resolve(); await Promise.all([writing, checkedClose, checkedCleanup]); }
  assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
  await context.cleanups[0]!();
  assert.equal(closes, 1);
  assert.deepEqual(await context.fs.readFile("/output"), content);
});

test("ack review: matching reason objects do not acknowledge another descriptor", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs), reason = new FsError("EIO");
  context.fs.open = async (...args) => {
    const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { await close(); throw reason; };
    return descriptor;
  };
  const first = await openCommandFile(context, "/first", { access: "write", creation: "exclusive" });
  const second = await openCommandFile(context, "/second", { access: "write", creation: "exclusive" });
  await assert.rejects(first.close(), error => error === reason);
  await assert.rejects(second.close(), error => error === reason);
  assert.equal(first.acknowledgeCloseFailure(reason), true);
  await context.cleanups[0]!();
  await assert.rejects(Promise.resolve().then(() => context.cleanups[1]!()), error => error === reason);
  assert.equal(second.acknowledgeCloseFailure(reason), true);
  await context.cleanups[1]!();
});

test("ack review: acknowledging a close reason never changes a rejected write using that same object", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs), reason = new FsError("EIO");
  context.fs.open = async (...args) => {
    const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
    descriptor.write = async () => { throw reason; };
    descriptor.close = async () => { await close(); throw reason; };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  const writing = descriptor.write(Uint8Array.of(1), null);
  await assert.rejects(writing, error => error === reason);
  assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
  await assert.rejects(descriptor.close(), error => error === reason);
  assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
  await context.cleanups[0]!();
  await assert.rejects(writing, error => error === reason);
  assert.deepEqual(await context.fs.readFile("/output"), new Uint8Array());
});

test("ack review: write failure alone is not a close failure", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs), reason = new FsError("ENOSPC");
  context.fs.open = async (...args) => {
    const descriptor = await open(...args);
    descriptor.write = async () => { throw reason; };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  await assert.rejects(descriptor.write(Uint8Array.of(1), null), error => error === reason);
  await descriptor.close();
  assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
  await context.cleanups[0]!();
});

test("ack review: acknowledging another close cannot mask a subsequent open rejection", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs), reason = new FsError("EACCES");
  context.fs.open = async (...args) => {
    if (args[0] === "/denied") throw reason;
    const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
    descriptor.close = async () => { await close(); throw reason; };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  await assert.rejects(descriptor.close(), error => error === reason);
  assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
  await assert.rejects(openCommandFile(context, "/denied", { access: "read", creation: "never" }), error => error === reason);
  for (const cleanup of context.cleanups) await cleanup();
});

for (const failure of ["cancellation", "budget"] as const) {
  test(`ack review: actual Shell ${failure} still escapes after acknowledging a close failure`, async () => {
    const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
    const closeReason = new FsError("EIO");
    let closes = 0;
    fs.open = async (...args) => {
      const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
      descriptor.close = async () => { closes++; await close(); throw closeReason; };
      return descriptor;
    };
    const shell = new Shell({ fs, limits: { maxOutputBytes: 2 } });
    shell.register({ name: "ack-review", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
      const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
      try {
        if (failure === "cancellation") controller.abort(false);
        else await descriptor.write(Uint8Array.of(1, 2, 3), null);
      } finally {
        try { await descriptor.close(); }
        catch (reason) { descriptor.acknowledgeCloseFailure(reason); }
      }
      return { exitCode: 1 };
    } });
    try {
      await assert.rejects(shell.exec("ack-review", { signal: controller.signal }), error => failure === "cancellation"
        ? error === false : error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      assert.equal(closes, 1);
      assert.deepEqual(await fs.readFile("/output"), new Uint8Array());
    } finally { await shell.dispose(); }
  });
}

test("ack review: pending backend close cannot be acknowledged and registered cleanup joins it", async () => {
  const context = owner(), open = context.fs.open.bind(context.fs);
  const entered = deferred(), release = deferred(), reason = new FsError("EIO");
  let closes = 0, settled = false;
  context.fs.open = async (...args) => {
    const descriptor = await open(...args), close = descriptor.close.bind(descriptor);
    descriptor.close = async () => {
      closes++;
      entered.resolve();
      await release.promise;
      await close();
      throw reason;
    };
    return descriptor;
  };
  const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
  const closing = descriptor.close();
  const checkedClose = assert.rejects(closing, error => error === reason);
  await entered.promise;
  const cleaning = Promise.resolve().then(() => context.cleanups[0]!());
  const checkedCleanup = assert.rejects(cleaning, error => error === reason);
  void cleaning.then(() => { settled = true; }, () => { settled = true; });
  try {
    assert.equal(descriptor.acknowledgeCloseFailure(reason), false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    await assert.rejects(descriptor.stat(), { code: "EBADF" });
    assert.equal(descriptor.close(), closing);
    assert.equal(closes, 1);
  } finally { release.resolve(); await Promise.all([checkedClose, checkedCleanup]); }
  assert.equal(descriptor.acknowledgeCloseFailure(reason), true);
  await context.cleanups[0]!();
  assert.equal(closes, 1);
});

for (const maxOutputBytes of [2, 3]) {
  test(`ack review: Shell recovery retains named-write budget after close acknowledgement; limit=${maxOutputBytes}`, async () => {
    const fs = createMemoryFileSystem(), open = fs.open.bind(fs), reason = new FsError("EIO");
    let closes = 0;
    fs.open = async (...args) => {
      const descriptor = await open(...args);
      if (args[0] === "/output") {
        const close = descriptor.close.bind(descriptor);
        descriptor.close = async () => { closes++; await close(); throw reason; };
      }
      return descriptor;
    };
    const shell = new Shell({ fs, limits: { maxOutputBytes } });
    shell.register({ name: "ack-review", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
      const descriptor = await openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
      try { await descriptor.write(Uint8Array.of(255, 0), null); }
      finally {
        try { await descriptor.close(); }
        catch (error) { assert.equal(descriptor.acknowledgeCloseFailure(error), true); }
      }
      return { exitCode: 1 };
    } });
    shell.register({ name: "recovered", runtimeIdentity: commandRuntimeIdentity, async execute(context) {
      await context.stdout.write(Uint8Array.of(82));
      return { exitCode: 0 };
    } });
    try {
      const execution = shell.exec("ack-review || recovered");
      if (maxOutputBytes === 2) {
        await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      } else {
        const result = await execution;
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "R");
        assert.equal(result.stderr, "");
      }
      assert.equal(closes, 1);
      assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(255, 0));
    } finally { await shell.dispose(); }
  });
}
