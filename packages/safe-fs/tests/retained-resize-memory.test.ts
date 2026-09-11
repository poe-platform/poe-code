import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileResizeHandle, FileSystem, OpenResizeFileOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

const bytes = (length: number, value = 1): Uint8Array => new Uint8Array(length).fill(value);
const code = (expected: string) => (error: unknown): boolean => error instanceof FsError && error.code === expected;

async function acquire(filesystem: FileSystem, path = "/f", options?: OpenResizeFileOptions): Promise<FileResizeHandle> {
  assert.equal(typeof filesystem.openResizeFile, "function", "retained resize API exists");
  return filesystem.openResizeFile!(path, options);
}

afterEach(() => { vi.restoreAllMocks(); });

test("Memory publishes virtual 4096 hints in fresh path and retained snapshots", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", bytes(3));
  await filesystem.symlink("f", "/s");
  const handle = await acquire(filesystem);
  const reader = await filesystem.openReadFile("/f");
  try {
    assert.equal((filesystem as FileSystem).capabilities.retainedResize, true);
    assert.deepEqual(Object.keys(handle).sort(), ["close", "seekEnd", "stat", "truncate"]);
    assert.equal(typeof handle.seekEnd, "function");
    assert.equal(typeof reader.seekEnd, "function");
    assert.equal(await handle.seekEnd!(), 3n);
    assert.equal(await reader.seekEnd!(), 3n);
    const before = await filesystem.stat("/f");
    assert.equal(before.preferredIoBlockSize, 4096);
    assert.equal((await filesystem.lstat("/s")).preferredIoBlockSize, 4096);
    assert.equal((await filesystem.stat("/")).preferredIoBlockSize, 4096);
    assert.deepEqual(await handle.stat(), before);
    assert.deepEqual(await reader.stat(), before);
    await handle.truncate(2);
    assert.equal(await handle.seekEnd!(), 2n);
    assert.equal(await reader.seekEnd!(), 2n);
    const after = await handle.stat();
    assert.equal(before.size, 3);
    assert.equal(after.size, 2);
    assert.equal(after.ino, before.ino);
    assert.equal(after.identityScope, before.identityScope);
    assert.equal(after.preferredIoBlockSize, 4096);
  } finally { await handle.close(); await reader.close(); }
});

test("acquisition is write-only and nontruncating; later chmod does not revoke authority", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", bytes(3, 7), { mode: 0o200 });
  await filesystem.utimes("/f", 10, 20);
  const before = await filesystem.stat("/f");
  const handle = await acquire(filesystem, "/f", { create: true, mode: 0o777 });
  try {
    assert.deepEqual(await handle.stat(), before);
    await assert.rejects(filesystem.readFile("/f"), code("EACCES"));
    await filesystem.chmod("/f", 0);
    await handle.truncate(5);
    await assert.rejects(acquire(filesystem), code("EACCES"));
    await filesystem.chmod("/f", 0o400);
    assert.deepEqual(await filesystem.readFile("/f"), Uint8Array.of(7, 7, 7, 0, 0));
    await handle.truncate(1);
    assert.deepEqual(await filesystem.readFile("/f"), Uint8Array.of(7));
  } finally { await handle.close(); }
});

test("creation is explicit, does not create parents, and persists after resize failure", async () => {
  const filesystem = new MemoryFileSystem({ maxFileBytes: 4 });
  await assert.rejects(acquire(filesystem), code("ENOENT"));
  await assert.rejects(acquire(filesystem, "/missing/f", { create: true }), code("ENOENT"));
  assert.deepEqual(await filesystem.readdir("/"), []);
  const handle = await acquire(filesystem, "/f", { create: true, mode: 0o240 });
  try {
    assert.equal((await handle.stat()).mode & 0o7777, 0o240);
    await assert.rejects(handle.truncate(5), code("EFBIG"));
    assert.equal((await filesystem.stat("/f")).size, 0);
  } finally { await handle.close(); }
  const defaultMode = await acquire(filesystem, "/g", { create: true });
  assert.equal((await defaultMode.stat()).mode & 0o7777, 0o666);
  await defaultMode.close();
});

test("writable-open resolution follows symlinks and preserves create-specific separator failures", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.symlink("target", "/s");
  await assert.rejects(acquire(filesystem, "/s"), code("ENOENT"));
  const handle = await acquire(filesystem, "/s", { create: true });
  await handle.truncate(2);
  assert.equal((await filesystem.lstat("/s")).type, "symlink");
  assert.equal((await filesystem.stat("/target")).ino, (await handle.stat()).ino);
  await handle.close();
  await filesystem.mkdir("/d");
  await filesystem.symlink("loop", "/loop");
  for (const [path, expected] of [["/target/", "EISDIR"], ["/s/", "EISDIR"], ["/d/", "EISDIR"],
    ["/missing/", "EISDIR"], ["/loop", "ELOOP"], ["", "ENOENT"], ["/nul\0", "EINVAL"]]) {
    await assert.rejects(acquire(filesystem, path!, { create: true }), code(expected!));
  }
  for (const [path, expected] of [["/target/", "ENOTDIR"], ["/s/", "ENOTDIR"], ["/d/", "EISDIR"], ["/missing/", "ENOENT"]]) {
    await assert.rejects(acquire(filesystem, path!, { create: false }), code(expected!));
  }
  await filesystem.chmod("/d", 0o555);
  await assert.rejects(acquire(filesystem, "/d/new", { create: true }), code("EACCES"));
  await filesystem.chmod("/d", 0o600);
  await assert.rejects(acquire(filesystem, "/d/new", { create: true }), code("EACCES"));
});

test("the same inode is resized across hardlinks, rename, replacement and final unlink", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", bytes(3, 7));
  await filesystem.link("/f", "/alias");
  const handle = await acquire(filesystem);
  const reader = await filesystem.openReadFile("/f");
  const identity = await handle.stat();
  try {
    await filesystem.rename("/f", "/old");
    await filesystem.writeFile("/f", bytes(4, 9));
    await handle.truncate(2);
    assert.deepEqual(await filesystem.readFile("/alias"), bytes(2, 7));
    await filesystem.rm("/old");
    await filesystem.rm("/alias");
    await handle.truncate(4);
    assert.deepEqual(await reader.read(0, 8), Uint8Array.of(7, 7, 0, 0));
    assert.equal((await handle.stat()).ino, identity.ino);
    assert.equal((await handle.stat()).nlink, 0);
    assert.deepEqual(await filesystem.readFile("/f"), bytes(4, 9));
    assert.notEqual((await filesystem.stat("/f")).ino, identity.ino);
  } finally { await handle.close(); await reader.close(); }
});

test("pinned operations never call subsequently replaced pathname methods", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", bytes(3));
  const handle = await acquire(filesystem);
  for (const method of ["stat", "truncate", "writeFile", "access", "realpath"]) {
    Object.defineProperty(filesystem, method, { value: () => { throw new Error("stale pathname operation"); } });
  }
  await handle.truncate(2);
  assert.equal((await handle.stat()).size, 2);
  await handle.close();
});

test("shrink, zero growth and same-size resize update mtime/ctime but not atime or birthtime", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", Uint8Array.of(1, 2, 3, 4));
  await filesystem.utimes("/f", 10, 20);
  const handle = await acquire(filesystem);
  const before = await handle.stat();
  try {
    for (const [length, now] of [[2, 100], [4, 200], [4, 300], [0, 400]]) {
      vi.spyOn(Date, "now").mockReturnValue(now!);
      await handle.truncate(length!);
      const after = await handle.stat();
      assert.equal(after.size, length);
      assert.equal(after.atimeMs, 10);
      assert.equal(after.birthtimeMs, before.birthtimeMs);
      assert.equal(after.mtimeMs, now);
      assert.equal(after.ctimeMs, now);
      if (length === 4) {
        const content = await filesystem.readFile("/f");
        assert.deepEqual(content, Uint8Array.of(1, 2, 0, 0));
        await filesystem.utimes("/f", 10, now!);
      }
    }
  } finally { await handle.close(); }
});

test("invalid lengths and bounded growth leave the existing object unchanged", async () => {
  const filesystem = new MemoryFileSystem({ maxFileBytes: 4 });
  await filesystem.writeFile("/f", bytes(2));
  const handle = await acquire(filesystem);
  const before = await handle.stat();
  try {
    for (const length of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(handle.truncate(length), code("EINVAL"));
      assert.deepEqual(await handle.stat(), before);
    }
    await assert.rejects(handle.truncate(Number.MAX_SAFE_INTEGER), code("EFBIG"));
    assert.deepEqual(await handle.stat(), before);
    await handle.truncate(4);
  } finally { await handle.close(); }
});

test("close stops admission synchronously and shares one promise", async () => {
  const filesystem = new MemoryFileSystem();
  const handle = await acquire(filesystem, "/f", { create: true });
  const resizing = handle.truncate(3);
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  await assert.rejects(handle.stat(), code("EBADF"));
  await assert.rejects(handle.truncate(0), code("EBADF"));
  await resizing;
  await closing;
  assert.equal(handle.close(), closing);
  assert.equal((await filesystem.stat("/f")).size, 3);
});

for (const reason of [null, false, 0, ""]) {
  test(`falsey cancellation ${JSON.stringify(reason)} precedes creation and resizing without losing identity`, async () => {
    const filesystem = new MemoryFileSystem({ maxMetadataUnits: 4 });
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(acquire(filesystem, "/f", { create: true, signal: controller.signal }), error => error === reason);
    assert.deepEqual(await filesystem.readdir("/"), []);
    const handle = await acquire(filesystem, "/f", { create: true });
    try {
      await handle.truncate(2);
      const before = await handle.stat();
      await assert.rejects(handle.truncate(3, { signal: controller.signal }), error => error === reason);
      await assert.rejects(handle.stat({ signal: controller.signal }), error => error === reason);
      assert.deepEqual(await handle.stat(), before);
    } finally { await handle.close(); }
    await filesystem.link("/f", "/g");
  });
}

test("handle metadata reservations are bounded and refunded exactly once", async () => {
  const filesystem = new MemoryFileSystem({ maxMetadataUnits: 5 });
  await filesystem.writeFile("/f", bytes(1));
  const first = await acquire(filesystem);
  const second = await acquire(filesystem);
  await assert.rejects(acquire(filesystem), code("ENOSPC"));
  await first.close();
  await first.close();
  const third = await acquire(filesystem);
  await assert.rejects(acquire(filesystem), code("ENOSPC"));
  await filesystem.rm("/f");
  await second.close();
  await third.close();
  await filesystem.writeFile("/g", bytes(0));
  await filesystem.mkdir("/d");
});

test("failed acquisition refunds path admission without leaving a partial inode", async () => {
  const filesystem = new MemoryFileSystem({ maxMetadataUnits: 3, maxRetainedBytes: 6 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(acquire(filesystem, "/f", { create: true }), code("ENOSPC"));
    assert.deepEqual(await filesystem.readdir("/"), []);
  }
  await filesystem.writeFile("/f", bytes(4));
});

test("both old and replacement allocation are charged before resize commits", async () => {
  const filesystem = new MemoryFileSystem({ maxRetainedBytes: 12 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const handle = await acquire(filesystem);
  try {
    const before = await handle.stat();
    await assert.rejects(handle.truncate(4), code("ENOSPC"));
    assert.deepEqual(await handle.stat(), before);
    assert.deepEqual(await filesystem.readFile("/f"), bytes(4, 7));
    await handle.truncate(2);
    await handle.truncate(4);
    assert.deepEqual(await filesystem.readFile("/f"), Uint8Array.of(7, 7, 0, 0));
  } finally { await handle.close(); }
});

test("unlinked handles retain inode and byte charges until the last close", async () => {
  const filesystem = new MemoryFileSystem({ maxRetainedBytes: 10, maxMetadataUnits: 4 });
  await filesystem.writeFile("/f", bytes(4));
  const handle = await acquire(filesystem);
  await filesystem.rm("/f");
  await handle.truncate(2);
  await assert.rejects(filesystem.writeFile("/g", bytes(4)), code("ENOSPC"));
  await handle.close();
  await handle.close();
  await filesystem.writeFile("/g", bytes(8));
});

test("resize retains the old stream allocation until that reader releases it", async () => {
  const filesystem = new MemoryFileSystem({ maxRetainedBytes: 20 });
  await filesystem.writeFile("/f", bytes(4, 7));
  const handle = await acquire(filesystem);
  const reader = filesystem.readStream("/f", { chunkSize: 1 })[Symbol.asyncIterator]();
  await reader.next();
  try {
    await handle.truncate(2);
    assert.deepEqual((await reader.next()).value, bytes(1, 7));
    await assert.rejects(filesystem.writeFile("/g", bytes(3)), code("ENOSPC"));
  } finally { await reader.return!(); await handle.close(); }
  await filesystem.writeFile("/g", bytes(8));
});

for (const method of ["openResizeFile", "truncate", "writeFile", "writeStream", "appendFile", "stat", "lstat", "access", "realpath",
  "openWrite", "prepareWrite", "resizeNode", "writeData", "bytes", "writeAt", "allocate", "replaceData", "releaseNode", "releaseReference", "snapshot", "integer",
  "resolve", "permission", "validatePath", "mode", "addNode", "metadata", "changed", "fail"]) {
  test(`stock resize admission rejects overridden ${method} without executing accessors`, async () => {
    const filesystem = new MemoryFileSystem();
    const original = (filesystem as FileSystem).openResizeFile;
    assert.equal(typeof original, "function");
    let calls = 0;
    Object.defineProperty(filesystem, method, { get() { calls++; throw new Error("overridden policy"); } });
    assert.equal((filesystem as FileSystem).capabilities.retainedResize, false);
    await assert.rejects(original!.call(filesystem, "/f", { create: true }), code("ENOTSUP"));
    assert.equal(calls, 0);
  });
}

test("subclasses, replaced stores, ledgers and capability objects cannot claim stock resize", async () => {
  class CustomizedMemory extends MemoryFileSystem {}
  assert.equal((new CustomizedMemory() as FileSystem).capabilities.retainedResize, false);
  await assert.rejects(acquire(new CustomizedMemory(), "/f", { create: true }), code("ENOTSUP"));
  for (const property of ["root", "ledger", "capabilities"]) {
    const filesystem = new MemoryFileSystem();
    const originalCapabilities = filesystem.capabilities;
    const replacement = new MemoryFileSystem();
    Object.defineProperty(filesystem, property, { value: Reflect.get(replacement, property) });
    assert.equal((originalCapabilities as FileSystem["capabilities"]).retainedResize, false);
    await assert.rejects(acquire(filesystem, "/f", { create: true }), code("ENOTSUP"));
  }
});
