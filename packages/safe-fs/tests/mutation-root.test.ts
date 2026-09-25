import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";

test("a retained root rejects replacement by another directory", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/out");
  const confined = await fs.confineExtraction(["/out"]);
  await fs.rename("/out", "/parked");
  await fs.mkdir("/out");
  await assert.rejects(async () => confined.writeFile("/out/file", Uint8Array.of(1)), { code: "EAGAIN" });
  assert.deepEqual(await fs.readdir("/out"), []);
});

test("scoped mutations preserve the retained root through fallback appends", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/out");
  await fs.mkdir("/private");
  const scoped = scopeFileSystem(fs, () => {}, new AbortController().signal);
  const confined = await scoped.confineExtraction!(["/out"]);
  await confined.writeFile("/out/file", Uint8Array.of(1));
  await fs.rename("/out", "/parked");
  await fs.symlink("private", "/out");
  await assert.rejects(async () => confined.appendFile("/out/file", Uint8Array.of(2)), { code: "EAGAIN" });
  assert.deepEqual(await fs.readdir("/private"), []);
  assert.deepEqual(await fs.readFile("/parked/file"), Uint8Array.of(1));
});

test("streamed chunks reject a moved parent before modifying the retained file", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/out/sub", { recursive: true });
  await fs.mkdir("/private");
  const confined = await fs.confineExtraction(["/out"]);
  const bytes = (async function* () {
    yield Uint8Array.of(1);
    await fs.rename("/out/sub", "/private/sub");
    await fs.mkdir("/out/sub");
    await fs.writeFile("/out/sub/file", Uint8Array.of(9));
    yield Uint8Array.of(2);
  })();
  await assert.rejects(confined.writeStream!("/out/sub/file", bytes), { code: "EPERM" });
  assert.deepEqual(await fs.readFile("/private/sub/file"), Uint8Array.of(1));
  assert.deepEqual(await fs.readFile("/out/sub/file"), Uint8Array.of(9));
});

test("hardlinks reject symlink traversal on their source as well as destination", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/out");
  await fs.mkdir("/private");
  await fs.writeFile("/private/file", Uint8Array.of(1));
  await fs.symlink("../private", "/out/sub");
  const confined = await fs.confineExtraction(["/out"]);
  await assert.rejects(async () => confined.link!("/out/sub/file", "/out/link"), { code: "ENOTDIR" });
  await assert.rejects(fs.lstat("/out/link"), { code: "ENOENT" });
});

test("device aliases cannot bypass the confined backing namespace during append", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/out");
  await fs.symlink("/dev/null", "/out/file");
  const confined = await createDeviceFileSystem(fs).confineExtraction(["/out"]);
  await assert.rejects(async () => confined.appendFile("/out/file", Uint8Array.of(1)), { code: "ELOOP" });
});
