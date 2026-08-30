import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { FsOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

const bytes = new TextEncoder().encode("preserved descendant");

function errorCode(code: string, path: string) {
  return (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, path);
    return true;
  };
}

test("mount rmdir routes nested mounts with the original signal and no rm fallback", async () => {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let calls = 0;
  class Backing extends MemoryFileSystem {
    override async rm(): Promise<never> { assert.fail("rm fallback"); }
    override async rmdir(path: string, received?: FsOptions): Promise<void> {
      calls++;
      assert.equal(path, "/empty");
      assert.equal(received, options);
      return super.rmdir(path, received);
    }
  }
  const backing = new Backing();
  await backing.mkdir("/empty");
  const nested = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/deep": backing } });
  const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/disk": nested } });
  await mount.rmdir("/disk/deep/empty/", options);
  assert.equal(calls, 1);
  await assert.rejects(backing.stat("/empty"), { code: "ENOENT" });
});

for (const [path, code] of [["/disk/missing", "ENOENT"], ["/disk/file", "ENOTDIR"],
  ["/disk/link", "ENOTDIR"], ["/disk/link/", "ENOTDIR"], ["/disk/tree", "ENOTEMPTY"],
  ["/disk", "EBUSY"], ["/disk/empty/.", "EINVAL"]] as const) {
  test(`mount rmdir ${path} reports ${code} and preserves descendants`, async () => {
    const backing = new MemoryFileSystem();
    await backing.mkdir("/tree/deep", { recursive: true });
    await backing.writeFile("/tree/deep/file", bytes);
    await backing.writeFile("/file", bytes);
    await backing.mkdir("/empty");
    await backing.symlink("/empty", "/link");
    const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/disk": backing } });
    await assert.rejects(mount.rmdir(path), errorCode(code, path));
    assert.deepEqual(await backing.readFile("/tree/deep/file"), bytes);
    assert.deepEqual(await backing.readFile("/file"), bytes);
    assert.equal(await backing.readlink("/link"), "/empty");
  });
}

test("mount rmdir preserves a child created at the delegate boundary", async () => {
  class Backing extends MemoryFileSystem {
    override async rm(): Promise<never> { assert.fail("rm fallback"); }
    override async rmdir(path: string, options?: FsOptions): Promise<void> {
      await this.writeFile(`${path}/child`, bytes);
      return super.rmdir(path, options);
    }
  }
  const backing = new Backing();
  await backing.mkdir("/empty");
  const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/disk": backing } });
  await assert.rejects(mount.rmdir("/disk/empty"), errorCode("ENOTEMPTY", "/disk/empty"));
  assert.deepEqual(await mount.readFile("/disk/empty/child"), bytes);
});

test("mount rmdir missing provider support fails ENOTSUP without inspecting children or using rm", async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/empty");
  const provider = new Proxy(backing, {
    get(target, property) {
      if (property === "rmdir") return undefined;
      if (property === "rm" || property === "readdir") return () => assert.fail(`unexpected ${property}`);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const mount = createMountFileSystem({ root: provider });
  await assert.rejects(mount.rmdir("/empty"), errorCode("ENOTSUP", "/empty"));
  assert.equal((await backing.stat("/empty")).type, "directory");
});

test("mount rmdir respects readonly mounts and protected synthetic ancestors", async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/empty");
  const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/ancestor/disk": createReadOnlyFileSystem(backing) } });
  await assert.rejects(mount.rmdir("/ancestor/disk/empty"), errorCode("EROFS", "/ancestor/disk/empty"));
  await assert.rejects(mount.rmdir("/ancestor"), errorCode("EBUSY", "/ancestor"));
  assert.equal((await backing.stat("/empty")).type, "directory");
});

test("mount rmdir propagates arbitrary delegate failures and cancellation without effects", async () => {
  const controller = new AbortController();
  let calls = 0;
  class Backing extends MemoryFileSystem {
    override async rmdir(): Promise<never> { calls++; throw new FsError("EIO"); }
  }
  const backing = new Backing();
  await backing.mkdir("/empty");
  const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/disk": backing } });
  await assert.rejects(mount.rmdir("/disk/empty"), errorCode("EIO", "/disk/empty"));
  assert.equal(calls, 1);
  const reason = new Error("cancel mounted directory removal");
  controller.abort(reason);
  await assert.rejects(mount.rmdir("/disk/empty", { signal: controller.signal }), (error) => error === reason);
  assert.equal(calls, 1);
  assert.equal((await backing.stat("/empty")).type, "directory");
});
