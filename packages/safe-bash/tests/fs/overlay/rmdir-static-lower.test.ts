import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { encode, immutable, snapshot, wrapped } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const merged of [false, true]) {
  test(`static lower hidden descendants, merged=${merged}: removal and recreation preserve every lower entry`, async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.mkdir("/tree/deep", { recursive: true });
    await lower.writeFile("/tree/deep/child", encode("hidden physical lower bytes"));
    await lower.writeFile("/sibling", encode("untouched"));
    if (merged) await upper.mkdir("/tree");
    const lowerBefore = await snapshot(lower);
    const protectedLower = immutable(lower);
    const overlay = createOverlayFileSystem({ upper, lower: protectedLower.lower });
    await overlay.rm("/tree/deep", { recursive: true });
    assert.deepEqual(await overlay.readdir("/tree"), []);
    await overlay.rmdir("/tree");
    await assert.rejects(overlay.stat("/tree"), { code: "ENOENT" });
    await assert.rejects(overlay.readFile("/tree/deep/child"), { code: "ENOENT" });
    assert.deepEqual(await snapshot(lower), lowerBefore);
    await overlay.mkdir("/tree");
    assert.deepEqual(await overlay.readdir("/tree"), []);
    await overlay.writeFile("/tree/new", encode("new upper bytes"));
    assert.deepEqual(await overlay.readdir("/tree"), [{ name: "new", type: "file" }]);
    assert.deepEqual(await overlay.readFile("/tree/new"), encode("new upper bytes"));
    await assert.rejects(overlay.rmdir("/tree"), { code: "ENOTEMPTY", syscall: "rmdir", path: "/tree" });
    assert.deepEqual(await snapshot(lower), lowerBefore);
    assert.deepEqual(protectedLower.mutations, []);
  });
}

test("lower-only whiteout removal needs no upper deletion primitive or parent copy-up", async () => {
  const lower = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await lower.mkdir("/parent/empty", { recursive: true });
  await lower.writeFile("/parent/sibling", encode("preserved"));
  const before = await snapshot(lower);
  const provider = new Proxy(upper, {
    get(target, property) {
      if (property === "rmdir") return undefined;
      if (["rm", "mkdir", "rename", "writeFile"].includes(String(property))) return () => assert.fail(`unexpected ${String(property)}`);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const protectedLower = immutable(lower);
  const overlay = createOverlayFileSystem({ upper: provider, lower: protectedLower.lower });
  await overlay.rmdir("/parent/empty/");
  await assert.rejects(overlay.stat("/parent/empty"), { code: "ENOENT" });
  assert.deepEqual(await overlay.readdir("/parent"), [{ name: "sibling", type: "file" }]);
  assert.deepEqual(await upper.readdir("/"), []);
  assert.deepEqual(await snapshot(lower), before);
  assert.deepEqual(protectedLower.mutations, []);
});

test("a hidden physical upper child is not removed through a recursive fallback", async () => {
  const lower = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await upper.mkdir("/empty");
  await upper.writeFile("/empty/hidden", encode("physical upper child"));
  await lower.mkdir("/empty");
  const before = await snapshot(lower);
  let calls = 0;
  const overlay = createOverlayFileSystem({ upper: wrapped(upper, {
    async readdir(path, options) { return path === "/empty" ? [] : upper.readdir(path, options); },
    async rmdir(path, options) { calls++; return upper.rmdir(path, options); },
    async rm() { assert.fail("recursive fallback"); },
    async rename() { assert.fail("staged deletion"); },
  }), lower });
  await assert.rejects(overlay.rmdir("/empty"), { code: "ENOTEMPTY", syscall: "rmdir", path: "/empty" });
  assert.equal(calls, 1);
  assert.deepEqual(await upper.readFile("/empty/hidden"), encode("physical upper child"));
  assert.equal((await overlay.stat("/empty")).type, "directory");
  assert.deepEqual(await snapshot(lower), before);
});

for (const merged of [false, true]) {
  test(`same-instance child queued before removal, merged=${merged}, survives with ENOTEMPTY`, async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.mkdir("/empty");
    if (merged) await upper.mkdir("/empty");
    const before = await snapshot(lower);
    const overlay = createOverlayFileSystem({ upper, lower });
    const writing = overlay.writeFile("/empty/child", encode("queued child"));
    const removing = overlay.rmdir("/empty");
    await Promise.all([writing, assert.rejects(removing, { code: "ENOTEMPTY", syscall: "rmdir", path: "/empty" })]);
    assert.deepEqual(await overlay.readFile("/empty/child"), encode("queued child"));
    assert.deepEqual(await snapshot(lower), before);
  });
}

for (const recreate of [false, true]) {
  test(`same-instance child queued after lower removal, recreate=${recreate}, follows namespace order`, { timeout: 2_000 }, async () => {
    const lower = new MemoryFileSystem();
    const upper = new MemoryFileSystem();
    await lower.mkdir("/empty");
    const before = await snapshot(lower);
    const entered = deferred();
    const release = deferred();
    let firstListing = true;
    const overlay = createOverlayFileSystem({ upper, lower: wrapped(lower, {
      async readdir(path, options) {
        if (path === "/empty" && firstListing) {
          firstListing = false;
          entered.resolve();
          await release.promise;
        }
        return lower.readdir(path, options);
      },
    }) });
    const removing = overlay.rmdir("/empty");
    await entered.promise;
    const creating = recreate ? overlay.mkdir("/empty") : Promise.resolve();
    const writing = overlay.writeFile("/empty/child", encode("queued child"));
    const expectedWriting = recreate ? writing : assert.rejects(writing, { code: "ENOENT" });
    release.resolve();
    await Promise.all([removing, creating, expectedWriting]);
    if (recreate) {
      assert.deepEqual(await overlay.readdir("/empty"), [{ name: "child", type: "file" }]);
      assert.deepEqual(await overlay.readFile("/empty/child"), encode("queued child"));
    } else {
      await assert.rejects(overlay.stat("/empty"), { code: "ENOENT" });
      await assert.rejects(upper.stat("/empty"), { code: "ENOENT" });
    }
    assert.deepEqual(await snapshot(lower), before);
  });
}
