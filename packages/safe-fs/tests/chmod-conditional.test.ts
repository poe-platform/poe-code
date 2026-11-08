import assert from "node:assert/strict";
import { test } from "vitest";
import { FsError } from "../src/contracts/errors.js";
import type { FileSystem, FileStagingEntry } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";

async function fixture(kind: "memory" | "mount" | "overlay") {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work/sub", { recursive: true });
  await backing.writeFile("/work/sub/file", Uint8Array.of(17), { mode: 0o640 });
  const upper = new MemoryFileSystem();
  const fs: FileSystem = kind === "mount"
    ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mounted": backing } })
    : kind === "overlay" ? new OverlayFileSystem({ lower: new ReadOnlyFileSystem(backing), upper }) : backing;
  const path = `${kind === "mount" ? "/mounted" : ""}/work/sub/file`;
  const ancestors: FileStagingEntry[] = [];
  const parts = path.split("/").filter(Boolean);
  for (let count = 0; count < parts.length; count++) {
    const parent = `/${parts.slice(0, count).join("/")}`;
    ancestors.push({ path: parent, stat: await fs.lstat(parent) });
  }
  const options = { parent: ancestors.at(-1)!.stat, expected: await fs.lstat(path), ancestors };
  return { backing, upper, fs, path, options };
}

for (const kind of ["memory", "mount", "overlay"] as const) {
  test(`${kind} conditional chmod validates ancestry and changes only the selected mode`, async () => {
    const { backing, fs, path, options } = await fixture(kind);
    assert.equal(fs.capabilities.conditionalChmod, true);
    let guards = 0;
    await fs.chmod!(path, 0o600, { ...options, commitGuard() { guards++; return true; } });
    assert.ok(guards > 0);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readFile(path), Uint8Array.of(17));
    if (kind === "overlay") assert.equal((await backing.stat("/work/sub/file")).mode & 0o777, 0o640);
  });

  for (const replacement of ["parent", "target"] as const) {
    test(`${kind} conditional chmod refuses a replaced ${replacement} without changing either target`, async () => {
      const { backing, fs, path, options } = await fixture(kind);
      const moved = replacement === "parent" ? "/work/sub" : "/work/sub/file";
      await backing.rename(moved, "/saved");
      if (replacement === "parent") await backing.mkdir("/work/sub");
      await backing.writeFile("/work/sub/file", Uint8Array.of(29), { mode: 0o644 });
      await assert.rejects(fs.chmod!(path, 0o777, options), { code: "EAGAIN" });
      const oldPath = replacement === "parent" ? "/saved/file" : "/saved";
      assert.equal((await backing.stat(oldPath)).mode & 0o777, 0o640);
      assert.equal((await backing.stat("/work/sub/file")).mode & 0o777, 0o644);
      assert.deepEqual(await fs.readFile(path), Uint8Array.of(29));
    });
  }

  test(`${kind} conditional chmod propagates a refused commit guard before changing metadata`, async () => {
    const { backing, fs, path, options } = await fixture(kind);
    const reason = new FsError("EAGAIN", { message: "conditional chmod guard refused" });
    await assert.rejects(fs.chmod!(path, 0o777, { ...options, commitGuard() { throw reason; } }), { code: "EAGAIN" });
    assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
    assert.equal((await backing.stat("/work/sub/file")).mode & 0o777, 0o640);
  });

  test(`${kind} scoped chmod forwards receipts and commit guards`, async () => {
    const { fs, path, options } = await fixture(kind);
    const scoped = scopeFileSystem(fs, () => {}, new AbortController().signal);
    await assert.rejects(scoped.chmod!(path, 0o777, { ...options, commitGuard() { throw new FsError("EAGAIN"); } }), { code: "EAGAIN" });
    assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
    await scoped.chmod!(path, 0o600, options);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
  });

  test(`${kind} conditional chmod rejects a non-callable guard before mutation`, async () => {
    const { fs, path, options } = await fixture(kind);
    await assert.rejects(fs.chmod!(path, 0o777, { ...options, commitGuard: false as unknown as () => true }), { code: "EINVAL" });
    assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
  });

  test(`${kind} conditional chmod preserves captured cancellation when its guard replaces caller options`, async () => {
    const { fs, path, options } = await fixture(kind);
    const controller = new AbortController();
    const mutation = {
      ...options,
      signal: controller.signal,
      commitGuard(): true {
        controller.abort(false);
        mutation.signal = new AbortController().signal;
        return true;
      }
    };
    let rejected = false;
    try { await fs.chmod!(path, 0o777, mutation); }
    catch { rejected = true; }
    assert.equal(rejected, true);
    assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
  });
}

test("overridden read-only wrappers cannot advertise conditional overlay chmod", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/file", Uint8Array.of(17), { mode: 0o640 });
  const lower = new ReadOnlyFileSystem(backing);
  const lstat = lower.lstat.bind(lower);
  lower.lstat = (path, options) => lstat(path, options);
  const fs = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
  assert.equal(fs.capabilities.conditionalChmod, false);
  const parent = await fs.lstat("/");
  const options = { parent, expected: await fs.lstat("/file"), ancestors: [{ path: "/", stat: parent }] };
  await assert.rejects(fs.chmod("/file", 0o777, options), { code: "ENOTSUP" });
  assert.equal((await backing.stat("/file")).mode & 0o777, 0o640);
  await assert.rejects(lower.chmod("/file", 0o777), { code: "EROFS" });
});

test("conditional chmod preserves the protected mount-root refusal", async () => {
  const backing = new MemoryFileSystem();
  const fs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mounted": backing } });
  const parent = await fs.lstat("/");
  const expected = await fs.lstat("/mounted");
  await assert.rejects(fs.chmod("/mounted", 0o700, { parent, expected, ancestors: [{ path: "/", stat: parent }] }), { code: "EBUSY" });
  assert.equal((await backing.stat("/")).mode & 0o777, expected.mode & 0o777);
  assert.equal((await fs.stat("/")).mode & 0o777, parent.mode & 0o777);
});

test("read-only upper stores do not gain conditional mutation capabilities", async () => {
  const upper = new ReadOnlyFileSystem(new MemoryFileSystem());
  const fs = new OverlayFileSystem({ upper, lower: new MemoryFileSystem() });
  assert.equal(fs.capabilities.conditionalChmod, false);
  assert.equal(fs.capabilities.atomicFileStaging, false);
  await assert.rejects(fs.chmod("/", 0o777), { code: "EROFS" });
});
