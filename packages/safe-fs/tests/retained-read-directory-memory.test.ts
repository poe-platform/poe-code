import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileReadHandle, FileSystem, OpenReadFileOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

const code = (expected: string) => (error: unknown): boolean => error instanceof FsError && error.code === expected;

function usage(filesystem: MemoryFileSystem) {
  const ledger = Reflect.get(filesystem, "ledger");
  return { bytes: Reflect.get(ledger, "retainedBytes"), units: Reflect.get(ledger, "metadataUnits") };
}

async function open(filesystem: FileSystem, path = "/d", options: OpenReadFileOptions = { allowDirectory: true }): Promise<FileReadHandle> {
  assert.equal(typeof filesystem.openReadFile, "function");
  return filesystem.openReadFile!(path, options);
}

afterEach(() => { vi.restoreAllMocks(); });

for (const allowDirectory of [undefined, false, 0, 1, "true", null]) {
  test(`directory retained reads require literal true: ${String(allowDirectory)}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    const before = usage(filesystem);
    await assert.rejects(open(filesystem, "/d", { allowDirectory } as OpenReadFileOptions), code("EISDIR"));
    await assert.rejects(filesystem.openReadFile("/d"), code("EISDIR"));
    assert.deepEqual(usage(filesystem), before);
  });
}

for (const path of ["/d", "/d/", "/s", "/s/", "/"]) {
  test(`opt-in directory handle exposes pinned snapshots and ext4 64-bit EOF: ${path}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    await filesystem.symlink("d", "/s");
    const before = await filesystem.stat(path);
    const retained = usage(filesystem);
    const handle = await open(filesystem, path);
    try {
      assert.deepEqual(Object.keys(handle).sort(), ["close", "read", "seekEnd", "stat"]);
      assert.equal(typeof handle.seekEnd, "function");
      assert.equal(await handle.seekEnd!(), 9223372036854775807n);
      const first = await handle.stat();
      assert.deepEqual(first, before);
      Reflect.set(first, "mode", 0);
      assert.deepEqual(await handle.stat(), before);
      assert.deepEqual(usage(filesystem), { bytes: retained.bytes + path.length * 2, units: retained.units + 1 });
      await assert.rejects(handle.read(0, 1), code("EISDIR"));
      for (const [position, length] of [[0, 0], [-1, 1], [NaN, Infinity], [Number.MAX_SAFE_INTEGER, 2]]) {
        await assert.rejects(handle.read(position!, length!), code("EINVAL"));
      }
      assert.deepEqual(await handle.stat(), before);
    } finally { await handle.close(); }
    assert.deepEqual(usage(filesystem), retained);
  });
}

for (const allowDirectory of [undefined, false, true]) {
  test(`regular retained reads remain positional with allowDirectory=${String(allowDirectory)}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/f", Uint8Array.of(1, 2, 3));
    const before = usage(filesystem);
    const handle = await open(filesystem, "/f", allowDirectory === undefined ? {} : { allowDirectory });
    try {
      assert.equal((await handle.stat()).type, "file");
      assert.equal(typeof handle.seekEnd, "function");
      assert.equal(await handle.seekEnd!(), 3n);
      const bytes = await handle.read(1, 2);
      assert.deepEqual(bytes, Uint8Array.of(2, 3));
      bytes.fill(0);
      assert.deepEqual(await handle.read(0, 3), Uint8Array.of(1, 2, 3));
      await assert.rejects(handle.read(0, 0), code("EINVAL"));
      await filesystem.chmod("/f", 0);
      assert.equal(await handle.seekEnd!(), 3n);
      assert.deepEqual(await handle.read(0, 3), Uint8Array.of(1, 2, 3));
    } finally { await handle.close(); }
    assert.deepEqual(usage(filesystem), before);
  });
}

test("retained directory snapshots follow the pinned inode through rename, unlink and replacement", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/d");
  await filesystem.mkdir("/d/child");
  const handle = await open(filesystem);
  try {
    const before = await handle.stat();
    assert.equal(before.nlink, 3);
    clock.mockReturnValue(2000);
    await filesystem.rename("/d", "/old");
    await filesystem.mkdir("/d");
    assert.equal((await handle.stat()).ino, before.ino);
    assert.notEqual((await filesystem.stat("/d")).ino, before.ino);
    await filesystem.chmod("/old", 0o700);
    assert.equal((await handle.stat()).mode & 0o7777, 0o700);
    clock.mockReturnValue(3000);
    await filesystem.rm("/old", { recursive: true });
    const removed = await handle.stat();
    assert.equal(removed.type, "directory");
    assert.equal(removed.ino, before.ino);
    assert.equal(removed.identityScope, before.identityScope);
    assert.equal(removed.nlink, 0);
    assert.equal(removed.ctimeMs, 3000);
    assert.equal(removed.birthtimeMs, 1000);
    assert.equal(typeof handle.seekEnd, "function");
    assert.equal(await handle.seekEnd!(), 9223372036854775807n);
    await assert.rejects(handle.read(0, 1), code("EISDIR"));
    await assert.rejects(filesystem.stat("/old"), code("ENOENT"));
    filesystem.stat = async () => { throw new Error("retained stat must not resolve a pathname"); };
    assert.equal(await handle.seekEnd!(), 9223372036854775807n);
    assert.deepEqual(await handle.stat(), removed);
  } finally { await handle.close(); }
});

for (const removal of ["rmdir", "rm", "rename"] as const) {
  test(`removed directory node and path references stay charged until final close: ${removal}`, async () => {
    const filesystem = new MemoryFileSystem({ maxMetadataUnits: 7, maxRetainedBytes: 32 });
    await filesystem.mkdir("/d");
    await filesystem.mkdir("/s");
    const first = await open(filesystem);
    const second = await open(filesystem);
    assert.deepEqual(usage(filesystem), { bytes: 12, units: 7 });
    await assert.rejects(open(filesystem), code("ENOSPC"));
    if (removal === "rmdir") await filesystem.rmdir("/d");
    else if (removal === "rm") await filesystem.rm("/d", { recursive: true });
    else await filesystem.rename("/s", "/d");
    assert.deepEqual(usage(filesystem), { bytes: 10, units: 6 });
    assert.equal((await first.stat()).nlink, 0);
    await assert.rejects(filesystem.mkdir("/n"), code("ENOSPC"));
    const closing = first.close();
    assert.equal(first.close(), closing);
    await assert.rejects(first.stat(), code("EBADF"));
    await assert.rejects(first.read(0, 1), code("EBADF"));
    await closing;
    assert.deepEqual(usage(filesystem), { bytes: 6, units: 5 });
    assert.equal((await second.stat()).type, "directory");
    await second.close();
    assert.equal(second.close(), second.close());
    assert.deepEqual(usage(filesystem), { bytes: 2, units: 3 });
    await filesystem.mkdir("/n");
    assert.deepEqual(usage(filesystem), { bytes: 4, units: 5 });
  });
}

for (const closeChildFirst of [false, true]) {
  test(`recursive unlink clears children while retaining independently owned nodes: child first=${closeChildFirst}`, async () => {
    const filesystem = new MemoryFileSystem({ maxRetainedBytes: 64, maxMetadataUnits: 13 });
    await filesystem.mkdir("/d");
    await filesystem.writeFile("/d/f", new Uint8Array(8).fill(7));
    await filesystem.link("/d/f", "/d/g");
    await filesystem.link("/d/f", "/outside");
    await filesystem.mkdir("/d/sub");
    await filesystem.writeFile("/d/sub/x", new Uint8Array(16).fill(9));
    const root = Reflect.get(filesystem, "root");
    const removedDirectory = root.entries.get("d");
    const removedSubdirectory = removedDirectory.entries.get("sub");
    const directory = await open(filesystem);
    const child = await open(filesystem, "/d/f", {});
    assert.deepEqual(usage(filesystem), { bytes: 64, units: 13 });
    await filesystem.rm("/d", { recursive: true });
    assert.equal(removedDirectory.entries.size, 0);
    assert.equal(removedSubdirectory.entries.size, 0);
    assert.deepEqual(usage(filesystem), { bytes: 34, units: 6 });
    assert.equal((await child.stat()).nlink, 1);
    assert.deepEqual(await filesystem.readFile("/outside"), new Uint8Array(8).fill(7));
    await filesystem.rm("/outside");
    assert.deepEqual(usage(filesystem), { bytes: 20, units: 5 });
    assert.equal((await child.stat()).nlink, 0);
    assert.deepEqual(await child.read(0, 8), new Uint8Array(8).fill(7));
    await assert.rejects(filesystem.writeFile("/z", new Uint8Array(43)), code("ENOSPC"));
    assert.deepEqual(usage(filesystem), { bytes: 20, units: 5 });
    await filesystem.writeFile("/z", new Uint8Array(42));
    assert.deepEqual(usage(filesystem), { bytes: 64, units: 7 });
    await filesystem.rm("/z");
    if (closeChildFirst) {
      await child.close();
      assert.deepEqual(usage(filesystem), { bytes: 4, units: 3 });
      await directory.close();
    } else {
      await directory.close();
      assert.deepEqual(usage(filesystem), { bytes: 16, units: 3 });
      await child.close();
    }
    assert.deepEqual(usage(filesystem), { bytes: 0, units: 1 });
    assert.deepEqual(await filesystem.readdir("/"), []);
  });
}

test("directory read permission and ancestor search are required only at acquisition", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/d", { mode: 0o100 });
  const before = usage(filesystem);
  await assert.rejects(open(filesystem), code("EACCES"));
  assert.deepEqual(usage(filesystem), before);
  await filesystem.chmod("/d", 0o400);
  const handle = await open(filesystem);
  try {
    await filesystem.chmod("/d", 0);
    assert.equal((await handle.stat()).mode & 0o7777, 0);
    await assert.rejects(handle.read(0, 1), code("EISDIR"));
    await assert.rejects(open(filesystem), code("EACCES"));
    await filesystem.mkdir("/p");
    await filesystem.mkdir("/p/child");
    await filesystem.chmod("/p", 0o400);
    await assert.rejects(open(filesystem, "/p/child"), code("EACCES"));
  } finally { await handle.close(); }
});

for (const limit of [{ maxRetainedBytes: 5 }, { maxMetadataUnits: 3 }]) {
  test(`directory reference admission failure is atomic: ${JSON.stringify(limit)}`, async () => {
    const filesystem = new MemoryFileSystem(limit);
    await filesystem.mkdir("/d");
    const before = usage(filesystem);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(open(filesystem), code("ENOSPC"));
      assert.deepEqual(usage(filesystem), before);
    }
    await filesystem.rmdir("/d");
    assert.deepEqual(usage(filesystem), { bytes: 0, units: 1 });
  });
}

for (const reason of [null, false, 0, "", NaN]) {
  test(`directory capability rejection cannot replace getter cancellation: ${String(reason)}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    const before = usage(filesystem);
    const controller = new AbortController();
    Object.defineProperty(filesystem, "capabilities", { value: { get retainedRead() { controller.abort(reason); return false; } } });
    await assert.rejects(open(filesystem, "/d", { allowDirectory: true, signal: controller.signal }), error => Object.is(error, reason));
    assert.deepEqual(usage(filesystem), before);
  });
  for (const boundary of ["before", "allowDirectory", "retainedRead"] as const) {
    test(`directory acquisition preserves cancellation at ${boundary}: ${String(reason)}`, async () => {
      const filesystem = new MemoryFileSystem();
      await filesystem.mkdir("/d");
      const before = usage(filesystem);
      const controller = new AbortController();
      const options: OpenReadFileOptions = { allowDirectory: true, signal: controller.signal };
      if (boundary === "before") controller.abort(reason);
      else if (boundary === "allowDirectory") Object.defineProperty(options, "allowDirectory", { get() { controller.abort(reason); return true; } });
      else Object.defineProperty(filesystem, "capabilities", { value: { get retainedRead() { controller.abort(reason); return true; } } });
      await assert.rejects(open(filesystem, "/d", options), error => Object.is(error, reason));
      assert.deepEqual(usage(filesystem), before);
    });
  }
  test(`directory handle cancellation preserves the reason without releasing ownership: ${String(reason)}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    const handle = await open(filesystem);
    const before = usage(filesystem);
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(handle.stat({ signal: controller.signal }), error => Object.is(error, reason));
    await assert.rejects(handle.read(0, 1, { signal: controller.signal }), error => Object.is(error, reason));
    assert.deepEqual(usage(filesystem), before);
    assert.equal((await handle.stat()).type, "directory");
    await handle.close();
    await assert.rejects(handle.stat(), code("EBADF"));
  });
}

for (const property of ["root", "ledger"]) {
  test(`directory retained admission rejects a substituted ${property}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    const replacement = new MemoryFileSystem();
    const original = Reflect.get(filesystem, property);
    Reflect.set(filesystem, property, Reflect.get(replacement, property));
    await assert.rejects(open(filesystem), code("ENOTSUP"));
    Reflect.set(filesystem, property, original);
    assert.deepEqual(usage(filesystem), { bytes: 2, units: 3 });
    assert.deepEqual(usage(replacement), { bytes: 0, units: 1 });
  });
}

for (const name of ["openReadFile", "readFile", "readStream", "stat", "lstat", "realpath", "access", "file", "resolve", "permission", "validatePath", "fail", "snapshot", "integer", "releaseReference", "releaseNode"]) {
  test(`directory retained admission rejects overridden ${name} without dispatch`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/d");
    const originalOpen = filesystem.openReadFile;
    const before = usage(filesystem);
    let calls = 0;
    Object.defineProperty(filesystem, name, { value() { calls++; throw new Error("override dispatched"); } });
    await assert.rejects(Reflect.apply(originalOpen, filesystem, ["/d", { allowDirectory: true }]), code("ENOTSUP"));
    assert.equal(calls, 0);
    assert.deepEqual(usage(filesystem), before);
  });
}
