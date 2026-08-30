import assert from "node:assert/strict";
import test from "node:test";
import { FsError, MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem } from "../../../src/index.js";

test("readonly snapshot delegate refuses before options, path checks and delegate access without claiming the profile", async () => {
  const storage = new MemoryFileSystem();
  await storage.mkdir("/empty");
  let calls = 0;
  const backend = new Proxy(storage, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, snapshotRmdir: true };
      if (property === "rmdir" || property === "rm") return async () => { calls++; assert.fail("readonly delegation"); };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const readonly = new ReadOnlyFileSystem(backend);
  assert.notEqual(readonly.capabilities.snapshotRmdir, true);
  const controller = new AbortController();
  controller.abort(new FsError("ENOENT"));
  for (const path of ["/empty", "/missing", "/", "\0"]) {
    await assert.rejects(readonly.rmdir(path, { signal: controller.signal }), { code: "EROFS", syscall: "rmdir", path });
    await assert.rejects(readonly.rmdir(path, { get signal() { return assert.fail("readonly options read"); } }), { code: "EROFS", path });
  }
  const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/readonly": readonly } });
  assert.notEqual(mount.capabilities.snapshotRmdir, true);
  await assert.rejects(mount.rmdir("/readonly/empty"), { code: "EROFS", path: "/readonly/empty" });
  await assert.rejects(mount.rmdir("/readonly/empty", { signal: controller.signal }), error => error === controller.signal.reason);
  assert.equal(calls, 0);
  assert.equal((await storage.stat("/empty")).type, "directory");
});
