import assert from "node:assert/strict";
import test from "node:test";
import { FsError, MemoryFileSystem, MountFileSystem, createOverlayFileSystem, type FileSystem } from "../../../src/index.js";
import { encode, snapshot, wrapped } from "./helpers.js";

function snapshotUpper(storage: MemoryFileSystem, overrides: Partial<FileSystem> = {}): FileSystem {
  return wrapped(storage, { capabilities: { ...storage.capabilities, snapshotRmdir: true }, ...overrides });
}

for (const merged of [false, true]) {
  test(`snapshot upper refusal preserves late child visibility and prior whiteouts, merged=${merged}`, async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    await upper.mkdir("/empty");
    await lower.writeFile("/hidden", encode("old whiteout"));
    if (merged) await lower.mkdir("/empty");
    const lowerBefore = await snapshot(lower);
    let removals = 0;
    let injected = false;
    const overlay = createOverlayFileSystem({ lower, upper: snapshotUpper(upper, {
      async readdir(path, options) {
        const entries = await upper.readdir(path, options);
        if (path === "/empty" && !injected) {
          injected = true;
          await upper.mkdir("/empty/nested");
          await upper.writeFile("/empty/nested/late", encode("surviving child"));
        }
        return entries;
      },
      async rmdir() { removals++; },
    }) });
    await overlay.rm("/hidden");
    await assert.rejects(overlay.rmdir("/empty"), { code: "ENOTSUP", syscall: "rmdir", path: "/empty" });
    assert.equal(removals, 0, "refuse before marker removal, not after it");
    assert.equal(injected, true);
    assert.deepEqual(await overlay.readFile("/empty/nested/late"), encode("surviving child"));
    assert.deepEqual(await upper.readFile("/empty/nested/late"), encode("surviving child"));
    await assert.rejects(overlay.stat("/hidden"), { code: "ENOENT" });
    assert.deepEqual(await snapshot(lower), lowerBefore);
    assert.notEqual(overlay.capabilities.snapshotRmdir, true);
  });
}

test("snapshot upper refuses lower-only whiteout publication without mutation or copy-up", async () => {
  const upper = new MemoryFileSystem();
  const lower = new MemoryFileSystem();
  await lower.mkdir("/parent/empty", { recursive: true });
  const beforeUpper = await snapshot(upper);
  const beforeLower = await snapshot(lower);
  const overlay = createOverlayFileSystem({ lower, upper: snapshotUpper(upper, {
    async rmdir() { assert.fail("unexpected marker removal"); },
    async mkdir() { assert.fail("unexpected copy-up"); },
    async rm() { assert.fail("unexpected recursive removal"); },
  }) });
  await assert.rejects(overlay.rmdir("/parent/empty"), { code: "ENOTSUP" });
  assert.equal((await overlay.stat("/parent/empty")).type, "directory");
  assert.deepEqual(await snapshot(upper), beforeUpper);
  assert.deepEqual(await snapshot(lower), beforeLower);
});

for (const [path, code] of [["/tree", "ENOTEMPTY"], ["/file", "ENOTDIR"], ["/missing", "ENOENT"], ["/", "EBUSY"]] as const) {
  test(`snapshot upper keeps ${code} diagnostics and namespace for ${path}`, async () => {
    const upper = new MemoryFileSystem();
    await upper.mkdir("/tree/nested", { recursive: true });
    await upper.writeFile("/file", encode("unchanged"));
    const before = await snapshot(upper);
    const overlay = createOverlayFileSystem({ lower: new MemoryFileSystem(), upper: snapshotUpper(upper, {
      async rmdir() { assert.fail("unexpected marker removal"); },
    }) });
    await assert.rejects(overlay.rmdir(path), { code, syscall: "rmdir", path });
    assert.deepEqual(await snapshot(upper), before);
  });
}

test("overlay rechecks a snapshot profile enabled during the final emptiness observation", async () => {
  const upper = new MemoryFileSystem();
  await upper.mkdir("/empty");
  let enabled = false;
  const backend = wrapped(upper, {
    get capabilities() { return { ...upper.capabilities, snapshotRmdir: enabled }; },
    async readdir(path, options) {
      const result = await upper.readdir(path, options);
      if (path === "/empty") enabled = true;
      return result;
    },
    async rmdir() { assert.fail("profile must be rechecked before delegation"); },
  });
  const overlay = createOverlayFileSystem({ lower: new MemoryFileSystem(), upper: new MountFileSystem({ root: backend }) });
  await assert.rejects(overlay.rmdir("/empty"), { code: "ENOTSUP" });
  assert.equal((await overlay.stat("/empty")).type, "directory");
});

test("snapshot upper preserves pre-aborted cancellation and provider inspection errors", async () => {
  const upper = new MemoryFileSystem();
  await upper.mkdir("/empty");
  const overlay = createOverlayFileSystem({ lower: new MemoryFileSystem(), upper: snapshotUpper(upper, {
    async readdir() { throw new FsError("EACCES"); },
    async rmdir() { assert.fail("unexpected marker removal"); },
  }) });
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  controller.abort(reason);
  await assert.rejects(overlay.rmdir("/empty", { signal: controller.signal }), error => error === reason);
  await assert.rejects(overlay.rmdir("/empty"), { code: "EACCES", syscall: "rmdir", path: "/empty" });
  assert.equal((await upper.stat("/empty")).type, "directory");
});

for (const merged of [false, true]) {
  test(`strict upper retains removal over a static snapshot-capable lower, merged=${merged}`, async () => {
    const upper = new MemoryFileSystem();
    const lower = new MemoryFileSystem();
    await lower.mkdir("/empty");
    if (merged) await upper.mkdir("/empty");
    const before = await snapshot(lower);
    const overlay = createOverlayFileSystem({ upper, lower: snapshotUpper(lower, {
      async rmdir() { assert.fail("lower is never removed"); },
    }) });
    assert.notEqual(overlay.capabilities.snapshotRmdir, true);
    await overlay.rmdir("/empty");
    await assert.rejects(overlay.stat("/empty"), { code: "ENOENT" });
    assert.deepEqual(await snapshot(lower), before);
  });
}
