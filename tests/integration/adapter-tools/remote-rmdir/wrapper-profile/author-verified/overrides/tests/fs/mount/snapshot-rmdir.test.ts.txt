import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, FsError, MemoryFileSystem, MountFileSystem, Shell, type FileSystem, type FsOptions } from "../../../src/index.js";

function forwarding(current: () => FileSystem): FileSystem {
  return new Proxy({} as FileSystem, {
    get(_target, property) {
      const backend = current();
      const value: unknown = Reflect.get(backend, property);
      return typeof value === "function" ? value.bind(backend) : value;
    },
  });
}

function snapshotBackend(storage: MemoryFileSystem, remove?: FileSystem["rmdir"]): FileSystem {
  return new Proxy(storage, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, snapshotRmdir: true };
      if (property === "rmdir" && remove) return remove;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("mount advertises snapshot rmdir through flattened nested mounts without weakening strict paths", async () => {
  const storage = new MemoryFileSystem();
  await storage.mkdir("/empty");
  const strict = new MemoryFileSystem();
  await strict.mkdir("/strict/child", { recursive: true });
  const inner = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/snapshot": snapshotBackend(storage) } });
  const outer = new MountFileSystem({ root: strict, mounts: { "/nested": inner } });
  assert.equal(inner.capabilities.snapshotRmdir, true);
  assert.equal(outer.capabilities.snapshotRmdir, true);
  assert.ok(Object.isFrozen(outer.capabilities));
  await outer.rmdir("/nested/snapshot/empty");
  await assert.rejects(storage.stat("/empty"), { code: "ENOENT" });
  await assert.rejects(outer.rmdir("/strict"), { code: "ENOTEMPTY", path: "/strict", syscall: "rmdir" });
  await assert.rejects(outer.rmdir("/nested/snapshot"), { code: "EBUSY" });
  assert.equal((await strict.stat("/strict/child")).type, "directory");
});

test("mount live profile tracks a snapshot mount added behind an existing routed host facade", async () => {
  const strict = new MemoryFileSystem();
  const storage = new MemoryFileSystem();
  await storage.mkdir("/empty");
  let current: FileSystem = new MountFileSystem({ root: strict });
  const outer = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/dynamic": forwarding(() => current) } });
  const capabilities = outer.capabilities;
  assert.notEqual(capabilities.snapshotRmdir, true);
  current = new MountFileSystem({ root: strict, mounts: { "/added": snapshotBackend(storage) } });
  assert.equal(capabilities.snapshotRmdir, true, "an already retained capabilities object stays truthful");
  await outer.rmdir("/dynamic/added/empty");
  await assert.rejects(storage.stat("/empty"), { code: "ENOENT" });
  current = new MountFileSystem({ root: strict });
  assert.notEqual(capabilities.snapshotRmdir, true);
});

test("mount actual Shell preserves a late child after snapshot delegate success", async () => {
  for (const command of ["rmdir", "rm -d"]) {
    const storage = new MemoryFileSystem();
    await storage.mkdir("/empty");
    let removals = 0;
    const backend = snapshotBackend(storage, async (path, options) => {
      assert.ok(options?.signal);
      assert.equal(path, "/empty");
      removals++;
      await storage.writeFile("/empty/late", new Uint8Array([0, 128, 255]), options);
    });
    const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/disk": backend } });
    const shell = new Shell({ fs: filesystem }).use(agentCommands());
    try {
      assert.equal(filesystem.capabilities.snapshotRmdir, true);
      const result = await shell.exec(`${command} /disk/empty`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(removals, 1);
      assert.deepEqual(await filesystem.readFile("/disk/empty/late"), new Uint8Array([0, 128, 255]));
    } finally {
      await shell.dispose();
    }
  }
});

test("snapshot mount retains signal identity, error paths and pre-aborted errno-shaped reasons", async () => {
  const storage = new MemoryFileSystem();
  await storage.mkdir("/empty");
  const controller = new AbortController();
  const options: FsOptions = { signal: controller.signal };
  let calls = 0;
  const filesystem = new MountFileSystem({ root: new MemoryFileSystem(), mounts: {
    "/disk": snapshotBackend(storage, async (_path, received) => {
      calls++;
      assert.equal(received, options);
      throw new FsError("EACCES", { path: "/empty" });
    }),
  } });
  await assert.rejects(filesystem.rmdir("/disk/empty", options), { code: "EACCES", syscall: "rmdir", path: "/disk/empty" });
  const reason = new FsError("ENOENT");
  controller.abort(reason);
  await assert.rejects(filesystem.rmdir("/disk/empty", options), error => error === reason);
  assert.equal(calls, 1);
  assert.equal((await storage.stat("/empty")).type, "directory");
});
