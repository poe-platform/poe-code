import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";

test("directory references follow ancestor moves and moves into new parents", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/a/child", { recursive: true });
  await fs.mkdir("/b/new", { recursive: true });
  await fs.symlink("/a/child", "/alias");
  const reference = fs.trackDirectory("/alias")!;
  assert.equal(reference.path, "/a/child");
  await fs.rename("/a", "/b/new/moved");
  assert.equal(reference.path, "/b/new/moved/child");
  await fs.rename("/b", "/final");
  assert.equal(reference.path, "/final/new/moved/child");
  await fs.mkdir("/a/child", { recursive: true });
  await fs.rename("/a", "/other");
  assert.equal(reference.path, "/final/new/moved/child");
});

test("failed renames and recycled directories cannot retarget a reference", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/a");
  await fs.mkdir("/occupied/child", { recursive: true });
  const reference = fs.trackDirectory("/a")!;
  await assert.rejects(fs.rename("/a", "/occupied"), { code: "ENOTEMPTY" });
  assert.equal(reference.path, "/a");
  await fs.rmdir("/a");
  await fs.mkdir("/a");
  await fs.rename("/a", "/replacement");
  assert.equal(reference.path, "/a");
});

test("directory metadata stays synchronous through device and scoped views", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/a");
  const view = scopeFileSystem(createDeviceFileSystem(fs), () => assert.fail("metadata must not charge I/O"), new AbortController().signal);
  const reference = view.trackDirectory!("/a")!;
  assert.equal(reference.path, "/a");
  assert.equal(view.trackDirectory!("/missing"), undefined);
  assert.equal(view.trackDirectory!("/dev"), undefined);
  await fs.rename("/a", "/b");
  assert.equal(reference.path, "/b");
});
