import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { encode, immutable, wrapped } from "./helpers.js";

function errorCode(code: string, path: string) {
  return (error: unknown) => {
    assert.ok(error instanceof FsError);
    assert.equal(error.code, code);
    assert.equal(error.syscall, "rmdir");
    assert.equal(error.path, path);
    return true;
  };
}

test("overlay rmdir uses only backing rmdir and preserves whiteouted lower descendants", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await lower.mkdir("/tree");
  await lower.writeFile("/tree/old", encode("lower bytes"));
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let armed = false;
  let calls = 0;
  const protectedLower = immutable(lower);
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rm(path, received) { assert.equal(armed, false, "no recursive rm while rmdir runs"); return upper.rm(path, received); },
    async rmdir(path, received) {
      calls++;
      assert.equal(path, "/tree");
      assert.equal(received, options);
      return upper.rmdir(path, received);
    },
  }), lower: protectedLower.lower });
  await overlay.rm("/tree", { recursive: true });
  await overlay.mkdir("/tree");
  armed = true;
  await overlay.rmdir("/tree/", options);
  assert.equal(calls, 1);
  await assert.rejects(overlay.stat("/tree"), { code: "ENOENT" });
  assert.deepEqual(await lower.readFile("/tree/old"), encode("lower bytes"));
  assert.deepEqual(protectedLower.mutations, []);
  armed = false;
  await overlay.mkdir("/tree");
  assert.deepEqual(await overlay.readdir("/tree"), []);
  assert.deepEqual(await lower.readFile("/tree/old"), encode("lower bytes"));
});

for (const [path, code] of [["/missing", "ENOENT"], ["/file", "ENOTDIR"], ["/link", "ENOTDIR"],
  ["/link/", "ENOTDIR"], ["/tree", "ENOTEMPTY"], ["/", "EBUSY"], ["/empty/.", "EINVAL"]] as const) {
  test(`overlay rmdir ${path} reports ${code} without hiding descendants`, async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    await lower.mkdir("/tree/deep", { recursive: true });
    await lower.writeFile("/tree/deep/file", encode("preserved"));
    const overlay = createOverlayFileSystem({ upper, lower });
    await overlay.mkdir("/empty");
    await overlay.writeFile("/file", encode("preserved"));
    await overlay.symlink("/empty", "/link");
    await assert.rejects(overlay.rmdir(path), errorCode(code, path));
    assert.deepEqual(await overlay.readFile("/tree/deep/file"), encode("preserved"));
    assert.deepEqual(await lower.readFile("/tree/deep/file"), encode("preserved"));
    assert.equal(await overlay.readlink("/link"), "/empty");
  });
}

test("overlay rmdir retains a raced upper child and does not publish a whiteout", async () => {
  const upper = new MemoryFileSystem();
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rmdir(path, options) {
      await upper.writeFile(`${path}/child`, encode("raced child"));
      return upper.rmdir(path, options);
    },
  }), lower: new MemoryFileSystem() });
  await overlay.mkdir("/empty");
  await assert.rejects(overlay.rmdir("/empty"), errorCode("ENOTEMPTY", "/empty"));
  assert.deepEqual(await overlay.readFile("/empty/child"), encode("raced child"));
  assert.deepEqual(await upper.readFile("/empty/child"), encode("raced child"));
});

for (const merged of [false, true]) {
  test(`overlay live lower directory, merged=${merged}: refuses stale emptiness without hiding a new child`, async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    await lower.mkdir("/empty");
    if (merged) await upper.mkdir("/empty");
    let removals = 0;
    const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
      async rmdir() { removals++; assert.fail("unprotected merged removal"); },
      async rm() { assert.fail("recursive deletion"); },
    }), lower: wrapped(lower, {
      async readdir(path, options) {
        const entries = await lower.readdir(path, options);
        if (path === "/empty") await lower.writeFile("/empty/child", encode("raced lower child"));
        return entries;
      },
      async rmdir() { assert.fail("lower mutation"); },
      async rm() { assert.fail("lower mutation"); },
    }) });
    await assert.rejects(overlay.rmdir("/empty"), errorCode("ENOTSUP", "/empty"));
    assert.equal(removals, 0);
    assert.deepEqual(await overlay.readFile("/empty/child"), encode("raced lower child"));
    assert.deepEqual(await lower.readFile("/empty/child"), encode("raced lower child"));
    if (merged) assert.equal((await upper.stat("/empty")).type, "directory");
  });
}

test("overlay cannot infer immutable lower storage from readOnly capability or current absence", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await upper.mkdir("/empty");
  const overlay = createOverlayFileSystem({ upper, lower: immutable(lower).lower });
  await assert.rejects(overlay.rmdir("/empty"), errorCode("ENOTSUP", "/empty"));
  assert.equal((await upper.stat("/empty")).type, "directory");
  await lower.mkdir("/empty");
  await lower.writeFile("/empty/new", encode("visible new child"));
  assert.deepEqual(await overlay.readFile("/empty/new"), encode("visible new child"));
});

test("overlay missing backing rmdir refuses without staging or changing namespace", async () => {
  const upper = new MemoryFileSystem();
  const provider = new Proxy(upper, {
    get(target, property) {
      if (property === "rmdir") return undefined;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const overlay = createOverlayFileSystem({ upper: provider, lower: new MemoryFileSystem() });
  await overlay.mkdir("/empty");
  const names = await upper.readdir("/");
  await assert.rejects(overlay.rmdir("/empty"), errorCode("ENOTSUP", "/empty"));
  assert.deepEqual(await upper.readdir("/"), names);
  assert.equal((await overlay.stat("/empty")).type, "directory");
});

test("overlay rmdir propagates provider errors, cancellation and readonly denial", async () => {
  const upper = new MemoryFileSystem();
  let calls = 0;
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rmdir() { calls++; throw new FsError("ENOSPC"); },
  }), lower: new MemoryFileSystem() });
  await overlay.mkdir("/empty");
  await assert.rejects(overlay.rmdir("/empty"), errorCode("ENOSPC", "/empty"));
  assert.equal(calls, 1);
  assert.equal((await overlay.stat("/empty")).type, "directory");
  const reason = new Error("cancel overlay directory removal");
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(overlay.rmdir("/empty", { signal: controller.signal }), (error) => error === reason);
  assert.equal(calls, 1);
  const readonly = createOverlayFileSystem({ upper: immutable(upper).lower, lower: new MemoryFileSystem() });
  await assert.rejects(readonly.rmdir("/empty"), errorCode("EROFS", "/empty"));
});

test("overlay rmdir never retries recursive garbage cleanup", async () => {
  const upper = new MemoryFileSystem();
  let cleanupCalls = 0;
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async rm() { cleanupCalls++; throw new FsError("EACCES"); },
  }), lower: new MemoryFileSystem() });
  await overlay.mkdir("/empty");
  const before = await upper.readdir("/");
  assert.ok(before.some((entry) => entry.name.startsWith(".virtual-bash-overlay-")));
  cleanupCalls = 0;
  await overlay.rmdir("/empty");
  assert.equal(cleanupCalls, 0);
  assert.deepEqual(await upper.readdir("/"), before.filter((entry) => entry.name !== "empty"));
});
