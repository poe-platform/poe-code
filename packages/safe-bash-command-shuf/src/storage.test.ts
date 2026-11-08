import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, withObjectFileDescriptors, type ObjectFilePublicationStore, type ObjectFileVersion, type FileStat } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { ShufStorage, IntegerTable } from "./storage.js";

function context(): CommandContext {
  return { command: "shuf", args: [], fs: createMemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} } };
}

test("paged storage spills through the supplied filesystem and removes only its own file", async () => {
  const ctx = context();
  const store = new ShufStorage(ctx, 2);
  const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
  const start = await store.append(bytes);
  assert.deepEqual(await ctx.fs.readdir("/"), []);
  for (let offset = 0; offset < bytes.length; offset += 997) {
    assert.deepEqual(await store.read(start + offset, Math.min(997, bytes.length - offset)), bytes.slice(offset, offset + 997));
  }
  await store.write(start + 16_380, Uint8Array.of(3, 2, 1, 0, 255, 254));
  assert.deepEqual(await store.read(start + 16_380, 6), Uint8Array.of(3, 2, 1, 0, 255, 254));
  await store.close();
  await store.close();
  assert.deepEqual(await ctx.fs.readdir("/"), []);
});

test("integer tables preserve sparse 64-bit keys and zero values after cache eviction", async () => {
  const ctx = context();
  const store = new ShufStorage(ctx, 2);
  const table = new IntegerTable(store, 16);
  const other = new IntegerTable(store);
  for (let i = 0n; i < 128n; i++) await table.set(i << 56n, i);
  await table.set((1n << 64n) - 1n, (1n << 64n) - 2n);
  await other.set(0n, 42n);
  for (let i = 0n; i < 128n; i++) assert.equal(await table.get(i << 56n), i);
  assert.equal(await table.get((1n << 64n) - 1n), (1n << 64n) - 2n);
  assert.equal(await table.get(1n), undefined);
  assert.equal(await other.get(0n), 42n);
  await store.close();
  assert.deepEqual(await ctx.fs.readdir("/"), []);
});

test("small storage neither opens files nor requires filesystem mutation", async () => {
  const ctx = context();
  const store = new ShufStorage({ ...ctx, fs: new Proxy(ctx.fs, { get() { throw new Error("unexpected filesystem access"); } }) });
  const start = await store.append(Uint8Array.of(1, 2, 3));
  assert.deepEqual(await store.read(start, 3), Uint8Array.of(1, 2, 3));
  await store.close();
});

test("spill cleanup leaves a newly created file at its detached pathname alone", async () => {
  const ctx = context();
  let path = "";
  const fs = new Proxy(ctx.fs, { get(target, key) {
    if (key === "open") return (...args: Parameters<NonNullable<typeof target.open>>) => {
      path = args[0]; return target.open!(...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const store = new ShufStorage({ ...ctx, fs }, 1);
  await store.append(new Uint8Array(40_000));
  assert.deepEqual(await ctx.fs.readdir("/"), []);
  await ctx.fs.writeFile(path, Uint8Array.of(7));
  await store.close();
  assert.deepEqual(await ctx.fs.readFile(path), Uint8Array.of(7));
});

test("cancellation drains a late spill acquisition before cleanup", async () => {
  const ctx = context();
  let acquired!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const fs = new Proxy(ctx.fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof target.open>>) => {
      const descriptor = await target.open!(...args);
      acquired(); await held;
      return descriptor;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const store = new ShufStorage({ ...ctx, fs }, 1);
  const writing = assert.rejects(store.append(new Uint8Array(40_000)), (error: unknown) => (error as { code?: string }).code === "ECANCELED");
  await started;
  let closed = false;
  const closing = store.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await Promise.all([writing, closing]);
  assert.deepEqual(await ctx.fs.readdir("/"), []);
});

test("spill storage handles short retained reads and writes", async () => {
  const ctx = context();
  const fs = new Proxy(ctx.fs, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof target.open>>) => {
      const descriptor = await target.open!(...args);
      return new Proxy(descriptor, { get(handle, method) {
        if (method === "read" || method === "write") return (bytes: Uint8Array, position: number | null, controls?: Parameters<typeof handle.read>[2]) => handle[method](bytes.subarray(0, 997), position, controls);
        const value = Reflect.get(handle, method, handle);
        return typeof value === "function" ? value.bind(handle) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const store = new ShufStorage({ ...ctx, fs }, 1);
  const bytes = Uint8Array.from({ length: 40_000 }, (_, i) => i % 251);
  const start = await store.append(bytes);
  assert.deepEqual(await store.read(start, 16384), bytes.slice(0, 16384));
  assert.deepEqual(await store.read(start + 32_000, 8000), bytes.slice(32_000));
  await store.close();
  assert.deepEqual(await ctx.fs.readdir("/"), []);
});

test("remote object descriptors spill privately and retire without publishing scratch payloads", async () => {
  const ctx = context();
  let publications = 0, staged = 0, replayed = 0, retired = 0;
  const version = (stat: FileStat): ObjectFileVersion => ({
    revision: String(stat.revision), stat,
    async read(_position, count) { assert.equal(count, 0); return new Uint8Array(); },
    async close() {},
  });
  const store: ObjectFilePublicationStore = {
    async acquire(path) {
      try { return version(await ctx.fs.stat(path)); }
      catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; }
    },
    async publish(path, expected, source, options) {
      assert.equal(expected, null, "scratch data must never be published");
      assert.equal(options.size, 0);
      for await (const bytes of source) assert.equal(bytes.length, 0);
      publications++;
      await ctx.fs.writeFileConditional!(path, new Uint8Array(), { parent: await ctx.fs.stat("/"), expected: null });
      return version(await ctx.fs.stat(path));
    },
    async createStaging(_path, options) {
      assert.equal(options.chunkBytes, 16384);
      const remotePages = new Map<number, Uint8Array>();
      return {
        async writePage(page, bytes, controls) {
          controls?.signal?.throwIfAborted();
          assert.equal(bytes.length, 16384); staged++;
          remotePages.set(page, bytes.slice());
        },
        async readPage(page, controls) {
          controls?.signal?.throwIfAborted(); replayed++;
          return remotePages.get(page)?.slice();
        },
        async truncate() { throw new FsError("ENOTSUP"); },
        async close() { retired++; remotePages.clear(); },
      };
    },
  };
  const fs = withObjectFileDescriptors(ctx.fs, store, { chunkBytes: 16384, maxStagedBytes: 16384, maxStagedPages: 1 });
  const storage = new ShufStorage({ ...ctx, fs }, 1);
  const bytes = new Uint8Array(100_000).fill(42);
  const start = await storage.append(bytes);
  assert.deepEqual(await storage.read(start, 16384), bytes.slice(0, 16384));
  assert.deepEqual(await storage.read(start + 80_000, 10000), bytes.slice(80_000, 90000));
  await storage.close();
  assert.equal(publications, 1);
  assert.ok(staged > 1 && replayed > 0);
  assert.equal(retired, 1);
  assert.deepEqual(await ctx.fs.readdir("/"), []);
});
