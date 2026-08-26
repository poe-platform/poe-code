import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { FsOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

test("readonly rmdir always rejects before delegate access, path checks, or options access", async () => {
  class GuardedMemory extends MemoryFileSystem {
    override async rmdir(): Promise<never> { assert.fail("rmdir delegate"); }
    override async rm(): Promise<never> { assert.fail("rm delegate"); }
  }
  const backing = new GuardedMemory();
  await backing.mkdir("/empty");
  const filesystem = createReadOnlyFileSystem(backing);
  const options: FsOptions = { get signal() { return assert.fail("options read before readonly denial"); } };
  for (const path of ["/empty", "relative/../missing", "", "\0"]) {
    await assert.rejects(filesystem.rmdir(path, options), (error: unknown) => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, "EROFS");
      assert.equal(error.path, path);
      assert.equal(error.syscall, "rmdir");
      return true;
    });
  }
  assert.equal((await backing.stat("/empty")).type, "directory");
});
