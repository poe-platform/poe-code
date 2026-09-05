import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import type { CommandFileDescriptor } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function override<Value extends object>(target: Value, overrides: Partial<Value>): Value {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const member: unknown = Reflect.get(object, key, object);
    return typeof member === "function" ? member.bind(object) : member;
  } });
}

function owner(fs: FileSystem = createMemoryFileSystem()) {
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  return { fs, controller, signal: controller.signal, cleanups,
    registerCleanup: (cleanup: InvocationCleanup) => { cleanups.push(cleanup); },
    async drain() { return Promise.allSettled(cleanups.map(async cleanup => cleanup())); },
  };
}

const forwardedOperations: { name: string; invoke(descriptor: CommandFileDescriptor, options: FsOptions): Promise<unknown> }[] = [
  { name: "stat", invoke: (descriptor, options) => descriptor.stat(options) },
  { name: "read", invoke: (descriptor, options) => descriptor.read(new Uint8Array(1), null, options) },
  { name: "write", invoke: (descriptor, options) => descriptor.write(Uint8Array.of(1), null, options) },
  { name: "truncate", invoke: (descriptor, options) => descriptor.truncate(0, options) },
  { name: "sync", invoke: (descriptor, options) => descriptor.sync(false, options) },
  { name: "data sync", invoke: (descriptor, options) => descriptor.sync(true, options) },
  { name: "position", invoke: (descriptor, options) => descriptor.getPosition!(options) },
];

for (const operation of forwardedOperations) test(`exposed ${operation.name} captures operation signal once and keeps root cancellation first`, async () => {
  const context = owner();
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const controller = new AbortController();
  controller.abort(0);
  let reads = 0;
  const options = { get signal() { reads++; return controller.signal; } };
  await assert.rejects(operation.invoke(target.descriptor!, options), error => error === 0);
  assert.equal(reads, 1);
  await target.finish();
  await assert.rejects(operation.invoke(target.descriptor!, options), error => error === 0);
  assert.equal(reads, 2);
  context.controller.abort(false);
  await assert.rejects(operation.invoke(target.descriptor!, options), error => error === false);
  assert.equal(reads, 3);
  await context.drain();
});

for (const operation of forwardedOperations) test(`exposed ${operation.name} checks its owner signal before the operation signal`, async () => {
  const context = owner();
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await target.abort(undefined);
  assert.equal(target.signal.aborted, true);
  const controller = new AbortController();
  controller.abort(false);
  await assert.rejects(operation.invoke(target.descriptor!, { signal: controller.signal }), error => error === target.signal.reason);
  await assert.rejects(target.finish(), error => error === undefined);
  await context.drain();
});

test("an admitted descriptor stat reads the caller's signal getter only once", async () => {
  const context = owner();
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const controller = new AbortController();
  let reads = 0;
  const options = { get signal() { reads++; return controller.signal; } };
  const stat = await target.descriptor!.stat(options);
  assert.equal(stat.size, 0);
  assert.equal(reads, 1);
  await target.finish();
  await context.drain();
});

test("queued operation cancellation does not cancel the retained sink drain", async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let stats = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write(bytes, position, forwarded) {
        entered.resolve(); await release.promise;
        return descriptor.write(bytes.subarray(0, 1), position, forwarded);
      },
      async stat(forwarded) { stats++; return descriptor.stat(forwarded); },
    });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const writing = target.sink.write(Uint8Array.of(1, 2));
  await entered.promise;
  const controller = new AbortController();
  const rejected = assert.rejects(target.descriptor!.stat({ signal: controller.signal }), error => error === null);
  controller.abort(null);
  const finishing = target.finish();
  try {
    release.resolve();
    await Promise.all([writing, rejected, finishing]);
    assert.equal(stats, 0);
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(1, 2));
  } finally {
    release.resolve();
    await Promise.allSettled([writing, rejected, finishing]);
    await context.drain();
  }
});

test("descriptor output retains the renamed inode and exposes that same guarded open", async () => {
  const context = owner();
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  assert.ok(target.descriptor);
  const original = await target.descriptor.stat();
  assert.notEqual(original.ino, undefined);
  await target.sink.write(Uint8Array.of(97));
  await context.fs.rename("/out", "/moved");
  await target.sink.write(Uint8Array.of(98));
  assert.equal((await target.descriptor.stat()).ino, original.ino);
  assert.equal((await target.descriptor.stat()).size, 2);
  await assert.rejects(target.descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
  await target.finish();
  assert.deepEqual(await context.fs.readFile("/moved"), Uint8Array.of(97, 98));
  await assert.rejects(context.fs.stat("/out"), { code: "ENOENT" });
  await assert.rejects(target.descriptor.stat(), { code: "EBADF" });
  await assert.rejects(target.sink.write(Uint8Array.of(99)), { code: "EBADF" });
  assert.deepEqual((await context.drain()).map(result => result.status), ["fulfilled"]);
});

test("unlinked retained output never writes a recreated pathname", async () => {
  const context = owner();
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await target.sink.write(Uint8Array.of(1));
  await context.fs.rm("/out");
  await context.fs.writeFile("/out", Uint8Array.of(9));
  await target.sink.write(Uint8Array.of(2));
  assert.equal((await target.descriptor!.stat()).size, 2);
  await target.finish();
  assert.deepEqual(await context.fs.readFile("/out"), Uint8Array.of(9));
  await context.drain();
});

for (const flag of ["w", "a", "wx"] as const) test(`descriptor output forwards ${flag} and creation mode without legacy mutation`, async () => {
  const backing = createMemoryFileSystem();
  if (flag !== "wx") await backing.writeFile("/out", Uint8Array.of(1));
  let opens = 0;
  const fs = override(backing, {
    async open(path, options) {
      opens++;
      assert.equal(options.access, "write");
      assert.equal(options.creation, flag === "wx" ? "exclusive" : "ifMissing");
      assert.equal(options.append, flag === "a");
      assert.equal(options.truncate, flag === "w");
      assert.equal(options.mode, 0o640);
      return backing.open!(path, options);
    },
    async writeStream() { assert.fail("legacy stream"); },
    async writeFile() { assert.fail("legacy pathname write"); },
    async appendFile() { assert.fail("legacy pathname append"); },
  });
  const context = owner(fs);
  const target = await openFileOutput(context, "/out", { flag, mode: 0o640, descriptor: true }, async () => { assert.fail("legacy callback"); });
  await target.sink.write(Uint8Array.of(2));
  await target.finish();
  assert.equal(opens, 1);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.from(flag === "a" ? [1, 2] : [2]));
  if (flag === "wx") assert.equal((await backing.stat("/out")).mode & 0o777, 0o640);
  await context.drain();
});

test("exclusive descriptor output refuses an existing file without changing its bytes", async () => {
  const context = owner();
  await context.fs.writeFile("/out", Uint8Array.of(8));
  await assert.rejects(openFileOutput(context, "/out", { flag: "wx", descriptor: true }), { code: "EEXIST" });
  assert.deepEqual(await context.fs.readFile("/out"), Uint8Array.of(8));
  await context.drain();
});

test("descriptor output rejects an invalid flag before opening or mutating", async () => {
  const context = owner();
  await assert.rejects(openFileOutput(context, "/out", { flag: "invalid" as "w", descriptor: true }), TypeError);
  await assert.rejects(context.fs.stat("/out"), { code: "ENOENT" });
  await context.drain();
});

test("append follows retained EOF after rename and another append", async () => {
  const context = owner();
  await context.fs.writeFile("/out", Uint8Array.of(1));
  const target = await openFileOutput(context, "/out", { flag: "a", descriptor: true });
  await context.fs.rename("/out", "/moved");
  await target.sink.write(Uint8Array.of(2));
  await context.fs.appendFile("/moved", Uint8Array.of(3));
  await target.sink.write(Uint8Array.of(4));
  await target.finish();
  assert.deepEqual(await context.fs.readFile("/moved"), Uint8Array.of(1, 2, 3, 4));
  await assert.rejects(context.fs.stat("/out"), { code: "ENOENT" });
  await context.drain();
});

test("descriptor payload forwarding is bounded to 64 KiB and preserves byte boundaries", async () => {
  const backing = createMemoryFileSystem();
  const lengths: number[] = [];
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(bytes, position, forwarded) {
      lengths.push(bytes.length);
      return descriptor.write(bytes, position, forwarded);
    } });
  } }));
  const bytes = Uint8Array.from({ length: 131073 }, (_, index) => index % 256);
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await target.sink.write(bytes);
  await target.finish();
  assert.deepEqual(lengths, [65536, 65536, 1]);
  assert.deepEqual(await backing.readFile("/out"), bytes);
  await context.drain();
});

test("sink-only budget enrollment refuses canonical writes before file creation", async () => {
  const context = owner();
  bindFileOutputBudget(context, sink => sink);
  await assert.rejects(openFileOutput(context, "/out", { flag: "w", descriptor: true }), { code: "ENOTSUP" });
  await assert.rejects(context.fs.stat("/out"), { code: "ENOENT" });
  await context.drain();
});

test("an unknown partial writer failure retains its entire admitted budget reservation", async () => {
  const backing = createMemoryFileSystem();
  const reason = new Error("unknown partial write");
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(bytes, position, forwarded) {
      await descriptor.write(bytes.subarray(0, 1), position, forwarded);
      throw reason;
    } });
  } }));
  let charged = 0;
  bindFileOutputBudget(context, () => { assert.fail("sink budget"); }, async (bytes, write) => {
    charged += bytes.length;
    const count = await write();
    charged -= bytes.length - count;
    return count;
  });
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.sink.write(Uint8Array.of(1, 2, 3)), error => error === reason);
  await assert.rejects(target.finish(), error => error === reason);
  assert.equal(charged, 3);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(1));
  await context.drain();
});

for (const fixture of [
  { capabilities: { readOnly: true }, flag: "w", code: "EROFS" },
  { capabilities: { open: false }, flag: "w", code: "ENOTSUP" },
  { capabilities: { write: false }, flag: "w", code: "ENOTSUP" },
  { capabilities: { append: false }, flag: "a", code: "ENOTSUP" },
  { capabilities: { exclusiveCreate: false }, flag: "wx", code: "ENOTSUP" },
] as const) test(`descriptor capability refusal: ${JSON.stringify(fixture.capabilities)}`, async () => {
  const backing = createMemoryFileSystem();
  let attempts = 0;
  const context = owner(override<FileSystem>(backing, { capabilities: { ...backing.capabilities, ...fixture.capabilities },
    async open() { attempts++; assert.fail("refused open"); },
    async writeStream() { attempts++; assert.fail("refused stream"); },
    async writeFile() { attempts++; assert.fail("refused mutation"); },
  }));
  await assert.rejects(openFileOutput(context, "/out", { flag: fixture.flag, descriptor: true }), { code: fixture.code });
  assert.equal(attempts, 0);
  await context.drain();
});

test("descriptor request never falls back after canonical ENOTSUP", async () => {
  const backing = createMemoryFileSystem();
  const failure = new FsError("ENOTSUP");
  const context = owner(override(backing, {
    async open() { throw failure; },
    async writeStream() { assert.fail("fallback"); },
  }));
  await assert.rejects(openFileOutput(context, "/out", { flag: "w", descriptor: true }), error => error === failure);
  await context.drain();
});

for (const descriptor of [undefined, false]) test(`legacy streaming remains first with descriptor=${descriptor}`, async () => {
  const backing = createMemoryFileSystem();
  let streams = 0;
  const context = owner(override(backing, {
    async open() { assert.fail("canonical open must not be selected"); },
    async writeStream(path, source, options) { streams++; await backing.writeStream!(path, source, options); },
  }));
  const target = await openFileOutput(context, "/out", { flag: "w", ...(descriptor === undefined ? {} : { descriptor }) });
  assert.equal(target.descriptor, undefined);
  await target.sink.write(Uint8Array.of(1));
  await target.finish();
  assert.equal(streams, 1);
  await context.drain();
});

test("partial descriptor counts drain in order and charge only counted output", async () => {
  const backing = createMemoryFileSystem();
  let calls = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(bytes, position, forwarded) {
      calls++;
      assert.equal(position, null);
      return descriptor.write(bytes.subarray(0, 2), position, forwarded);
    } });
  } }));
  let charged = 0;
  bindFileOutputBudget(context, () => { assert.fail("sink double charge"); }, async (chunk, write) => {
    charged += chunk.length;
    const count = await write();
    charged -= chunk.length - count;
    return count;
  });
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await target.sink.write(Uint8Array.of(0, 255, 1, 128, 2));
  await target.finish();
  assert.equal(calls, 3);
  assert.equal(charged, 5);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(0, 255, 1, 128, 2));
  await context.drain();
});

for (const count of [0, -1, 1.5, NaN, Infinity, 4]) test(`descriptor output refuses nonprogress or invalid count ${count}`, async () => {
  const backing = createMemoryFileSystem();
  let writes = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write() { writes++; return count; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  let failure: unknown;
  await assert.rejects(target.sink.write(Uint8Array.of(1, 2, 3)), error => { failure = error; return error instanceof FsError && error.code === "EIO"; });
  await assert.rejects(target.finish(), error => error === failure);
  assert.equal(writes, 1);
  await target.abort(failure);
  await context.drain();
});

for (const cancel of [false, true]) test(`cleanup is enrolled before acquisition and joins the late descriptor, cancellation=${cancel}`, async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let closes = 0;
  const context = owner(override(backing, { async open(path, options) {
    assert.ok(context.cleanups.length > 0);
    const descriptor = await backing.open!(path, options);
    entered.resolve();
    await release.promise;
    return override(descriptor, { async close() { closes++; await descriptor.close(); } });
  } }));
  const opening = openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const rejected = assert.rejects(opening, error => cancel ? error === false : error instanceof FsError && error.code === "EBADF");
  await entered.promise;
  if (cancel) context.controller.abort(false);
  let drained = false;
  const cleanup = context.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  release.resolve();
  await Promise.all([rejected, cleanup]);
  assert.equal(closes, 1);
});

test("finish drains admitted partial writes, rejects later admission, and closes exactly once", async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let closes = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write(bytes, position, forwarded) {
      entered.resolve(); await release.promise;
      return descriptor.write(bytes.subarray(0, 1), position, forwarded);
    }, async close() { closes++; await descriptor.close(); } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const writing = target.sink.write(Uint8Array.of(1, 2));
  await entered.promise;
  const finishing = target.finish();
  assert.equal(target.finish(), finishing);
  await assert.rejects(target.sink.write(Uint8Array.of(3)), { code: "EBADF" });
  assert.equal(closes, 0);
  release.resolve();
  await Promise.all([writing, finishing]);
  await context.drain();
  assert.equal(closes, 1);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(1, 2));
});

for (const closing of ["finish", "cleanup", "descriptor close"] as const) test(`captured descriptor methods close admission with ${closing} and preserve the admitted sink drain`, async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let closes = 0;
  let positions = 0;
  let syncs = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async write(bytes, position, forwarded) {
        entered.resolve(); await release.promise;
        return descriptor.write(bytes.subarray(0, 1), position, forwarded);
      },
      async getPosition(forwarded) { positions++; return descriptor.getPosition!(forwarded); },
      async sync(dataOnly, forwarded) { syncs++; await descriptor.sync(dataOnly, forwarded); },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const descriptor = target.descriptor!;
  const position = descriptor.getPosition!.bind(descriptor);
  const sync = descriptor.sync.bind(descriptor);
  const writing = target.sink.write(Uint8Array.of(1, 2));
  await entered.promise;
  const retirement = closing === "finish" ? target.finish() : closing === "cleanup" ? Promise.resolve(context.cleanups[0]!()) : descriptor.close();
  const late = Promise.all([
    assert.rejects(position(), { code: "EBADF" }),
    assert.rejects(sync(false), { code: "EBADF" }),
    assert.rejects(target.sink.write(Uint8Array.of(3)), { code: "EBADF" }),
  ]);
  void late.catch(() => {});
  try {
    assert.equal(closes, 0);
    release.resolve();
    await Promise.all([writing, retirement, late]);
    assert.equal(positions, 0);
    assert.equal(syncs, 0);
    assert.equal(closes, 1);
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(1, 2));
    assert.equal(descriptor.close(), descriptor.close());
    await descriptor.close();
  } finally {
    release.resolve();
    await Promise.allSettled([writing, retirement, late]);
    await context.drain();
  }
});

for (const reason of [undefined, false, 0, "", null]) test(`write failure ${String(reason)} wins over later close failure`, async () => {
  const backing = createMemoryFileSystem();
  const closeFailure = new Error("secondary close");
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write() { throw reason; }, async close() { await descriptor.close(); throw closeFailure; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.sink.write(Uint8Array.of(1)), error => Object.is(error, reason));
  await assert.rejects(target.finish(), error => Object.is(error, reason));
  const results = await context.drain();
  assert.ok(results.every(result => result.status === "fulfilled" || Object.is(result.reason, reason)));
});

test("explicit finish keeps close rejection while acknowledged registered cleanup permits recovery", async () => {
  const backing = createMemoryFileSystem();
  const reason = false;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw reason; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.finish(), error => error === reason);
  assert.equal(target.descriptor!.acknowledgeCloseFailure(reason), true);
  await assert.rejects(target.descriptor!.close(), error => error === reason);
  await assert.rejects(target.finish(), error => error === reason);
  assert.ok((await context.drain()).every(result => result.status === "fulfilled"));
});

for (const reason of [false, NaN]) test(`unacknowledged close failure ${String(reason)} is retained by registered cleanup`, async () => {
  const backing = createMemoryFileSystem();
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw reason; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.finish(), error => Object.is(error, reason));
  const results = await context.drain();
  assert.equal(results.length, 1);
  assert.equal(results[0]!.status, "rejected");
  assert.ok(results[0]!.status === "rejected" && Object.is(results[0]!.reason, reason));
});

test("abort after failed finish does not implicitly acknowledge its close failure", async () => {
  const backing = createMemoryFileSystem();
  const reason = new Error("unacknowledged close");
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw reason; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.finish(), error => error === reason);
  await assert.rejects(target.abort(new Error("later abort")), error => error === reason);
  const results = await context.drain();
  assert.ok(results.some(result => result.status === "rejected" && result.reason === reason));
});

test("root cancellation still wins after a close failure was explicitly acknowledged", async () => {
  const backing = createMemoryFileSystem();
  const reason = new Error("acknowledged close");
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async close() { await descriptor.close(); throw reason; } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  await assert.rejects(target.finish(), error => error === reason);
  assert.equal(target.descriptor!.acknowledgeCloseFailure(reason), true);
  context.controller.abort(false);
  const results = await context.drain();
  assert.ok(results.some(result => result.status === "rejected" && result.reason === false));
});

for (const reason of [undefined, false, 0, "", null]) test(`explicit abort ${String(reason)} joins cooperative work before closing`, async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let closes = 0;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write() { entered.resolve(); await release.promise; return 1; },
      async close() { closes++; await descriptor.close(); } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const rejected = assert.rejects(target.sink.write(Uint8Array.of(1)), error => Object.is(error, reason));
  await entered.promise;
  let aborted = false;
  const aborting = target.abort(reason).then(() => { aborted = true; });
  await Promise.resolve();
  assert.equal(aborted, false);
  assert.equal(closes, 0);
  release.resolve();
  await Promise.all([aborting, rejected]);
  assert.equal(closes, 1);
  await assert.rejects(target.finish(), error => Object.is(error, reason));
  await context.drain();
});

for (const reason of [false, 0, "", null]) test(`root cancellation ${String(reason)} drains an admitted write and takes precedence`, async () => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), release = deferred();
  let closed = false;
  const context = owner(override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async write() { entered.resolve(); await release.promise; throw new Error("late writer"); },
      async close() { await descriptor.close(); closed = true; throw new Error("late close"); } });
  } }));
  const target = await openFileOutput(context, "/out", { flag: "w", descriptor: true });
  const writing = target.sink.write(Uint8Array.of(1));
  const rejected = assert.rejects(writing, error => Object.is(error, reason));
  await entered.promise;
  context.controller.abort(reason);
  const finishing = assert.rejects(target.finish(), error => Object.is(error, reason));
  assert.equal(closed, false);
  release.resolve();
  await Promise.all([rejected, finishing]);
  assert.equal(closed, true);
  await context.drain();
});
