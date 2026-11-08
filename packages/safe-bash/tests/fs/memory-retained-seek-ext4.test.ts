import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../safe-fs/src/contracts/errors.js";
import type { FileReadHandle, FileResizeHandle } from "../../../safe-fs/src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../safe-fs/src/fs/memory/index.js";

function usage(filesystem: MemoryFileSystem) {
  const ledger = Reflect.get(filesystem, "ledger");
  return { bytes: Reflect.get(ledger, "retainedBytes"), units: Reflect.get(ledger, "metadataUnits") };
}

const code = (expected: string, syscall?: string) => (error: unknown): boolean =>
  error instanceof FsError && error.code === expected && (syscall === undefined || error.syscall === syscall);

for (const populated of [false, true]) {
  for (const path of ["/", "/d", "/d/", "/s", "/s/"]) {
    test(`Memory ext4 64-bit htree directory EOF: ${path}, populated=${populated}`, async () => {
      const filesystem = new MemoryFileSystem();
      await filesystem.mkdir("/d");
      await filesystem.symlink("d", "/s");
      if (populated) {
        await filesystem.writeFile("/d/file", Uint8Array.of(1, 2, 3));
        await filesystem.mkdir("/d/child");
      }
      await filesystem.utimes(path, 10, 20);
      const before = await filesystem.stat(path);
      const retained = usage(filesystem);
      const handle = await filesystem.openReadFile(path, { allowDirectory: true });
      try {
        assert.equal(typeof handle.seekEnd, "function");
        const opened = usage(filesystem);
        for (let attempt = 0; attempt < 3; attempt++) {
          assert.equal(await handle.seekEnd!(), 9223372036854775807n);
        }
        assert.deepEqual(usage(filesystem), opened);
        assert.equal(before.size, 0);
        assert.deepEqual(await handle.stat(), before);
        assert.deepEqual(await filesystem.stat(path), before);
        await assert.rejects(handle.read(0, 1), code("EISDIR", "read"));
      } finally { await handle.close(); }
      assert.deepEqual(usage(filesystem), retained);
    });
  }
}

test("Memory directory EOF stays on the retained inode across rename, removal and file replacement", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/d");
  await filesystem.mkdir("/d/child");
  await filesystem.symlink("d", "/s");
  const handle = await filesystem.openReadFile("/s", { allowDirectory: true });
  try {
    assert.equal(typeof handle.seekEnd, "function");
    const original = await handle.stat();
    await filesystem.rename("/d", "/old");
    await filesystem.writeFile("/d", Uint8Array.of(9));
    await filesystem.rm("/s");
    await filesystem.symlink("d", "/s");
    await filesystem.chmod("/old", 0);
    assert.equal(await handle.seekEnd!(), 9223372036854775807n);
    assert.equal((await handle.stat()).ino, original.ino);
    await filesystem.chmod("/old", 0o700);
    await filesystem.rm("/old", { recursive: true });
    const removed = await handle.stat();
    assert.equal(removed.nlink, 0);
    assert.equal(removed.ino, original.ino);
    assert.equal(removed.identityScope, original.identityScope);
    assert.deepEqual(await filesystem.readFile("/d"), Uint8Array.of(9));
    for (const name of ["stat", "lstat", "realpath", "resolve", "openReadFile"]) {
      Object.defineProperty(filesystem, name, { value() { assert.fail(`unexpected ${name} dispatch`); } });
    }
    assert.equal(await handle.seekEnd!(), 9223372036854775807n);
    assert.deepEqual(await handle.stat(), removed);
    await assert.rejects(handle.read(0, 1), code("EISDIR"));
  } finally { await handle.close(); }
});

for (const allowDirectory of [false, true]) {
  test(`Memory retained file EOF follows live inode data, not pathname or snapshots: ${allowDirectory}`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/f", Uint8Array.of(1, 2, 3));
    await filesystem.link("/f", "/alias");
    const reader = await filesystem.openReadFile("/f", { allowDirectory });
    const writer = await filesystem.openResizeFile("/f");
    try {
      assert.equal(typeof reader.seekEnd, "function");
      assert.equal(typeof writer.seekEnd, "function");
      const original = await reader.stat();
      Reflect.set(original, "size", 99);
      assert.equal(await reader.seekEnd!(), 3n);
      assert.equal(await writer.seekEnd!(), 3n);
      assert.deepEqual(await reader.read(0, 2), Uint8Array.of(1, 2));
      await filesystem.rename("/f", "/old");
      await filesystem.writeFile("/f", Uint8Array.of(9));
      await filesystem.appendFile("/alias", Uint8Array.of(4));
      assert.equal(await reader.seekEnd!(), 4n);
      assert.equal(await writer.seekEnd!(), 4n);
      await filesystem.rm("/old");
      await filesystem.rm("/alias");
      assert.deepEqual(await filesystem.readFile("/f"), Uint8Array.of(9));
      for (const name of ["stat", "lstat", "realpath", "resolve", "openReadFile", "openResizeFile"]) {
        Object.defineProperty(filesystem, name, { value() { assert.fail(`unexpected ${name} dispatch`); } });
      }
      await writer.truncate(6);
      assert.equal(await reader.seekEnd!(), 6n);
      assert.equal(await writer.seekEnd!(), 6n);
      assert.deepEqual(await reader.read(0, 6), Uint8Array.of(1, 2, 3, 4, 0, 0));
      await writer.truncate(0);
      assert.equal(await reader.seekEnd!(), 0n);
      assert.equal(await writer.seekEnd!(), 0n);
      assert.equal((await reader.stat()).ino, original.ino);
      assert.equal((await writer.stat()).nlink, 0);
    } finally { await reader.close(); await writer.close(); }
  });
}

for (const kind of ["directory", "reader", "writer"] as const) {
  test(`Memory retained ${kind} EOF has closed admission and releases ownership once`, async () => {
    const filesystem = new MemoryFileSystem();
    if (kind === "directory") await filesystem.mkdir("/f");
    else await filesystem.writeFile("/f", Uint8Array.of(1, 2, 3));
    const handle = kind === "writer" ? await filesystem.openResizeFile("/f")
      : await filesystem.openReadFile("/f", { allowDirectory: true });
    try {
      assert.equal(typeof handle.seekEnd, "function");
      const admitted = handle.seekEnd!();
      await filesystem.rm("/f", { recursive: true });
      const close = handle.close();
      assert.equal(handle.close(), close);
      assert.equal(await admitted, kind === "directory" ? 9223372036854775807n : 3n);
      await assert.rejects(handle.seekEnd!(), code("EBADF", "lseek"));
      await close;
      await assert.rejects(handle.seekEnd!(), code("EBADF", "lseek"));
      assert.deepEqual(usage(filesystem), { bytes: 0, units: 1 });
    } finally { await handle.close(); }
  });

  test(`Memory retained ${kind} EOF rejects close during operation-options access`, async () => {
    const filesystem = new MemoryFileSystem();
    if (kind === "directory") await filesystem.mkdir("/f");
    else await filesystem.writeFile("/f", Uint8Array.of(1));
    const handle = kind === "writer" ? await filesystem.openResizeFile("/f")
      : await filesystem.openReadFile("/f", { allowDirectory: true });
    try {
      assert.equal(typeof handle.seekEnd, "function");
      const controller = new AbortController();
      await assert.rejects(handle.seekEnd!({ get signal() { void handle.close(); return controller.signal; } }), code("EBADF", "lseek"));
    } finally { await handle.close(); }
  });

  for (const reason of [null, false, 0, "", NaN, new Error("cancel seek")]) {
    test(`Memory retained ${kind} EOF preserves cancellation identity: ${String(reason)}`, async () => {
      const filesystem = new MemoryFileSystem();
      if (kind === "directory") await filesystem.mkdir("/f");
      else await filesystem.writeFile("/f", Uint8Array.of(1));
      const handle = kind === "writer" ? await filesystem.openResizeFile("/f")
        : await filesystem.openReadFile("/f", { allowDirectory: true });
      try {
        assert.equal(typeof handle.seekEnd, "function");
        const before = await handle.stat();
        const retained = usage(filesystem);
        const controller = new AbortController();
        const options = { get signal() { controller.abort(reason); return controller.signal; } };
        await assert.rejects(handle.seekEnd!(options), error => Object.is(error, reason));
        assert.deepEqual(await handle.stat(), before);
        assert.deepEqual(usage(filesystem), retained);
        assert.equal(await handle.seekEnd!(), kind === "directory" ? 9223372036854775807n : 1n);
        await handle.close();
        await assert.rejects(handle.seekEnd!({ signal: controller.signal }), error => Object.is(error, reason));
      } finally { await handle.close(); }
    });
  }
}

test("Memory directory EOF does not consume file allocation or relax read/write admission", async () => {
  const filesystem = new MemoryFileSystem({ maxFileBytes: 0, maxRetainedBytes: 6, maxMetadataUnits: 4 });
  await filesystem.mkdir("/d");
  await assert.rejects(filesystem.openReadFile("/d"), code("EISDIR"));
  await assert.rejects(filesystem.openReadFile("/d", { allowDirectory: false }), code("EISDIR"));
  await assert.rejects(filesystem.readFile("/d"), code("EISDIR"));
  await assert.rejects(filesystem.readStream("/d")[Symbol.asyncIterator]().next(), code("EISDIR"));
  await assert.rejects(filesystem.openResizeFile("/d"), code("EISDIR"));
  await filesystem.chmod("/d", 0);
  await assert.rejects(filesystem.openReadFile("/d", { allowDirectory: true }), code("EACCES"));
  await filesystem.chmod("/d", 0o400);
  const handle = await filesystem.openReadFile("/d", { allowDirectory: true });
  try {
    assert.equal(typeof handle.seekEnd, "function");
    await filesystem.chmod("/d", 0);
    assert.equal(await handle.seekEnd!(), 9223372036854775807n);
    await assert.rejects(filesystem.openReadFile("/d", { allowDirectory: true }), code("EACCES"));
    assert.deepEqual(usage(filesystem), { bytes: 6, units: 4 });
  } finally { await handle.close(); }
  assert.deepEqual(usage(filesystem), { bytes: 2, units: 3 });
});

for (const method of ["openReadFile", "openResizeFile"] as const) {
  for (const property of ["root", "ledger", "stat", "resolve", "snapshot", "releaseReference"]) {
    test(`Memory retained seek admission preserves ${method} ${property} guard`, async () => {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/f", Uint8Array.of(1));
      const before = usage(filesystem);
      const acquire = filesystem[method].bind(filesystem);
      let dispatched = false;
      Object.defineProperty(filesystem, property, { value() { dispatched = true; assert.fail("override dispatched"); } });
      await assert.rejects(acquire("/f"), code("ENOTSUP"));
      assert.equal(dispatched, false);
      if (property !== "ledger") assert.deepEqual(usage(filesystem), before);
    });
  }
}

test("Memory retained EOF does not acquire replacement paths or require renewed file permissions", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/f", Uint8Array.of(1), { mode: 0o600 });
  const reader: FileReadHandle = await filesystem.openReadFile("/f");
  const writer: FileResizeHandle = await filesystem.openResizeFile("/f");
  try {
    assert.equal(typeof reader.seekEnd, "function");
    assert.equal(typeof writer.seekEnd, "function");
    await filesystem.chmod("/f", 0);
    await assert.rejects(filesystem.openReadFile("/f"), code("EACCES"));
    await assert.rejects(filesystem.openResizeFile("/f"), code("EACCES"));
    assert.equal(await reader.seekEnd!(), 1n);
    assert.equal(await writer.seekEnd!(), 1n);
    await writer.truncate(2);
    assert.equal(await reader.seekEnd!(), 2n);
    assert.deepEqual(await reader.read(0, 2), Uint8Array.of(1, 0));
  } finally { await reader.close(); await writer.close(); }
});
