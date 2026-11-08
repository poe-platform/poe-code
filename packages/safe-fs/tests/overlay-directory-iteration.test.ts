import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createOverlayFileSystem } from "../src/fs/overlay/index.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

it("overlay lazy enumeration merges names with upper precedence and whiteouts", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await upper.mkdir("/shared"); await upper.writeFile("/upper", new Uint8Array());
  await lower.writeFile("/shared", new Uint8Array()); await lower.writeFile("/lower", new Uint8Array()); await lower.writeFile("/removed", new Uint8Array());
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  await fs.rm("/removed");
  upper.readdir = lower.readdir = async () => { throw new Error("eager listing"); };
  expect(fs.iterateDirectory).toBeTypeOf("function");
  const rows = [];
  for await (const entry of fs.iterateDirectory!("/")) rows.push(entry);
  expect(rows.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "lower", type: "file" }, { name: "shared", type: "directory" }, { name: "upper", type: "file" },
  ]);
});

it("overlay pulls lazily and closes early without retaining the directory", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  let pulls = 0, closed = 0;
  await upper.writeFile("/first", new Uint8Array());
  upper.iterateDirectory = async function* () {
    try { pulls++; yield { name: "first", type: "file" }; pulls++; throw new Error("unexpected second pull"); }
    finally { closed++; }
  };
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  expect(fs.iterateDirectory).toBeTypeOf("function");
  const iterator = fs.iterateDirectory!("/")[Symbol.asyncIterator]();
  expect(pulls).toBe(0); expect((await iterator.next()).value).toEqual({ name: "first", type: "file" });
  await iterator.return!(); expect(pulls).toBe(1); expect(closed).toBe(1);
});

it("overlay releases its operation queue during consumer pauses and closes on cancellation", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await upper.writeFile("/first", new Uint8Array());
  let closed = false;
  upper.iterateDirectory = async function* () { try { yield { name: "first", type: "file" }; } finally { closed = true; } };
  const fs: FileSystem = createOverlayFileSystem({ upper, lower }), controller = new AbortController();
  expect(fs.iterateDirectory).toBeTypeOf("function");
  const iterator = fs.iterateDirectory!("/", { signal: controller.signal })[Symbol.asyncIterator]();
  await iterator.next(); await fs.stat("/first"); controller.abort(false);
  await expect(iterator.next()).rejects.toBe(false); expect(closed).toBe(true);
});

it("opaque overlay directories exclude the removed lower directory's children", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/dir"); await lower.writeFile("/dir/old", new Uint8Array());
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  await fs.rm("/dir", { recursive: true }); await fs.mkdir("/dir"); await fs.writeFile("/dir/new", new Uint8Array());
  expect(fs.iterateDirectory).toBeTypeOf("function");
  const rows = []; for await (const entry of fs.iterateDirectory!("/dir")) rows.push(entry);
  expect(rows).toEqual([{ name: "new", type: "file" }]);
});

it("overlay closes an iterator acquired concurrently with cancellation", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem(), controller = new AbortController();
  let pulls = 0, closed = 0;
  upper.iterateDirectory = () => ({ [Symbol.asyncIterator]() {
    controller.abort(0);
    return { async next() { pulls++; return { done: true as const, value: undefined }; }, async return() { closed++; return { done: true as const, value: undefined }; } };
  } });
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  await expect(fs.iterateDirectory!("/", { signal: controller.signal })[Symbol.asyncIterator]().next()).rejects.toBe(0);
  expect(pulls).toBe(0); expect(closed).toBe(1);
});

it("overlay rejects changed symlink routing before another backend pull", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await upper.mkdir("/one"); await upper.mkdir("/two"); await upper.writeFile("/one/a", new Uint8Array()); await upper.symlink("/one", "/alias");
  let pulls = 0, closed = 0;
  upper.iterateDirectory = async function* () { try { pulls++; yield { name: "a", type: "file" }; pulls++; } finally { closed++; } };
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  const iterator = fs.iterateDirectory!("/alias")[Symbol.asyncIterator]();
  await iterator.next(); await fs.rm("/alias"); await fs.symlink!("/two", "/alias");
  await expect(iterator.next()).rejects.toMatchObject({ code: "EBUSY" });
  expect(pulls).toBe(1); expect(closed).toBe(1);
});

it("overlay rejects invalid child names and preserves the primary error during cleanup", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  let closed = 0;
  upper.iterateDirectory = () => ({ [Symbol.asyncIterator]: () => ({
    async next() { return { done: false, value: { name: "../escape", type: "file" } }; },
    async return() { closed++; throw new Error("retirement failed"); },
  }) });
  const fs: FileSystem = createOverlayFileSystem({ upper, lower });
  await expect(fs.iterateDirectory!("/")[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "EIO" });
  expect(closed).toBe(1);
});
