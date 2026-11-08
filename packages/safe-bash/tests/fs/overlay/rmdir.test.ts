import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { encode, immutable, snapshot, wrapped } from "./helpers.js";

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
  test(`overlay static lower directory, merged=${merged}: removes only the visible empty directory`, async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    await lower.mkdir("/empty");
    await lower.mkdir("/sibling/deep", { recursive: true });
    await lower.writeFile("/sibling/deep/child", encode("unchanged lower sibling"));
    if (merged) await upper.mkdir("/empty");
    const before = await snapshot(lower);
    let removals = 0;
    const protectedLower = immutable(lower);
    const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
      async rmdir(path, options) { removals++; return upper.rmdir(path, options); },
      async rm() { assert.fail("recursive deletion"); },
      async rename() { assert.fail("staged rename"); },
      async mkdir() { assert.fail("staged mkdir"); },
    }), lower: protectedLower.lower });
    await overlay.rmdir("/empty");
    assert.equal(removals, merged ? 1 : 0);
    await assert.rejects(overlay.stat("/empty"), { code: "ENOENT" });
    await assert.rejects(upper.stat("/empty"), { code: "ENOENT" });
    assert.deepEqual(await overlay.readdir("/"), [{ name: "sibling", type: "directory" }]);
    assert.deepEqual(await snapshot(lower), before);
    assert.deepEqual(protectedLower.mutations, []);
  });
}

test("overlay preexisting upper-only empty directory is removable above unchanged lower storage", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await upper.mkdir("/empty");
  await lower.writeFile("/sibling", encode("unchanged lower file"));
  const before = await snapshot(lower);
  const overlay = createOverlayFileSystem({ upper, lower: immutable(lower).lower });
  await overlay.rmdir("/empty");
  await assert.rejects(overlay.stat("/empty"), { code: "ENOENT" });
  await assert.rejects(upper.stat("/empty"), { code: "ENOENT" });
  assert.deepEqual(await snapshot(lower), before);
  await overlay.mkdir("/empty");
  await overlay.writeFile("/empty/new", encode("recreated upper child"));
  assert.deepEqual(await overlay.readFile("/empty/new"), encode("recreated upper child"));
  assert.deepEqual(await snapshot(lower), before);
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
