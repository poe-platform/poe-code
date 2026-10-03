import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import type { DirectoryEntry, FileSystem } from "../src/contracts/filesystem.js";

function lazyBackend(backing: MemoryFileSystem, source: () => AsyncIterable<DirectoryEntry>): FileSystem {
  return new Proxy(backing, { get(target, key) {
    if (key === "readdir") return () => { throw new Error("eager listing"); };
    if (key === "iterateDirectory") return source;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

it("mount enumeration pulls one entry at a time and retires on early exit", async () => {
  let pulls = 0, closed = 0;
  const root = new MemoryFileSystem();
  const backend = lazyBackend(root, async function* () {
    try { for (let i = 0; i < 100000; i++) { pulls++; yield { name: String(i), type: "file" }; } }
    finally { closed++; }
  });
  const mounted: FileSystem = createMountFileSystem({ root: backend });
  expect(mounted.iterateDirectory).toBeTypeOf("function");
  const iterator = mounted.iterateDirectory!("/")[Symbol.asyncIterator]();
  expect(pulls).toBe(0);
  expect((await iterator.next()).value).toEqual({ name: "0", type: "file" });
  expect(pulls).toBe(1);
  await iterator.return!();
  expect(closed).toBe(1);
});

it("mount enumeration applies synthetic children and shadowing without listing fallback", async () => {
  const root = new MemoryFileSystem(), leaf = new MemoryFileSystem();
  await root.writeFile("/shadow", new Uint8Array());
  await root.writeFile("/visible", new Uint8Array());
  await leaf.writeFile("/leaf", new Uint8Array());
  const backend = lazyBackend(root, () => root.iterateDirectory("/"));
  const mounted: FileSystem = createMountFileSystem({ root: backend, mounts: { "/shadow/deep": leaf, "/synthetic/a": leaf, "/synthetic/b": leaf } });
  expect(mounted.iterateDirectory).toBeTypeOf("function");
  const rows: DirectoryEntry[] = [];
  for await (const entry of mounted.iterateDirectory!("/")) rows.push(entry);
  expect(rows.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "shadow", type: "directory" }, { name: "synthetic", type: "directory" }, { name: "visible", type: "file" },
  ]);
  const synthetic: DirectoryEntry[] = [];
  for await (const entry of mounted.iterateDirectory!("/synthetic")) synthetic.push(entry);
  expect(synthetic.sort((a, b) => a.name.localeCompare(b.name))).toEqual([{ name: "a", type: "directory" }, { name: "b", type: "directory" }]);
});

it("mount iterators do not hold namespace locks while the consumer is paused", async () => {
  const root = new MemoryFileSystem(); await root.mkdir("/entries"); await root.writeFile("/entries/a", new Uint8Array()); await root.writeFile("/other", new Uint8Array());
  const mounted: FileSystem = createMountFileSystem({ root });
  expect(mounted.iterateDirectory).toBeTypeOf("function");
  const iterator = mounted.iterateDirectory!("/entries")[Symbol.asyncIterator]();
  await iterator.next();
  await mounted.rename("/other", "/renamed");
  await iterator.return!();
  expect(await root.stat("/renamed")).toMatchObject({ type: "file" });
});

it("mount enumeration preserves cancellation and closes the backend", async () => {
  const controller = new AbortController(), closed = vi.fn();
  const root = new MemoryFileSystem();
  const mounted: FileSystem = createMountFileSystem({ root: lazyBackend(root, async function* () {
    try { yield { name: "one", type: "file" }; yield { name: "two", type: "file" }; } finally { closed(); }
  }) });
  expect(mounted.iterateDirectory).toBeTypeOf("function");
  const iterator = mounted.iterateDirectory!("/", { signal: controller.signal })[Symbol.asyncIterator]();
  await iterator.next(); controller.abort(false);
  await expect(iterator.next()).rejects.toBe(false);
  expect(closed).toHaveBeenCalledTimes(1);
});

it("mount enumeration rejects changed symlink routing before another backend pull", async () => {
  const root = new MemoryFileSystem(); await root.mkdir("/first"); await root.mkdir("/second"); await root.symlink("/first", "/alias");
  let pulls = 0, closed = 0;
  const mounted: FileSystem = createMountFileSystem({ root: lazyBackend(root, async function* () {
    try { pulls++; yield { name: "one", type: "file" }; pulls++; yield { name: "two", type: "file" }; } finally { closed++; }
  }) });
  const iterator = mounted.iterateDirectory!("/alias")[Symbol.asyncIterator]();
  await iterator.next(); await mounted.unlink!("/alias"); await mounted.symlink!("/second", "/alias");
  await expect(iterator.next()).rejects.toMatchObject({ code: "EBUSY", syscall: "iterateDirectory", path: "/alias" });
  expect(pulls).toBe(1); expect(closed).toBe(1);
});

it("invalid backend names preserve the primary error even if retirement fails", async () => {
  const root = new MemoryFileSystem(), close = vi.fn(async () => { throw new Error("close failed"); });
  const mounted: FileSystem = createMountFileSystem({ root: lazyBackend(root, () => ({ [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: { name: "../escape", type: "file" } }), return: close,
  }) })) });
  await expect(mounted.iterateDirectory!("/")[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "EIO", syscall: "iterateDirectory", path: "/" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("missing lazy capability fails without eager fallback", async () => {
  const root = new MemoryFileSystem(), eager = vi.fn(async () => []);
  const backend = new Proxy(root, { get(target, key) {
    if (key === "iterateDirectory") return undefined;
    if (key === "readdir") return eager;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const mounted: FileSystem = createMountFileSystem({ root: backend });
  await expect(mounted.iterateDirectory!("/")[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(eager).not.toHaveBeenCalled();
});

it("cancellation during iterator acquisition still retires the acquired resource", async () => {
  const root = new MemoryFileSystem(), controller = new AbortController();
  const close = vi.fn(async () => ({ done: true as const, value: undefined }));
  const next = vi.fn(async () => ({ done: true as const, value: undefined }));
  const mounted: FileSystem = createMountFileSystem({ root: lazyBackend(root, () => ({ [Symbol.asyncIterator]() {
    controller.abort(0); return { next, return: close };
  } })) });
  await expect(mounted.iterateDirectory!("/", { signal: controller.signal })[Symbol.asyncIterator]().next()).rejects.toBe(0);
  expect(next).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});
