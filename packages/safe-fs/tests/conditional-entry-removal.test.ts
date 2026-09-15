import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

for (const view of ["memory", "scope", "mount", "devices"] as const) {
  async function fixture() {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work");
    const fs: FileSystem = view === "scope" ? scopeFileSystem(memory, () => {}, new AbortController().signal)
      : view === "mount" ? new MountFileSystem({ root: memory })
      : view === "devices" ? new DeviceFileSystem(memory) : memory;
    return { memory, fs, parent: await fs.lstat("/work") };
  }
  for (const type of ["file", "symlink", "directory"] as const) {
    test(`${view} conditionally removes exact ${type} without following final links`, async () => {
      const { fs, parent } = await fixture();
      await fs.writeFile("/target", Uint8Array.of(9));
      if (type === "file") await fs.writeFile("/work/entry", Uint8Array.of(1));
      else if (type === "directory") await fs.mkdir("/work/entry");
      else await fs.symlink!("/target", "/work/entry");
      const expected = await fs.lstat("/work/entry");
      assert.equal((await fs.capabilitiesFor?.("/work/entry") ?? fs.capabilities).atomicEntryRemoval, true);
      await fs.removeEntryConditional!("/work/entry", { parent, expected });
      await assert.rejects(fs.lstat("/work/entry"), { code: "ENOENT" });
      assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(9));
    });
    test(`${view} refuses replaced ${type} and parent`, async () => {
      const { fs, parent } = await fixture();
      if (type === "file") await fs.writeFile("/work/entry", Uint8Array.of(1));
      else if (type === "directory") await fs.mkdir("/work/entry");
      else await fs.symlink!("/target", "/work/entry");
      const expected = await fs.lstat("/work/entry");
      await fs.rename("/work/entry", "/work/held");
      await fs.writeFile("/work/entry", Uint8Array.of(9));
      await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
      await fs.rename("/work", "/held");
      await fs.mkdir("/work");
      await fs.writeFile("/work/entry", Uint8Array.of(7));
      await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
      assert.deepEqual(await fs.readFile("/work/entry"), Uint8Array.of(7));
    });
  }
  test(`${view} refuses nonempty directories without recursively deleting children`, async () => {
    const { fs, parent } = await fixture();
    await fs.mkdir("/work/entry");
    await fs.writeFile("/work/entry/child", Uint8Array.of(3));
    const expected = await fs.lstat("/work/entry");
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "ENOTEMPTY" });
    assert.deepEqual(await fs.readFile("/work/entry/child"), Uint8Array.of(3));
  });
  test(`${view} refuses stale revisions and precommit cancellation`, async () => {
    const { fs, parent } = await fixture();
    await fs.writeFile("/work/entry", Uint8Array.of(1));
    const expected = await fs.lstat("/work/entry");
    await fs.writeFile("/work/entry", Uint8Array.of(2));
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected }), { code: "EAGAIN" });
    const controller = new AbortController(); controller.abort(false);
    await assert.rejects(fs.removeEntryConditional!("/work/entry", { parent, expected: await fs.lstat("/work/entry"), signal: controller.signal }), error => error === false);
    assert.deepEqual(await fs.readFile("/work/entry"), Uint8Array.of(2));
  });
}

test("conditional entry removal refuses unknown identity and revisions", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/entry", Uint8Array.of(1));
  const parent = await fs.lstat("/");
  const expected = await fs.lstat("/entry");
  for (const field of ["revision", "identityScope", "ino", "dev"] as const) {
    const unknown = { ...expected }; delete unknown[field];
    await assert.rejects(fs.removeEntryConditional("/entry", { parent, expected: unknown }), { code: "ENOTSUP" });
  }
  assert.deepEqual(await fs.readFile("/entry"), Uint8Array.of(1));
});

test("scoped removal respects operation budget and revoked lifetime", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const parent = await memory.lstat("/");
  const expected = await memory.lstat("/entry");
  const budget = new Error("budget exhausted");
  const limited = scopeFileSystem(memory, () => { throw budget; }, new AbortController().signal);
  await assert.rejects(limited.removeEntryConditional!("/entry", { parent, expected }), error => error === budget);
  const controller = new AbortController();
  const scoped = scopeFileSystem(memory, () => {}, controller.signal);
  controller.abort(false);
  await assert.rejects(scoped.removeEntryConditional!("/entry", { parent, expected }), error => error === false);
  assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
});

test("views refuse entry removal when backend does not advertise the capability", async () => {
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  const parent = await memory.lstat("/");
  const expected = await memory.lstat("/entry");
  let calls = 0;
  const backend = new Proxy(memory, { get(target, property) {
    if (property === "capabilities") return { ...memory.capabilities, atomicEntryRemoval: false };
    if (property === "removeEntryConditional") return async () => { calls++; };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const fs of [scopeFileSystem(backend, () => {}, new AbortController().signal), new MountFileSystem({ root: backend }), new DeviceFileSystem(backend)]) {
    await assert.rejects(fs.removeEntryConditional!("/entry", { parent, expected }), { code: "ENOTSUP" });
  }
  assert.equal(calls, 0);
});

test("entry removal preserves another hardlink and does not remove root or terminal-dot entries", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/entry", Uint8Array.of(4));
  await fs.link!("/work/entry", "/work/alias");
  await fs.removeEntryConditional("/work/entry", { parent: await fs.lstat("/work"), expected: await fs.lstat("/work/entry") });
  assert.deepEqual(await fs.readFile("/work/alias"), Uint8Array.of(4));
  assert.equal((await fs.lstat("/work/alias")).nlink, 1);
  await assert.rejects(fs.removeEntryConditional("/work/.", { parent: await fs.lstat("/"), expected: await fs.lstat("/work") }), { code: "EINVAL" });
  await assert.rejects(fs.removeEntryConditional("/", { parent: await fs.lstat("/"), expected: await fs.lstat("/") }), { code: "EBUSY" });
});

test("read-only and quota views cannot expose entry removal as a mutation bypass", async () => {
  const { ReadOnlyFileSystem } = await import("../src/fs/readonly/index.js");
  const { withFileSystemQuota } = await import("../src/fs/quota/index.js");
  const memory = new MemoryFileSystem();
  await memory.writeFile("/entry", Uint8Array.of(1));
  for (const fs of [new ReadOnlyFileSystem(memory), withFileSystemQuota(memory, { maxBytes: 100 })]) {
    assert.equal(fs.capabilities.atomicEntryRemoval, false);
    assert.equal(fs.removeEntryConditional, undefined);
  }
  assert.deepEqual(await memory.readFile("/entry"), Uint8Array.of(1));
});
