import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, FsError, toByteSource } from "../../../src/contracts/index.js";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";

function wrapped(backend: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(backend, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

for (const length of [0, 4099]) {
  for (const reverse of [false, true]) {
    test(`cross-mount streamed copy: ${length} bytes, reverse=${reverse}`, async () => {
      const origin = createMemoryFileSystem();
      const target = createMemoryFileSystem();
      const bytes = Uint8Array.from({ length }, (unused, index) => index % 256);
      await origin.writeFile("/source", bytes);
      const reader = wrapped(origin, { async readFile() { assert.fail("no buffered read fallback"); } });
      const writer = wrapped(target, { async writeFile() { assert.fail("no buffered write fallback"); } });
      const mount = createMountFileSystem({ root: reverse ? writer : reader, mounts: { "/disk": reverse ? reader : writer } });
      const source = reverse ? "/disk/source" : "/source";
      const destination = reverse ? "/copy" : "/disk/copy";
      await mount.copyFile(source, destination);
      assert.deepEqual(await target.readFile("/copy"), bytes);
      assert.deepEqual(await origin.readFile("/source"), bytes);
      assert.equal(mount.capabilities.atomicRename, false);
      await assert.rejects(mount.copyFile(source, destination, { exclusive: true }), { code: "EEXIST" });
      await assert.rejects(mount.rename(source, destination), { code: "EXDEV" });
    });
  }
}

test("cross-mount bounded fallback omits unsupported mode and forwards cancellation", async () => {
  const root = createMemoryFileSystem();
  const disk = createMemoryFileSystem();
  const controller = new AbortController();
  await root.writeFile("/source", new Uint8Array([0, 255]));
  const mount = createMountFileSystem({
    root: wrapped(root, {
      capabilities: { streamingRead: false },
      async readFile(path, options) {
        assert.equal(options?.maxBytes, 64 * 1024 * 1024);
        assert.equal(options?.signal, controller.signal);
        return root.readFile(path, options);
      },
    }),
    mounts: { "/disk": wrapped(disk, {
      capabilities: { streamingWrite: false, permissions: false, atomicRename: false },
      async writeFile(path, bytes, options) {
        assert.equal(options?.mode, undefined);
        assert.equal(options?.signal, controller.signal);
        await disk.writeFile(path, bytes, options);
      },
    }) },
  });
  await mount.copyFile("/source", "/disk/copy", { signal: controller.signal });
  assert.deepEqual(await disk.readFile("/copy"), new Uint8Array([0, 255]));
  assert.equal(mount.capabilities.atomicRename, false);
});

test("cross-mount writer error keeps partial effects, global metadata, and original cause", async () => {
  const root = createMemoryFileSystem();
  const disk = createMemoryFileSystem();
  await root.writeFile("/source", new Uint8Array([1, 2]));
  const failure = new FsError("ENOSPC", { path: "/copy", syscall: "writeStream" });
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: new Uint8Array([1]) }; },
    async return() { returned++; throw new Error("cleanup failed"); },
  }; } };
  const mount = createMountFileSystem({
    root: wrapped(root, { readStream: () => source }),
    mounts: { "/disk": wrapped(disk, { async writeStream(path, input) {
      const first = await input[Symbol.asyncIterator]().next();
      assert.equal(first.done, false);
      await disk.writeFile(path, first.value);
      throw failure;
    } }) },
  });
  await assert.rejects(mount.copyFile("/source", "/disk/copy"), (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "ENOSPC");
    assert.equal(error.path, "/source");
    assert.equal(error.dest, "/disk/copy");
    assert.equal(error.syscall, "copyFile");
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(returned, 1);
  assert.deepEqual(await disk.readFile("/copy"), new Uint8Array([1]));
  assert.deepEqual(await root.readFile("/source"), new Uint8Array([1, 2]));
});

test("heterogeneous streams remain conditional and selected unsupported paths fail before input", async () => {
  const root = createMemoryFileSystem();
  const limited = createMemoryFileSystem();
  await limited.writeFile("/file", new Uint8Array([1]));
  let called = false;
  const mount = createMountFileSystem({ root, mounts: { "/limited": wrapped(limited, {
    capabilities: { streamingRead: false, streamingWrite: false, atomicRename: false },
    readStream() { called = true; throw new FsError("EIO"); },
    async writeStream() { called = true; throw new FsError("EIO"); },
  }) } });
  assert.equal(Object.hasOwn(mount.capabilities, "streamingRead"), false);
  assert.equal(Object.hasOwn(mount.capabilities, "streamingWrite"), false);
  await mount.writeStream("/valid", toByteSource(new Uint8Array([0, 255])));
  assert.deepEqual(await collectBytes(mount.readStream("/valid"), { maxBytes: 2 }), new Uint8Array([0, 255]));
  await assert.rejects(collectBytes(mount.readStream("/limited/file"), { maxBytes: 2 }), { code: "ENOTSUP" });
  const source = (async function* () { assert.fail("unsupported writer consumed input"); yield new Uint8Array(); })();
  await assert.rejects(mount.writeStream("/limited/file", source), { code: "ENOTSUP" });
  assert.equal(called, false);
});

test("mount aborts a blocked read and observes late reader rejection", { timeout: 2000 }, async () => {
  const root = createMemoryFileSystem();
  await root.writeFile("/file", new Uint8Array([1]));
  const started = deferred<void>();
  const pending = deferred<IteratorResult<Uint8Array>>();
  let returned = 0;
  const mount = createMountFileSystem({ root: wrapped(root, { readStream: () => ({ [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return pending.promise; },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } }) }) });
  const controller = new AbortController();
  const reading = mount.readStream("/file", { signal: controller.signal })[Symbol.asyncIterator]().next();
  await started.promise;
  const reason = new Error("cancel mounted reader");
  controller.abort(reason);
  await assert.rejects(reading, (error: unknown) => error === reason);
  await Promise.resolve();
  assert.equal(returned, 1);
  pending.reject(new Error("late provider error"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

const copyReasons: readonly { label: string; reason: unknown }[] = [
  { label: "undefined", reason: undefined }, { label: "null", reason: null },
  { label: "false", reason: false }, { label: "zero", reason: 0 },
  { label: "empty", reason: "" }, { label: "NaN", reason: NaN },
  { label: "FsError", reason: new FsError("ENOSPC", { path: "/provider/source" }) },
  { label: "object", reason: { writer: true } },
];

for (const primary of [false, true]) {
  for (const [index, { label, reason }] of copyReasons.entries()) {
    test(`mount copy cleanup characterization: primary=${primary}, ${label}`, { timeout: 2000 }, async () => {
      const root = createMemoryFileSystem(), disk = createMemoryFileSystem();
      await root.writeFile("/source", new Uint8Array([1, 2]));
      const entered = deferred<void>(), release = deferred<void>();
      const secondary = primary ? copyReasons[(index + 1) % copyReasons.length]!.reason : reason;
      let returns = 0, settled = false;
      const source: ByteSource = { [Symbol.asyncIterator]() { return {
        async next() { return { done: false, value: new Uint8Array([1]) }; },
        async return() { returns++; entered.resolve(); await release.promise; throw secondary; },
      }; } };
      const mount = createMountFileSystem({
        root: wrapped(root, { readStream: () => source }),
        mounts: { "/disk": wrapped(disk, { async writeStream(path, input) {
          const first = await input[Symbol.asyncIterator]().next();
          assert.equal(first.done, false);
          await disk.writeFile(path, first.value);
          if (primary) throw reason;
        } }) },
      });
      const operation = mount.copyFile("/source", "/disk/copy");
      void operation.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(settled, false);
        assert.equal(returns, 1);
        release.resolve();
        await assert.rejects(operation, error => {
          assert.ok(error instanceof FsError);
          assert.equal(error.code, reason instanceof FsError ? reason.code : "EIO");
          assert.equal(error.path, "/source");
          assert.equal(error.dest, "/disk/copy");
          assert.equal(error.syscall, "copyFile");
          assert.equal(Object.is(error.cause, reason), true);
          return true;
        });
        assert.equal(returns, 1);
        assert.deepEqual(await disk.readFile("/copy"), new Uint8Array([1]));
        assert.deepEqual(await root.readFile("/source"), new Uint8Array([1, 2]));
      } finally { release.resolve(); await operation.catch(() => {}); }
    });
  }
}

for (const primary of [false, true]) {
  for (const rejectCleanup of [false, true]) {
    test(`mount copy cleanup characterization: late abort, primary=${primary}, reject=${rejectCleanup}`, { timeout: 2000 }, async () => {
      const root = createMemoryFileSystem(), disk = createMemoryFileSystem();
      await root.writeFile("/source", new Uint8Array([1, 2]));
      const entered = deferred<void>(), release = deferred<void>();
      const controller = new AbortController();
      let returns = 0, cleaned = false;
      let cleanup: Promise<IteratorResult<Uint8Array>> | undefined;
      const source: ByteSource = { [Symbol.asyncIterator]() { return {
        async next() { return { done: false, value: new Uint8Array([1]) }; },
        return() {
          returns++;
          cleanup = (async () => {
            entered.resolve(); await release.promise; cleaned = true;
            if (rejectCleanup) throw new Error("late reader cleanup");
            return { done: true as const, value: undefined };
          })();
          return cleanup;
        },
      }; } };
      const mount = createMountFileSystem({
        root: wrapped(root, { readStream: () => source }),
        mounts: { "/disk": wrapped(disk, { async writeStream(path, input) {
          const first = await input[Symbol.asyncIterator]().next();
          await disk.writeFile(path, first.value);
          if (primary) throw 0;
        } }) },
      });
      const operation = mount.copyFile("/source", "/disk/copy", { signal: controller.signal });
      void operation.catch(() => {});
      try {
        await entered.promise;
        controller.abort(false);
        await assert.rejects(operation, error => {
          if (!primary) return Object.is(error, controller.signal.reason);
          assert.ok(error instanceof FsError);
          assert.equal(error.path, "/source");
          assert.equal(error.dest, "/disk/copy");
          assert.equal(error.syscall, "copyFile");
          assert.equal(Object.is(error.cause, 0), true);
          return true;
        });
        assert.equal(cleaned, false);
        assert.equal(returns, 1);
      } finally { release.resolve(); await operation.catch(() => {}); await cleanup?.catch(() => {}); }
      assert.equal(cleaned, true);
      assert.deepEqual(await disk.readFile("/copy"), new Uint8Array([1]));
    });
  }
}
