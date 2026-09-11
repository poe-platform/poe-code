import assert from "node:assert/strict";
import { test } from "vitest";
import type { FileSystem, FsOptions, RemoveOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { retainFileSystemCleanup, scopeFileSystem, type RetainedFileSystemCleanupView } from "../src/fs/scoped.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function wrapped(filesystem: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(filesystem, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("ordinary scoped deletion cannot clean an owned temporary file after cancellation", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/temporary", new Uint8Array([1]));
  const controller = new AbortController();
  const scoped = scopeFileSystem(memory, () => {}, controller.signal);
  controller.abort(false);
  await assert.rejects(scoped.rm("/temporary"), error => error === false);
  assert.equal((await memory.lstat("/temporary")).type, "file");
});

test("retained cleanup survives parent abort without reopening ordinary scoped operations", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/temporary", new Uint8Array([1]));
  const controller = new AbortController();
  let ordinary = 0;
  let cleanup = 0;
  const scoped = scopeFileSystem(memory, () => { controller.signal.throwIfAborted(); ordinary++; }, controller.signal, () => { cleanup++; });
  const close = retainFileSystemCleanup(scoped, async view => {
    assert.equal((await view.lstat("/temporary")).type, "file");
    assert.equal(await view.realpath("/temporary"), "/temporary");
    await view.rm("/temporary");
  });
  controller.abort(0);
  await assert.rejects(scoped.lstat("/temporary"), error => error === 0);
  await assert.rejects(scoped.rm("/temporary"), error => error === 0);
  await close();
  assert.equal(ordinary, 0);
  assert.equal(cleanup, 3);
  await assert.rejects(memory.lstat("/temporary"), { code: "ENOENT" });
});

for (const reason of [null, false, 0, "", NaN]) test(`retained cleanup cannot be captured after falsey abort ${String(reason)}`, () => {
  const controller = new AbortController();
  const scoped = scopeFileSystem(new MemoryFileSystem(), () => {}, controller.signal);
  controller.abort(reason);
  assert.throws(() => retainFileSystemCleanup(scoped, () => {}), error => Object.is(error, reason));
});

test("retained cleanup has one shared close promise and a frozen minimal view", async () => {
  const memory = new MemoryFileSystem();
  let calls = 0;
  let escaped!: RetainedFileSystemCleanupView;
  const gate = deferred();
  const started = deferred();
  const close = retainFileSystemCleanup(memory, async view => {
    calls++;
    escaped = view;
    assert.ok(Object.isFrozen(view));
    assert.equal(Object.getPrototypeOf(view), null);
    assert.deepEqual(Object.keys(view).sort(), ["lstat", "realpath", "removeFileConditional", "removeStagedFile", "rm", "rmdir"]);
    assert.equal("writeFile" in view, false);
    assert.equal("capabilities" in view, false);
    started.resolve();
    await gate.promise;
  });
  const first = close();
  assert.equal(close(), first);
  await Promise.race([started.promise, first]);
  gate.resolve();
  await first;
  assert.equal(close(), first);
  assert.equal(calls, 1);
  for (const operation of [escaped.lstat, escaped.realpath, escaped.rm, escaped.rmdir!]) await assert.rejects(operation("/"), { code: "EBADF" });
});

test("cleanup rm forces nonrecursive and force false while preserving supplied signal", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/temporary", new Uint8Array([1]));
  const provided = new AbortController().signal;
  const options: FsOptions[] = [];
  const fs = wrapped(memory, {
    async lstat(path, settings) { options.push(settings!); return memory.lstat(path, settings); },
    async realpath(path, settings) { options.push(settings!); return memory.realpath(path, settings); },
    async rm(path, settings) {
      options.push(settings!);
      assert.equal(settings?.recursive, false);
      assert.equal(settings?.force, false);
      return memory.rm(path, settings);
    },
  });
  await retainFileSystemCleanup(fs, async view => {
    await view.lstat("/temporary", { signal: provided });
    await view.realpath("/temporary", { signal: provided });
    await view.rm("/temporary", { signal: provided, recursive: true, force: true } as RemoveOptions);
  })();
  assert.ok(options.every(settings => settings.signal === provided));
});

test("cleanup cannot recursively delete a directory or force away missing-file errors", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/directory");
  await memory.writeFile("/directory/kept", new Uint8Array([1]));
  await assert.rejects(retainFileSystemCleanup(memory, view => view.rm("/directory", { recursive: true, force: true } as RemoveOptions))(), { code: "EISDIR" });
  assert.equal((await memory.lstat("/directory/kept")).type, "file");
  await assert.rejects(retainFileSystemCleanup(memory, view => view.rm("/missing", { force: true } as RemoveOptions))(), { code: "ENOENT" });
});

test("cleanup rmdir is optional and cannot be used to remove nonempty directories", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/empty");
  await retainFileSystemCleanup(memory, view => view.rmdir!("/empty"))();
  await assert.rejects(memory.lstat("/empty"), { code: "ENOENT" });
  await memory.mkdir("/nonempty");
  await memory.writeFile("/nonempty/kept", new Uint8Array([1]));
  await assert.rejects(retainFileSystemCleanup(memory, view => view.rmdir!("/nonempty"))(), { code: "ENOTEMPTY" });
  assert.equal((await memory.lstat("/nonempty/kept")).type, "file");
  const withoutRmdir = wrapped(memory, { rmdir: undefined } as unknown as Partial<FileSystem>);
  await retainFileSystemCleanup(withoutRmdir, view => { assert.equal(Object.hasOwn(view, "rmdir"), false); })();
});

test("cleanup retains readonly and quota wrappers instead of exposing their underlying filesystem", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/temporary", new Uint8Array([1, 2]));
  const controller = new AbortController();
  const readonly = scopeFileSystem(new ReadOnlyFileSystem(memory), () => {}, controller.signal);
  const closeReadonly = retainFileSystemCleanup(readonly, view => view.rm("/temporary"));
  controller.abort(false);
  await assert.rejects(closeReadonly(), { code: "EROFS" });
  assert.equal((await memory.lstat("/temporary")).size, 2);
  const quota = withFileSystemQuota(memory, { maxBytes: 2 });
  let removals = 0;
  const backing = wrapped(quota, { async rm(path, options) { removals++; await quota.rm(path, options); } });
  await retainFileSystemCleanup(backing, view => view.rm("/temporary"))();
  assert.equal(removals, 1);
  await quota.writeFile("/replacement", new Uint8Array([3, 4]));
  await assert.rejects(quota.writeFile("/too-big", new Uint8Array([1])));
});

test("cleanup default charge and latest rescope charge remain attached to the correct backing", async () => {
  const memory = new MemoryFileSystem();
  let first = 0;
  let second = 0;
  let retained = 0;
  const firstController = new AbortController();
  const initial = scopeFileSystem(memory, () => { first++; }, firstController.signal);
  await retainFileSystemCleanup(initial, view => view.lstat("/").then(() => {}))();
  assert.equal(first, 1);
  const secondController = new AbortController();
  const rescoped = scopeFileSystem(initial, () => { second++; }, secondController.signal, () => { retained++; });
  const close = retainFileSystemCleanup(rescoped, view => view.lstat("/").then(() => {}));
  firstController.abort(false);
  await rescoped.lstat("/");
  secondController.abort(0);
  await close();
  assert.deepEqual([first, second, retained], [1, 1, 1]);
});

test("cleanup charges share a finite counter with normal operations and cannot bypass exhaustion", async () => {
  const memory = new MemoryFileSystem();
  let count = 0;
  const reason = new Error("filesystem operation budget exhausted");
  const charge = () => { if (++count > 2) throw reason; };
  const scoped = scopeFileSystem(memory, charge, new AbortController().signal, charge);
  await scoped.lstat("/");
  const close = retainFileSystemCleanup(scoped, async view => { await view.lstat("/"); await view.realpath("/"); });
  await assert.rejects(close(), error => error === reason);
  assert.equal(count, 3);
});

test("cleanup maxOperations bounds admissions, including fire-and-forget calls", async () => {
  let operations = 0;
  const memory = new MemoryFileSystem();
  const backing = wrapped(memory, { async lstat(path, options) { operations++; return memory.lstat(path, options); } });
  const close = retainFileSystemCleanup(backing, async view => { void view.lstat("/"); await view.lstat("/"); }, { maxOperations: 1 });
  await assert.rejects(close(), { code: "EFBIG" });
  assert.equal(operations, 1);
  const none = retainFileSystemCleanup(backing, view => view.lstat("/").then(() => {}), { maxOperations: 0 });
  await assert.rejects(none(), { code: "EFBIG" });
  assert.equal(operations, 1);
  for (const maxOperations of [-1, NaN, Infinity, 1.5, 4097, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => retainFileSystemCleanup(backing, () => {}, { maxOperations }), RangeError);
});

test("cleanup defaults to 256 admitted operations", async () => {
  let operations = 0;
  const memory = new MemoryFileSystem();
  const backing = wrapped(memory, { async lstat(path, options) { operations++; return memory.lstat(path, options); } });
  const close = retainFileSystemCleanup(backing, async view => {
    for (let index = 0; index < 257; index++) await view.lstat("/");
  });
  await assert.rejects(close(), { code: "EFBIG" });
  assert.equal(operations, 256);
});

test("callback settlement closes admission immediately but drains ignored pending operations", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/temporary", new Uint8Array([1]));
  const started = deferred();
  const release = deferred();
  let escaped!: RetainedFileSystemCleanupView;
  const backing = wrapped(memory, { async rm(path, options) { started.resolve(); await release.promise; await memory.rm(path, options); } });
  const close = retainFileSystemCleanup(backing, view => { escaped = view; void view.rm("/temporary"); });
  let closed = false;
  const closing = close();
  void closing.then(() => { closed = true; });
  await started.promise;
  await Promise.resolve();
  await assert.rejects(escaped.lstat("/"), { code: "EBADF" });
  assert.equal(closed, false);
  release.resolve();
  await closing;
  assert.equal(closed, true);
  await assert.rejects(memory.lstat("/temporary"), { code: "ENOENT" });
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`cleanup preserves callback failure ${String(reason)} while draining admitted work`, async () => {
  const memory = new MemoryFileSystem();
  const started = deferred();
  const release = deferred();
  let completed = false;
  const backing = wrapped(memory, { async lstat(path, options) { started.resolve(); await release.promise; completed = true; return memory.lstat(path, options); } });
  const close = retainFileSystemCleanup(backing, view => { void view.lstat("/"); throw reason; });
  const closing = close();
  const rejected = assert.rejects(closing, error => Object.is(error, reason));
  await started.promise;
  assert.equal(completed, false);
  release.resolve();
  await rejected;
  assert.equal(completed, true);
  assert.equal(close(), closing);
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`cleanup propagates ignored backing failure ${String(reason)} without unhandled rejection`, async () => {
  const memory = new MemoryFileSystem();
  const release = deferred();
  const backing = wrapped(memory, { async rm() { await release.promise; throw reason; } });
  const close = retainFileSystemCleanup(backing, view => { void view.rm("/temporary"); });
  const closing = close();
  release.resolve();
  await assert.rejects(closing, error => Object.is(error, reason));
});

test("provided abort signals and falsey cleanup-charge failures are never bypassed", async () => {
  const memory = new MemoryFileSystem();
  const caller = new AbortController();
  caller.abort(false);
  let charges = 0;
  const scoped = scopeFileSystem(memory, () => {}, new AbortController().signal, () => { charges++; });
  await assert.rejects(retainFileSystemCleanup(scoped, view => view.lstat("/", { signal: caller.signal }).then(() => {}))(), error => error === false);
  assert.equal(charges, 0);
  const failing = scopeFileSystem(memory, () => {}, new AbortController().signal, () => { throw 0; });
  await assert.rejects(retainFileSystemCleanup(failing, view => view.lstat("/").then(() => {}))(), error => error === 0);
});

test("cleanup never replaces the default charge with a no-op after cancellation", async () => {
  const memory = new MemoryFileSystem();
  const controller = new AbortController();
  let backingCalls = 0;
  const backing = wrapped(memory, { async lstat(path, options) { backingCalls++; return memory.lstat(path, options); } });
  const scoped = scopeFileSystem(backing, () => { controller.signal.throwIfAborted(); }, controller.signal);
  const close = retainFileSystemCleanup(scoped, view => view.lstat("/").then(() => {}));
  controller.abort(false);
  await assert.rejects(close(), error => error === false);
  assert.equal(backingCalls, 0);
});

test("cleanup checks maximum before probing the backing or invoking a callback", async () => {
  const memory = new MemoryFileSystem();
  let inspected = 0;
  let called = 0;
  const backing = new Proxy(memory, { get() { inspected++; throw new Error("unexpected backing probe"); } });
  assert.throws(() => retainFileSystemCleanup(backing, () => { called++; }, { maxOperations: 4097 }), RangeError);
  assert.deepEqual([inspected, called], [0, 0]);
  await retainFileSystemCleanup(memory, () => {}, { maxOperations: 4096 })();
});

test("cleanup propagates the first ignored operation failure only after draining its peers", async () => {
  const memory = new MemoryFileSystem();
  const release = deferred();
  const started = deferred();
  let completed = false;
  const backing = wrapped(memory, {
    async rm() { throw false; },
    async realpath(path, options) { started.resolve(); await release.promise; completed = true; return memory.realpath(path, options); },
  });
  const close = retainFileSystemCleanup(backing, view => { void view.rm("/missing"); void view.realpath("/"); });
  const closing = close();
  let rejected = false;
  const settled = assert.rejects(closing, error => { rejected = true; return error === false; });
  await started.promise;
  await Promise.resolve();
  assert.equal(rejected, false);
  release.resolve();
  await settled;
  assert.equal(completed, true);
});

test("cleanup preserves callback failure precedence over simultaneous operation failure", async () => {
  const memory = new MemoryFileSystem();
  const backing = wrapped(memory, { async rm() { throw new Error("backing failed"); } });
  const close = retainFileSystemCleanup(backing, view => { void view.rm("/missing"); throw 0; });
  await assert.rejects(close(), error => error === 0);
});

test("cleanup denies microtask-escaped work after a synchronous callback returns", async () => {
  const memory = new MemoryFileSystem();
  let escaped!: Promise<unknown>;
  const close = retainFileSystemCleanup(memory, view => {
    escaped = Promise.resolve().then(() => assert.rejects(view.lstat("/"), { code: "EBADF" }));
  });
  await close();
  await escaped;
});

test("cleanup does not replace an explicitly supplied signal aborted during charging", async () => {
  const memory = new MemoryFileSystem();
  const provided = new AbortController();
  let operations = 0;
  const backing = wrapped(memory, { async lstat(path, options) { operations++; return memory.lstat(path, options); } });
  const scoped = scopeFileSystem(backing, () => {}, new AbortController().signal, () => { provided.abort(0); });
  await assert.rejects(retainFileSystemCleanup(scoped, view => view.lstat("/", { signal: provided.signal }).then(() => {}))(), error => error === 0);
  assert.equal(operations, 0);
});

test("cleanup permits caught missing-file metadata before removing its owned directory", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/owned");
  const close = retainFileSystemCleanup(memory, async view => {
    try { await view.lstat("/owned/missing"); }
    catch (error) { assert.equal((error as { code: string }).code, "ENOENT"); }
    await view.rmdir!("/owned");
  });
  await close();
  await assert.rejects(memory.lstat("/owned"), { code: "ENOENT" });
});

for (const reason of [undefined, null, false, 0, "", NaN]) test(`cleanup does not resurrect an awaited and handled provider failure ${String(reason)}`, async () => {
  const memory = new MemoryFileSystem();
  const backing = wrapped(memory, { async lstat() { throw reason; } });
  const close = retainFileSystemCleanup(backing, async view => {
    await assert.rejects(view.lstat("/missing"), error => Object.is(error, reason));
    assert.equal(await view.realpath("/"), "/");
  });
  await close();
});

test("settled operation promises remain rejecting without being resurrected by close", async () => {
  const memory = new MemoryFileSystem();
  let operation!: Promise<unknown>;
  const close = retainFileSystemCleanup(memory, async view => {
    operation = view.lstat("/missing");
    await view.realpath("/");
  });
  await close();
  await assert.rejects(operation, { code: "ENOENT" });
});

test("callback-propagated operation failure keeps exact identity instead of becoming an aggregate", async () => {
  const memory = new MemoryFileSystem();
  const failure = new Error("owned cleanup failed");
  const backing = wrapped(memory, { async rm() { throw failure; } });
  const close = retainFileSystemCleanup(backing, view => view.rm("/owned"));
  await assert.rejects(close(), error => error === failure);
});

test("cleanup reports all still-pending failures after draining without deduplicating reasons", async () => {
  const memory = new MemoryFileSystem();
  const release = deferred();
  const backing = wrapped(memory, {
    async rm() { await release.promise; throw false; },
    async realpath() { await release.promise; throw false; },
  });
  const close = retainFileSystemCleanup(backing, view => { void view.rm("/owned"); void view.realpath("/owned"); });
  const closing = close();
  release.resolve();
  await assert.rejects(closing, error => error instanceof AggregateError && error.errors.length === 2 && error.errors.every(reason => reason === false));
});
