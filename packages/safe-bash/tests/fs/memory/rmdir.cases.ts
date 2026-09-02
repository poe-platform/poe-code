import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

const bytes = new TextEncoder().encode("preserved child");

test("memory rmdir removes only empty directories without consulting rm or readdir", async () => {
  class GuardedMemory extends MemoryFileSystem {
    override async rm(): Promise<never> { assert.fail("rm fallback"); }
    override async readdir(): Promise<never> { assert.fail("yielding emptiness probe"); }
  }
  const filesystem = new GuardedMemory();
  await filesystem.mkdir("/empty");
  await filesystem.rmdir("/empty/");
  await assert.rejects(filesystem.stat("/empty"), { code: "ENOENT" });
});

for (const [path, code] of [["/missing", "ENOENT"], ["/file", "ENOTDIR"], ["/link", "ENOTDIR"],
  ["/link/", "ENOTDIR"], ["/tree", "ENOTEMPTY"], ["/", "EBUSY"], ["/empty/.", "EINVAL"]] as const) {
  test(`memory rmdir ${path} reports ${code} with its exact operand`, async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/empty");
    await filesystem.mkdir("/tree/deep", { recursive: true });
    await filesystem.writeFile("/tree/deep/child", bytes);
    await filesystem.writeFile("/file", bytes);
    await filesystem.symlink("/empty", "/link");
    await assert.rejects(filesystem.rmdir(path), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, code);
      assert.equal(error.syscall, "rmdir");
      assert.equal(error.path, path);
      return true;
    });
    assert.deepEqual(await filesystem.readFile("/tree/deep/child"), bytes);
    assert.deepEqual(await filesystem.readFile("/file"), bytes);
    assert.equal(await filesystem.readlink("/link"), "/empty");
    assert.equal((await filesystem.stat("/empty")).type, "directory");
  });
}

test("memory rmdir and child creation cannot interleave emptiness check and deletion", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/empty");
  const removing = filesystem.rmdir("/empty");
  const adding = filesystem.writeFile("/empty/child", bytes);
  await Promise.all([removing, assert.rejects(adding, { code: "ENOENT" })]);
  await filesystem.mkdir("/empty");
  const childFirst = filesystem.writeFile("/empty/child", bytes);
  const removeSecond = filesystem.rmdir("/empty");
  await Promise.all([childFirst, assert.rejects(removeSecond, { code: "ENOTEMPTY" })]);
  assert.deepEqual(await filesystem.readFile("/empty/child"), bytes);
});

test("memory rmdir preserves directories on cancellation and parent permission denial", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/parent/empty", { recursive: true });
  const controller = new AbortController();
  const reason = new Error("cancel directory removal");
  controller.abort(reason);
  await assert.rejects(filesystem.rmdir("/parent/empty", { signal: controller.signal }), (error) => error === reason);
  await filesystem.chmod("/parent", 0o500);
  await assert.rejects(filesystem.rmdir("/parent/empty"), { code: "EACCES" });
  assert.equal((await filesystem.stat("/parent/empty")).type, "directory");
});

test("memory rm semantics remain unchanged for an empty directory", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/empty");
  await assert.rejects(filesystem.rm("/empty"), { code: "EISDIR" });
  await filesystem.rm("/empty", { recursive: true });
});
