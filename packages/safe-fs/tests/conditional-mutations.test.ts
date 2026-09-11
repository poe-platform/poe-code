import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { retainFileSystemCleanup, scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

for (const kind of ["memory", "mount", "devices"] as const) test(`conditional raw writes and removal preserve committed receipts through ${kind}`, async () => {
  const memory = new MemoryFileSystem();
  const fs: FileSystem = kind === "memory" ? memory : kind === "devices" ? new DeviceFileSystem(memory)
    : new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/work": memory } });
  const directory = kind === "mount" ? "/work" : "/";
  const path = kind === "mount" ? "/work/file" : "/file";
  const parent = await fs.lstat(directory);
  const first = await fs.writeFileConditional!(path, Uint8Array.of(0xc3), { parent, expected: null, append: true, mode: 0o600 });
  await assert.rejects(fs.writeFileConditional!(path, Uint8Array.of(9), { parent, expected: null }), { code: "EAGAIN" });
  const second = await fs.writeFileConditional!(path, Uint8Array.of(0, 255), { parent, expected: first, append: true });
  assert.ok(second.revision! > first.revision!);
  assert.equal(second.mode & 0o777, 0o600);
  assert.deepEqual(await memory.readFile("/file"), Uint8Array.of(0xc3, 0, 255));
  await assert.rejects(fs.removeFileConditional!(path, { parent, expected: first }), { code: "EAGAIN" });
  await fs.removeFileConditional!(path, { parent, expected: second });
  await assert.rejects(memory.lstat("/file"), { code: "ENOENT" });
});

test("conditional writes reject stale revision even with matching size and timestamps", async () => {
  const fs = new MemoryFileSystem();
  const parent = await fs.lstat("/");
  const before = await fs.writeFileConditional("/file", Uint8Array.of(1), { parent, expected: null });
  await fs.writeFile("/file", Uint8Array.of(2));
  const current = await fs.lstat("/file");
  const stale = { ...current, revision: before.revision! };
  await assert.rejects(fs.writeFileConditional("/file", Uint8Array.of(3), { parent, expected: stale }), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(2));
});

test("conditional output cannot follow a replaced parent or adopt a replacement file", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const parent = await fs.lstat("/work");
  const before = await fs.writeFileConditional("/work/file", Uint8Array.of(1), { parent, expected: null });
  await fs.rename("/work", "/held");
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(9));
  await assert.rejects(fs.writeFileConditional("/work/file", Uint8Array.of(2), { parent, expected: before, append: true }), { code: "EAGAIN" });
  await assert.rejects(fs.removeFileConditional("/work/file", { parent, expected: before }), { code: "EAGAIN" });
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(9));
  assert.deepEqual(await fs.readFile("/held/file"), Uint8Array.of(1));
});

test("conditional file-size failure preserves original bytes and revision", async () => {
  const fs = new MemoryFileSystem({ maxFileBytes: 2 });
  const parent = await fs.lstat("/");
  const expected = await fs.writeFileConditional("/file", Uint8Array.of(1, 2), { parent, expected: null });
  await assert.rejects(fs.writeFileConditional("/file", Uint8Array.of(3), { parent, expected, append: true }), { code: "EFBIG" });
  assert.equal((await fs.lstat("/file")).revision, expected.revision);
  assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(1, 2));
});

test("unknown file revisions and parent identities refuse before mutation", async () => {
  const fs = new MemoryFileSystem();
  const parent = await fs.lstat("/");
  const expected = await fs.writeFileConditional("/file", Uint8Array.of(1), { parent, expected: null });
  const unknownRevision = { ...expected };
  delete unknownRevision.revision;
  await assert.rejects(fs.writeFileConditional("/file", Uint8Array.of(2), { parent, expected: unknownRevision }), { code: "ENOTSUP" });
  const unknownParent = { ...parent };
  delete unknownParent.identityScope;
  await assert.rejects(fs.removeFileConditional("/file", { parent: unknownParent, expected }), { code: "ENOTSUP" });
  assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(1));
});

test("conditional cleanup budget refuses without deleting a file", async () => {
  const fs = new MemoryFileSystem();
  const parent = await fs.lstat("/");
  const expected = await fs.writeFileConditional("/file", Uint8Array.of(1), { parent, expected: null });
  const cleanup = retainFileSystemCleanup(fs, async view => {
    await view.removeFileConditional!("/file", { parent, expected });
  }, { maxOperations: 0 });
  await assert.rejects(cleanup(), { code: "EFBIG" });
  assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(1));
});

test("readonly and quota views do not advertise or expose conditional mutation bypasses", async () => {
  const fs = new MemoryFileSystem();
  for (const view of [new ReadOnlyFileSystem(fs), withFileSystemQuota(fs, { maxBytes: 10 })] as FileSystem[]) {
    assert.equal(view.capabilities.atomicFileMutation, false);
    assert.equal((await view.capabilitiesFor?.("/file") ?? view.capabilities).atomicFileMutation, false);
    assert.equal(view.writeFileConditional, undefined);
    assert.equal(view.removeFileConditional, undefined);
  }
});

test("composed views refuse an atomic capability whose writer is missing", async () => {
  const memory = new MemoryFileSystem();
  const incomplete = new Proxy(memory, { get(target, property) {
    if (property === "writeFileConditional") return undefined;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const signal = new AbortController().signal;
  for (const view of [scopeFileSystem(incomplete, () => {}, signal), new DeviceFileSystem(incomplete), new MountFileSystem({ root: incomplete })]) {
    assert.equal(view.capabilities.atomicFileMutation, false);
    assert.equal((await view.capabilitiesFor?.("/file") ?? view.capabilities).atomicFileMutation, false);
  }
});

test("scoped committed receipt survives cancellation and retained conditional cleanup is charged", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const original = fs.writeFileConditional.bind(fs);
  fs.writeFileConditional = async (...args) => {
    const receipt = await original(...args);
    controller.abort(false);
    return receipt;
  };
  let charges = 0;
  const scoped = scopeFileSystem(fs, () => {}, controller.signal, () => { charges++; });
  const parent = await scoped.lstat("/");
  const cleanup = retainFileSystemCleanup(scoped, async view => {
    await view.removeFileConditional!("/file", { parent, expected: receipt });
  }, { maxOperations: 1 });
  const receipt = await scoped.writeFileConditional!("/file", Uint8Array.of(1), { parent, expected: null });
  assert.equal(controller.signal.aborted, true);
  await cleanup();
  assert.equal(charges, 1);
  await assert.rejects(fs.lstat("/file"), { code: "ENOENT" });
});
