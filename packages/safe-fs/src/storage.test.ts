import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "./fs/memory/index.js";
import {PagedStorage, PagedStorageCache, IntegerTable} from "./storage.js";
import type {FileSystem} from "./contracts/filesystem.js";

it("prepares one detached backing handle before directory iteration and preserves cached data", async () => {
  const fs = new MemoryFileSystem(), context = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(context, 1), open = vi.spyOn(fs, "open");
  try {
    const position = await storage.append(new Uint8Array([37, 42]));
    await Promise.all([storage.prepare(), storage.prepare()]);
    expect(open).toHaveBeenCalledTimes(1);
    await fs.writeFile("/entry", new Uint8Array());
    for await (const entry of fs.iterateDirectory("/")) {
      expect(entry.name).toBe("entry");
      for (let index = 0; index < 4; index++) await storage.append(new Uint8Array(16384).fill(index));
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(await storage.read(position, 2)).toEqual(new Uint8Array([37, 42]));
  } finally { await storage.close(); }
  expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["entry"]);
});

it("shares a fixed page budget across independently live stores and concurrent readers", async () => {
  const fs = new MemoryFileSystem();
  const cache = new PagedStorageCache(2);
  const context = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const stores = Array.from({length: 20}, () => new PagedStorage(context, 2, cache));
  const open = vi.spyOn(fs, "open");
  try {
    await Promise.all(stores.map((storage, index) => storage.append(new Uint8Array(1000).fill(index))));
    expect(cache.residentBytes).toBeLessThanOrEqual(32768);
    expect(open.mock.calls.length).toBeGreaterThanOrEqual(18);
    for (let round = 0; round < 3; round++) {
      await Promise.all(stores.map(async (storage, index) => {
        expect(await storage.read(8, 1000)).toEqual(new Uint8Array(1000).fill(index));
        expect(cache.residentBytes).toBeLessThanOrEqual(32768);
      }));
    }
    await stores[0]!.close();
    expect(await stores[19]!.read(8, 1000)).toEqual(new Uint8Array(1000).fill(19));
  } finally { await Promise.all(stores.map(storage => storage.close())); }
  expect(cache.residentBytes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it("waits for another store's eviction IO before closing a shared-cache owner", async () => {
  const fs = new MemoryFileSystem();
  const cache = new PagedStorageCache(1);
  const context = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const left = new PagedStorage(context, 2, cache), right = new PagedStorage(context, 2, cache);
  let entered!: () => void, release!: () => void, closed = 0;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    return { capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), read: handle.read.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      async write(...params) { entered(); await released; return handle.write(...params); },
      async close(...params) { closed++; await handle.close(...params); },
    };
  });
  try {
    await left.append(new Uint8Array([37]));
    const address = right.allocate(1);
    const eviction = right.write(address, new Uint8Array([42]));
    const failure = eviction.then(() => undefined, error => error);
    await pending;
    const closing = left.close();
    await Promise.resolve(); await Promise.resolve();
    expect(closed).toBe(0);
    release();
    expect(await failure).toMatchObject({code: "ECANCELED"}); await closing;
    expect(closed).toBe(1);
    await right.write(address, new Uint8Array([42]));
    expect(await right.read(address, 1)).toEqual(new Uint8Array([42]));
  } finally { release(); await Promise.all([left.close(), right.close()]); }
  expect(cache.residentBytes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it("does not lose the victim when shared-cache spill fails", async () => {
  const fs = new MemoryFileSystem();
  const cache = new PagedStorageCache(1);
  const context = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const left = new PagedStorage(context, 2, cache), right = new PagedStorage(context, 2, cache);
  const failure = new Error("spill failed");
  const open = vi.spyOn(fs, "open").mockRejectedValueOnce(failure);
  try {
    await left.append(new Uint8Array([37]));
    const address = right.allocate(1);
    await expect(right.write(address, new Uint8Array([42]))).rejects.toBe(failure);
    expect(await left.read(8, 1)).toEqual(new Uint8Array([37]));
    await right.write(address, new Uint8Array([42]));
    expect(await left.read(8, 1)).toEqual(new Uint8Array([37]));
    expect(await right.read(address, 1)).toEqual(new Uint8Array([42]));
    expect(open).toHaveBeenCalledTimes(3);
  } finally { await Promise.all([left.close(), right.close()]); }
  expect(cache.residentBytes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["read", "write"] as const)("observes requester cancellation during another store's eviction: %s", async operation => {
  const fs = new MemoryFileSystem(), cache = new PagedStorageCache(1);
  const controller = new AbortController(), reason = new Error("requester cancelled");
  const context = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const owner = new PagedStorage(context, 2, cache);
  const requester = new PagedStorage({...context, signal: controller.signal}, 2, cache);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    handle.write = async (...params) => { controller.abort(reason); return write(...params); };
    return handle;
  });
  try {
    await owner.append(Uint8Array.of(37));
    const address = requester.allocate(1);
    await expect(operation === "read" ? requester.read(address, 1) : requester.write(address, Uint8Array.of(42))).rejects.toBe(reason);
    expect(await owner.read(8, 1)).toEqual(Uint8Array.of(37));
  } finally { await Promise.all([owner.close(), requester.close()]); }
  expect(cache.residentBytes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it("spills bounded pages through caller handles and retires scratch files", async () => {
  const fs = new MemoryFileSystem();
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file reads forbidden"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file writes forbidden"));
  const open = vi.spyOn(fs, "open");
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  try {
    const start = storage.allocate(0);
    for (let n = 0; n < 16; n++) await storage.append(new Uint8Array(4096).fill(n));
    expect(open).toHaveBeenCalledTimes(1);
    for (let n = 15; n >= 0; n--) expect(await storage.read(start + n * 4096, 4096)).toEqual(new Uint8Array(4096).fill(n));
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("handles partial retained descriptor I/O and owns bytes across cache eviction", async () => {
  const fs = new MemoryFileSystem();
  const original = fs.open.bind(fs);
  const remove = vi.spyOn(fs, "removeFileConditional");
  const close = vi.fn();
  let reads = 0, writes = 0;
  vi.spyOn(fs, "open").mockImplementation(async (path, options) => {
    expect(options).toMatchObject({access: "readwrite", creation: "exclusive", mode: 0o600});
    const handle = await original(path, options);
    return {
      capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      async read(buffer, position, options) {reads++; expect(options?.signal?.aborted).toBe(false); return handle.read(buffer.subarray(0, 73), position, options);},
      async write(buffer, position, options) {
        writes++;
        expect(remove).toHaveBeenCalledTimes(1);
        expect(await fs.readdir("/")).toEqual([]);
        expect(options?.signal?.aborted).toBe(false);
        return handle.write(buffer.subarray(0, 97), position, options);
      },
      async close(options) {close(); expect(options?.signal?.aborted).toBe(true); await handle.close(options);}
    };
  });
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file fallback forbidden"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file fallback forbidden"));
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const input = new Uint8Array(8192).fill(37);
  try {
    const start = await storage.append(input);
    input.fill(255);
    await storage.append(new Uint8Array(32768).fill(91));
    const output = await storage.read(start, 8192);
    expect(output).toEqual(new Uint8Array(8192).fill(37));
    output.fill(0);
    expect(await storage.read(start, 8192)).toEqual(new Uint8Array(8192).fill(37));
    expect(reads).toBeGreaterThan(1);
    expect(writes).toBeGreaterThan(1);
  } finally {await Promise.all([storage.close(), storage.close()]);}
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readdir("/")).toEqual([]);
});

it("cancels cooperative pending descriptor writes before retiring the retained handle", async () => {
  const fs = new MemoryFileSystem();
  const original = fs.open.bind(fs);
  let entered!: () => void;
  const writing = new Promise<void>(resolve => {entered = resolve;});
  const close = vi.fn();
  vi.spyOn(fs, "open").mockImplementation(async (path, options) => {
    const handle = await original(path, options);
    return {
      capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), read: handle.read.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      async write(_buffer, _position, options) {
        entered();
        return new Promise<number>((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        });
      },
      async close(options) {close(); await handle.close(options);}
    };
  });
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  await storage.append(new Uint8Array(8192));
  const pending = storage.append(new Uint8Array(8192));
  const failed = pending.then(() => undefined, error => error);
  await writing;
  await Promise.all([storage.close(), storage.close()]);
  expect(await failed).toMatchObject({code: "ECANCELED"});
  expect(close).toHaveBeenCalledTimes(1);
  expect(() => storage.allocate(1)).toThrow(expect.objectContaining({code: "ECANCELED"}));
  expect(await fs.readdir("/")).toEqual([]);
});

it("refuses unsupported backing capabilities without falling back to pathname reads or writes", async () => {
  const fs = new MemoryFileSystem();
  const read = vi.spyOn(fs, "readFile");
  const write = vi.spyOn(fs, "writeFile");
  const open = vi.spyOn(fs, "open");
  const restricted = new Proxy(fs, {
    get(target, key) {
      if (key === "removeFileConditional") return undefined;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as FileSystem;
  const storage = new PagedStorage({fs: restricted, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  try {await expect(storage.append(new Uint8Array(32768))).rejects.toMatchObject({code: "ENOTSUP"});}
  finally {await storage.close();}
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([NaN, 8.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe or nonintegral write position %s", async position => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  storage.allocate(16);
  try {await expect((async () => storage.write(position, Uint8Array.of(1)))()).rejects.toThrow("Invalid paged storage range");}
  finally {await storage.close();}
});

it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid integer-index cache bound %s before acquiring storage", async size => {
  const fs = new MemoryFileSystem();
  const open = vi.spyOn(fs, "open");
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  try {expect(() => new IntegerTable(storage, size)).toThrow(RangeError); expect(open).not.toHaveBeenCalled();}
  finally {await storage.close();}
});

it.each(["read", "write"] as const)("rejects a zero-progress descriptor %s and still closes its retained handle", async operation => {
  const fs = new MemoryFileSystem();
  const original = fs.open.bind(fs);
  const close = vi.fn();
  vi.spyOn(fs, "open").mockImplementation(async (path, options) => {
    const handle = await original(path, options);
    return {
      capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      read: operation === "read" ? async () => 0 : handle.read.bind(handle),
      write: operation === "write" ? async () => 0 : handle.write.bind(handle),
      async close(options) {close(); await handle.close(options);}
    };
  });
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  try {
    const pending = (async () => {
      const position = await storage.append(new Uint8Array(32768));
      await storage.read(position, 1);
    })();
    await expect(pending).rejects.toMatchObject({code: "EIO"});
  } finally {await storage.close();}
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readdir("/")).toEqual([]);
});

it("retains acquisition ownership when cancellation wins immediately after descriptor open", async () => {
  const fs = new MemoryFileSystem();
  const original = fs.open.bind(fs);
  const controller = new AbortController();
  const reason = {cancel: "after open"};
  const close = vi.fn();
  vi.spyOn(fs, "open").mockImplementation(async (path, options) => {
    const handle = await original(path, options);
    controller.abort(reason);
    return {
      capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), read: handle.read.bind(handle), write: handle.write.bind(handle),
      truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle),
      async close(options) {close(); await handle.close(options);}
    };
  });
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: controller.signal}, 1);
  try {await expect(storage.append(new Uint8Array(32768))).rejects.toBe(reason);}
  finally {await storage.close();}
  expect(close).toHaveBeenCalledTimes(1);
  expect(await fs.readdir("/")).toEqual([]);
});

it("stores sparse integer indexes with a bounded cache through the same backing authority", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const index = new IntegerTable(storage, 2);
  try {
    for (let n = 0n; n < 100n; n++) await index.set(n * 9999991n, n + 1n);
    for (let n = 0n; n < 100n; n++) expect(await index.get(n * 9999991n)).toBe(n + 1n);
    expect(await index.get(7n)).toBeUndefined();
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("iterates sparse integer records in key order with bounded borrowed reads", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024), response = new Uint8Array(128);
  let end = 128;
  const table = new IntegerTable({
    allocate(length) { const at = end; end += length; return at; },
    async read(at, length) { expect(length).toBeLessThanOrEqual(128); response.set(bytes.subarray(at, at + length)); return response.subarray(0, length); },
    async write(at, value) { bytes.set(value, at); }
  }, 8);
  const expected = new Map<bigint, bigint>([[0n, 5n], [0xffffffffffffffffn, 7n]]);
  for (let i = 599; i >= 0; i--) expected.set(BigInt(i * 65537), BigInt(i));
  for (const [key, value] of expected) await table.set(key, value);
  await table.set(0n, 123n); expected.set(0n, 123n);
  const entries = []; for await (const entry of table.entries()) entries.push(entry);
  expect(entries).toEqual([...expected].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const cursor = table.entries(); await cursor.next(); await cursor.return(undefined);
  expect(await table.get(0n)).toBe(123n);
  const replay = []; for await (const entry of table.entries()) replay.push(entry);
  expect(replay).toEqual(entries);
});

it("rejects mutation during integer-table traversal and propagates backing failure", async () => {
  const bytes = new Uint8Array(4096); let end = 128, fail = false;
  const reason = new Error("read failure");
  const table = new IntegerTable({
    allocate(length) { const at = end; end += length; return at; },
    async read(at, length) { if (fail) throw reason; return bytes.slice(at, at + length); },
    async write(at, value) { bytes.set(value, at); }
  }, 2);
  await table.set(1n, 10n); await table.set(2n, 20n);
  const cursor = table.entries(); await cursor.next(); await table.set(2n, 30n);
  await expect(cursor.next()).rejects.toThrow("changed during iteration");
  fail = true; await expect(table.entries().next()).rejects.toBe(reason);
});

it.each([1, 3])("reuses %i backing buffers across eviction without exposing old page bytes", async pages => {
  const fs = new MemoryFileSystem(), original = fs.open.bind(fs);
  const buffers = new Set<ArrayBufferLike>();
  vi.spyOn(fs, "open").mockImplementation(async (path, options) => {
    const handle = await original(path, options);
    return {
      capabilities: handle.capabilities,
      stat: handle.stat.bind(handle), truncate: handle.truncate.bind(handle), sync: handle.sync.bind(handle), close: handle.close.bind(handle),
      async read(buffer, position, options) {buffers.add(buffer.buffer); return handle.read(buffer, position, options);},
      async write(buffer, position, options) {buffers.add(buffer.buffer); return handle.write(buffer, position, options);}
    };
  });
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, pages);
  try {
    const start = storage.allocate(16384 * 8);
    for (let index = 0; index < 8; index++) await storage.write(start + index * 16384, Uint8Array.of(index + 1));
    const owned = await storage.read(start, 128);
    for (let index = 7; index >= 0; index--) {
      const expected = new Uint8Array(128); expected[0] = index + 1;
      expect(await storage.read(start + index * 16384, 128)).toEqual(expected);
    }
    expect(owned[0]).toBe(1);
    expect(owned.subarray(1)).toEqual(new Uint8Array(127));
    expect(buffers.size).toBe(pages);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("prunes integer-table traversal to a half-open key range", async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024); let end = 128, reads = 0;
  const table = new IntegerTable({ allocate(length) { const at = end; end += length; return at; },
    async read(at, length) { reads++; return bytes.slice(at, at + length); }, async write(at, value) { bytes.set(value, at); } }, 8);
  for (let sheet = 0; sheet < 50; sheet++) for (let cell = 0; cell < 10; cell++) await table.set(BigInt(sheet) << 24n | BigInt(cell), BigInt(cell));
  for await (const ignoredEntry of table.entries()) { /* flush all dirty descriptors */ }
  reads = 0;
  const values = [];
  for await (const entry of table.entries(20n << 24n, 21n << 24n)) values.push(entry);
  expect(values).toEqual(Array.from({ length: 10 }, (_, i) => [20n << 24n | BigInt(i), BigInt(i)]));
  expect(reads).toBeLessThan(25);
  expect((await table.entries(5n, 5n).next()).done).toBe(true);
  await expect(table.entries(-1n, 2n).next()).rejects.toThrow(RangeError);
  await expect(table.entries(2n, 1n).next()).rejects.toThrow(RangeError);
});

it("coalesces dirty index eviction when callers alternate with other stored data", async () => {
  const fs = new MemoryFileSystem(), open = fs.open.bind(fs); let written = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle);
    handle.write = async (bytes, ...args) => { written += bytes.length; return write(bytes, ...args); }; return handle;
  });
  const storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal }, 1);
  const other = storage.allocate(16384), table = new IntegerTable(storage, 128);
  try {
    for (let row = 0; row < 1000; row++) { await table.set(BigInt(row * 256), BigInt(row)); await storage.read(other, 1); }
    let rows = 0;
    for await (const [key, value] of table.entries()) { expect(key).toBe(BigInt(rows * 256)); expect(value).toBe(BigInt(rows++)); }
    // Fewer than half a 16 KiB physical write per sparse update on average.
    expect(rows).toBe(1000); expect(written).toBeLessThan(1000 * 8192);
  } finally { await storage.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([16384, 65536, 1024 * 1024])("batches shared scratch pages of %i bytes with bounded retention and short I/O", async pageBytes => {
  const fs = new MemoryFileSystem(), cache = new PagedStorageCache(1, pageBytes);
  const context = { fs, cwd: "/", env: {}, signal: new AbortController().signal };
  const left = new PagedStorage(context, 1, cache), right = new PagedStorage(context, 1, cache);
  const open = fs.open.bind(fs), writes: number[] = [];
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...values: Parameters<typeof handle.write>) => { writes.push(values[0].length); return handle.write(values[0].subarray(0, 8192), values[1], values[2]); };
      if (key === "read") return (...values: Parameters<typeof handle.read>) => handle.read(values[0].subarray(0, 8192), values[1], values[2]);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    const position = left.allocate(pageBytes * 2), marker = Uint8Array.of(37, 42);
    await left.write(position + pageBytes - 9, marker);
    await right.append(Uint8Array.of(99));
    expect(cache.residentBytes).toBe(pageBytes);
    expect(await left.read(position + pageBytes - 9, 2)).toEqual(marker);
    expect(await left.read(position + pageBytes, 128)).toEqual(new Uint8Array(128));
    expect(await right.read(8, 1)).toEqual(Uint8Array.of(99));
    expect(writes[0]).toBe(pageBytes);
    expect(cache.residentBytes).toBe(pageBytes);
    expect(() => left.read(position, 16385)).toThrow(RangeError);
  } finally { await left.close(); await right.close(); }
  expect(cache.residentBytes).toBe(0);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([0, 1, 16385, Infinity, NaN, 2 * 1024 * 1024])("rejects invalid scratch page size %s", size => {
  expect(() => new PagedStorageCache(1, size)).toThrow("Invalid storage page size");
});
