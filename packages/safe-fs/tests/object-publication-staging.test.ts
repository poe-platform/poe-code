import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { FsError } from "../src/contracts/errors.js";
import type { FileStat, FileSystem, FsOptions } from "../src/contracts/filesystem.js";
import type { ByteSource } from "../src/contracts/io.js";
import { withObjectFileDescriptors, type ObjectFilePublicationStore, type ObjectFileVersion } from "../src/fs/object-publication/index.js";
import { Shell } from "../../safe-bash/src/shell/shell.js";
import { streamCommands } from "../../safe-bash/src/commands/streams.js";
import { PythonFileSystem } from "../src/python/index.js";
import { createObjectFilePublicationConformanceCases } from "../src/testing/object-publication.js";

function fixture(chunkBytes = 65536) {
  const memory = new MemoryFileSystem();
  const files = new Map<string, { revision: string; stat: FileStat; chunks: Uint8Array[] }>();
  let generation = 0;
  const events = { acquired: 0, released: 0, created: 0, closed: 0, stageWrites: 0, stageReads: 0, publishedBytes: 0, publications: 0, activeWrites: 0, peakWrites: 0 };
  const hooks: { write?: (options?: FsOptions) => Promise<void>; publish?: (options?: FsOptions) => Promise<void>; close?: () => Promise<void> } = {};
  const commit = (path: string, chunks: Uint8Array[], size: number, mode = 0o644) => {
    const revision = String(++generation);
    const file = { revision, chunks, stat: { type: "file" as const, size, mode, mtimeMs: generation, atimeMs: generation, ctimeMs: generation, ino: generation, dev: 1, revision: generation } };
    files.set(path, file);
    return file;
  };
  const lease = (file: NonNullable<ReturnType<typeof files.get>>): ObjectFileVersion => {
    events.acquired++;
    let closed = false;
    return {
      revision: file.revision, stat: file.stat,
      async read(position, count, options) {
        options?.signal?.throwIfAborted();
        if (closed) throw new FsError("EBADF");
        const bytes = new Uint8Array(count);
        let copied = 0;
        while (copied < count) {
          const offset = position + copied;
          const within = offset % chunkBytes;
          const length = Math.min(count - copied, chunkBytes - within);
          bytes.set(file.chunks[Math.floor(offset / chunkBytes)]!.subarray(within, within + length), copied);
          copied += length;
        }
        return bytes;
      },
      async close() { if (!closed) { closed = true; events.released++; } },
    };
  };
  const store: ObjectFilePublicationStore = {
    async acquire(path, options) {
      options.signal?.throwIfAborted();
      const file = files.get(path);
      return file && lease(file);
    },
    async publish(path, expected, source, options) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of source) {
        options.signal?.throwIfAborted();
        expect(chunk.byteLength).toBeLessThanOrEqual(chunkBytes);
        chunks.push(chunk.slice());
        size += chunk.length;
      }
      expect(size).toBe(options.size);
      await hooks.publish?.(options);
      options.signal?.throwIfAborted();
      if ((files.get(path)?.revision ?? null) !== expected) throw new FsError("EAGAIN");
      events.publications++;
      events.publishedBytes += size;
      return lease(commit(path, chunks, size, options.mode));
    },
    async createStaging(_path, options) {
      expect(options.chunkBytes).toBe(chunkBytes);
      options.signal?.throwIfAborted();
      events.created++;
      const pages = new Map<number, Uint8Array>();
      let closed = false;
      return {
        async readPage(page, forwarded) {
          forwarded?.signal?.throwIfAborted();
          if (closed) throw new FsError("EBADF");
          const bytes = pages.get(page);
          events.stageReads += bytes?.length ?? 0;
          return bytes?.slice();
        },
        async writePage(page, bytes, forwarded) {
          expect(bytes.length).toBe(chunkBytes);
          if (closed) throw new FsError("EBADF");
          events.activeWrites++;
          events.peakWrites = Math.max(events.peakWrites, events.activeWrites);
          try {
            await hooks.write?.(forwarded);
            forwarded?.signal?.throwIfAborted();
            pages.set(page, bytes.slice());
            events.stageWrites += bytes.length;
          } finally { events.activeWrites--; }
        },
        async truncate(size, forwarded) {
          forwarded?.signal?.throwIfAborted();
          for (const [page, bytes] of pages) {
            if (page * chunkBytes >= size) pages.delete(page);
            else if ((page + 1) * chunkBytes > size) bytes.fill(0, size % chunkBytes);
          }
        },
        async close() {
          if (!closed) { closed = true; pages.clear(); events.closed++; await hooks.close?.(); }
        },
      };
    },
  };
  const namespace = new Proxy(memory, {
    get(target, property) {
      if (property === "open" || property === "openReadFile") return undefined;
      if (property === "capabilities") return { ...target.capabilities, open: false, retainedRead: false, randomAccessWrite: false, descriptorWriteStream: false };
      if (property === "stat") return async (path: string, options?: FsOptions) => {
        options?.signal?.throwIfAborted();
        return files.get(path)?.stat ?? target.stat(path, options);
      };
      if (property === "access") return async (path: string, mode?: number, options?: FsOptions) => {
        options?.signal?.throwIfAborted();
        if (!files.has(path)) await target.access(path, mode, options);
      };
      if (property === "readStream") return async function* (path: string, options?: FsOptions) {
        const file = files.get(path);
        if (!file) throw new FsError("ENOENT", { path });
        for (const chunk of file.chunks) { options?.signal?.throwIfAborted(); yield chunk; }
      };
      if (property === "readFile") return async (path: string, options?: FsOptions) => {
        options?.signal?.throwIfAborted();
        const file = files.get(path);
        if (!file) throw new FsError("ENOENT", { path });
        if (file.stat.size > 64) throw new Error("Large fixture reads must stream");
        const bytes = new Uint8Array(file.stat.size);
        let offset = 0;
        for (const chunk of file.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
      };
      if (property === "writeStream") return async (path: string, source: ByteSource, options?: FsOptions) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of source) { options?.signal?.throwIfAborted(); chunks.push(chunk.slice()); size += chunk.length; }
        commit(path, chunks, size);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as FileSystem;
  return { namespace, store, events, hooks, files, commit };
}

for (const conformance of createObjectFilePublicationConformanceCases({ requireStaging: true, createFixture() {
  const host = fixture(4);
  return { fs: host.namespace, store: host.store, root: "/", dispose() {
    expect(host.events.closed).toBe(host.events.created);
    expect(host.events.released).toBe(host.events.acquired);
  } };
} })) it(conformance.name, conformance.run);

it("does not count a backend without spill support as qualified for staging", async () => {
  const host = fixture(4);
  const { createStaging: ignoredStaging, ...store } = host.store;
  const [qualification] = createObjectFilePublicationConformanceCases({ requireStaging: true, createFixture: () => ({ fs: host.namespace, store, root: "/", dispose() {} }) });
  await expect(qualification!.run()).rejects.toThrow("conformance requires private object staging");
});

it("preserves a 9 MiB shell copy with object descriptors and a single staged page", async () => {
  const host = fixture();
  const chunk = new Uint8Array(65536).fill(173);
  const chunks = Array.from({ length: 144 }, () => chunk);
  host.commit("/source", chunks, 9 * 1024 * 1024);
  for (const fs of [host.namespace, withObjectFileDescriptors(host.namespace, host.store, { maxStagedBytes: 65536, maxStagedPages: 1, maxFileBytes: 100 * 1024 * 1024 })]) {
    const shell = new Shell({ fs });
    shell.commands.register(streamCommands().find(command => command.name === "cat")!);
    try {
      const result = await shell.exec("cat /source > /target");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(host.files.get("/target")!.stat.size).toBe(9 * 1024 * 1024);
      for (const output of host.files.get("/target")!.chunks) expect(Buffer.compare(output, chunk)).toBe(0);
    } finally { await shell.dispose(); }
  }
  expect(host.events.publishedBytes).toBe(9 * 1024 * 1024);
  expect(host.events.stageWrites).toBe(9 * 1024 * 1024);
  expect(host.events.created).toBe(1);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("writes to the configured 100 MiB limit without intermediate publication or growing uploads", async () => {
  const host = fixture();
  const maxFileBytes = 100 * 1024 * 1024;
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxStagedBytes: 65536, maxStagedPages: 1, maxFileBytes });
  const descriptor = await fs.open!("/large", { access: "write", creation: "exclusive", mode: 0o640 });
  const chunk = new Uint8Array(65536).fill(237);
  for (let offset = 0; offset < maxFileBytes; offset += chunk.length) await descriptor.write(chunk, null);
  expect(host.files.get("/large")!.stat.size).toBe(0);
  expect(host.events.publications).toBe(1);
  await expect(descriptor.write(Uint8Array.of(1), null)).rejects.toMatchObject({ code: "EFBIG" });
  await descriptor.close();
  expect(host.files.get("/large")!.stat).toMatchObject({ size: maxFileBytes, mode: 0o640 });
  for (const output of host.files.get("/large")!.chunks) expect(Buffer.compare(output, chunk)).toBe(0);
  expect(host.events.stageWrites).toBe(maxFileBytes);
  expect(host.events.stageReads).toBe(maxFileBytes);
  expect(host.events.publishedBytes).toBe(maxFileBytes);
  expect(host.events.publications).toBe(2);
  expect(host.events.peakWrites).toBe(1);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("accepts Python bridge writes beyond the staging budget without manual sync (not an interpreter test)", async () => {
  const host = fixture();
  const fs = withObjectFileDescriptors(host.namespace, host.store, { maxStagedBytes: 65536, maxStagedPages: 1 });
  const bridge = new PythonFileSystem(fs, { cwd: "/" });
  const descriptor = await bridge.dispatch({ op: "open", args: ["/binary", { access: "write", creation: "ifMissing" }] }) as number;
  const chunk = new Uint8Array(65536).fill(255);
  try {
    for (let count = 0; count < 3; count++) expect(await bridge.dispatch({ op: "write", args: [descriptor, chunk, null] })).toBe(chunk.length);
    expect(host.files.get("/binary")!.stat.size).toBe(0);
    await bridge.dispatch({ op: "close", args: [descriptor] });
  } finally { await bridge.close(); }
  expect(host.files.get("/binary")!.stat.size).toBe(3 * chunk.length);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("retains readers, conditional conflicts, permissions, and private staged visibility", async () => {
  const host = fixture(4);
  host.commit("/file", [Uint8Array.of(1, 2, 3, 4)], 4, 0o600);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const reader = await fs.open!("/file", { access: "read" });
  const winner = await fs.open!("/file", { access: "readwrite" });
  const loser = await fs.open!("/file", { access: "write" });
  await winner.write(Uint8Array.of(7, 8, 9, 10, 11, 12, 13, 14), null);
  await loser.write(Uint8Array.of(99), 0);
  expect(host.files.get("/file")!.chunks[0]).toEqual(Uint8Array.of(1, 2, 3, 4));
  const privateBytes = new Uint8Array(8);
  await winner.read(privateBytes, 0);
  expect(privateBytes).toEqual(Uint8Array.of(7, 8, 9, 10, 11, 12, 13, 14));
  await winner.sync(false);
  await expect(loser.sync(false)).rejects.toMatchObject({ code: "EAGAIN" });
  await expect(loser.close()).rejects.toMatchObject({ code: "EAGAIN" });
  const oldBytes = new Uint8Array(4);
  await reader.read(oldBytes, 0);
  expect(oldBytes).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(host.files.get("/file")!.stat.mode).toBe(0o600);
  await expect(reader.write(Uint8Array.of(1), 0)).rejects.toMatchObject({ code: "EBADF" });
  await winner.close();
  await reader.close();
  expect(host.events.closed).toBe(2);
  expect(host.events.released).toBe(host.events.acquired);
});

it("preserves partial pages, sparse growth, truncation, append, and cursor semantics", async () => {
  const host = fixture(4);
  host.commit("/file", [Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)], 8);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "readwrite" });
  await descriptor.write(Uint8Array.of(42), 1);
  await descriptor.write(Uint8Array.of(99), 7);
  expect(await descriptor.getPosition!()).toBe(0);
  await descriptor.truncate(3);
  await descriptor.truncate(12);
  await descriptor.write(Uint8Array.of(77), 11);
  const buffer = new Uint8Array(12);
  await descriptor.read(buffer, 0);
  expect(buffer).toEqual(Uint8Array.of(1, 42, 3, 0, 0, 0, 0, 0, 0, 0, 0, 77));
  await descriptor.sync(false);
  await descriptor.write(Uint8Array.of(13), 4);
  await descriptor.close();
  const append = await fs.open!("/file", { access: "write", append: true });
  await append.write(Uint8Array.of(14), null);
  expect(await append.getPosition!()).toBe(13);
  await append.close();
  expect(host.files.get("/file")!.chunks[1]).toEqual(Uint8Array.of(13, 0, 0, 0));
  expect(host.files.get("/file")!.chunks[3]).toEqual(Uint8Array.of(14));
  expect(host.events.created).toBe(3);
  expect(host.events.closed).toBe(3);
  expect(host.events.released).toBe(host.events.acquired);
});

it.each([{ maxStagedBytes: 4, maxStagedPages: 4 }, { maxStagedBytes: 16, maxStagedPages: 1 }])("shares one working page across concurrent descriptors under %j", async limits => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, ...limits });
  const first = await fs.open!("/first", { access: "write", creation: "ifMissing" });
  const second = await fs.open!("/second", { access: "write", creation: "ifMissing" });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  host.hooks.write = async () => { entered(); await gate; };
  const writing = first.write(new Uint8Array(8).fill(4), null);
  await started;
  let secondFinished = false;
  const pending = second.write(new Uint8Array(4).fill(2), null).then(() => { secondFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(secondFinished).toBe(false);
  expect(host.events.activeWrites).toBe(1);
  release();
  await Promise.all([writing, pending]);
  await Promise.all([first.close(), second.close()]);
  expect(host.events.peakWrites).toBe(1);
  expect(host.events.stageWrites).toBe(12);
  expect(host.events.closed).toBe(2);
  expect(host.events.released).toBe(host.events.acquired);
});

it.each([false, null])("cancels a waiting writer without releasing another writer's page: %j", async reason => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const first = await fs.open!("/first", { access: "write", creation: "ifMissing" });
  const second = await fs.open!("/second", { access: "write", creation: "ifMissing" });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  host.hooks.write = async () => { entered(); await gate; };
  const writing = first.write(new Uint8Array(4), null);
  await started;
  const controller = new AbortController();
  const pending = second.write(new Uint8Array(4), null, { signal: controller.signal }).catch(error => ({ error }));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(reason);
  expect(await pending).toEqual({ error: reason });
  await expect(second.close()).rejects.toBe(reason);
  expect(host.events.activeWrites).toBe(1);
  release();
  await writing;
  await first.close();
  expect(host.events.peakWrites).toBe(1);
  expect(host.events.closed).toBe(2);
  expect(host.events.released).toBe(host.events.acquired);
});

it.each(["spill", "publication"])("poisons a failed %s without publishing or retrying unflushed bytes", async phase => {
  const host = fixture(4);
  host.commit("/file", [Uint8Array.of(1, 2, 3, 4)], 4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write" });
  const reason = new Error(`${phase} failed`);
  if (phase === "spill") {
    host.hooks.write = async () => { if (host.events.stageWrites === 4) throw reason; };
    await expect(descriptor.write(new Uint8Array(8), null)).rejects.toBe(reason);
  } else {
    await descriptor.write(new Uint8Array(8), null);
    host.hooks.publish = async () => { throw reason; };
    await expect(descriptor.sync(false)).rejects.toBe(reason);
  }
  await expect(descriptor.write(Uint8Array.of(9), null)).rejects.toBe(reason);
  await expect(descriptor.close()).rejects.toBe(reason);
  expect(host.files.get("/file")!.chunks[0]).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(host.events.publications).toBe(0);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it.each(["spill", "publication"])("observes cancellation during %s and discards private content", async phase => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  const controller = new AbortController();
  if (phase === "spill") {
    host.hooks.write = async () => { controller.abort(false); };
    await expect(descriptor.write(new Uint8Array(8), null, { signal: controller.signal })).rejects.toBe(false);
  } else {
    await descriptor.write(new Uint8Array(8), null);
    host.hooks.publish = async () => { controller.abort(false); };
    await expect(descriptor.sync(false, { signal: controller.signal })).rejects.toBe(false);
  }
  await expect(descriptor.close()).rejects.toBe(false);
  expect(host.files.get("/file")!.stat.size).toBe(0);
  expect(host.events.publications).toBe(1);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("retires both version leases even when spill cleanup fails after publication", async () => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4, maxOpenFiles: 1 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  await descriptor.write(new Uint8Array(8), null);
  const reason = new Error("staging cleanup failed");
  host.hooks.close = async () => { throw reason; };
  await expect(descriptor.close()).rejects.toBe(reason);
  expect(host.files.get("/file")!.stat.size).toBe(8);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
  const next = await fs.open!("/file", { access: "read" });
  await next.close();
});

it("drains a staging handle acquired after cancellation and preserves the cancellation reason", async () => {
  const host = fixture(4);
  const createStaging = host.store.createStaging!;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  host.store.createStaging = async (...args) => {
    const staging = await createStaging(...args);
    entered();
    await gate;
    return staging;
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  const controller = new AbortController();
  let settled = false;
  const writing = descriptor.write(new Uint8Array(4), null, { signal: controller.signal }).catch(error => { settled = true; return { error }; });
  await started;
  controller.abort(null);
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  release();
  expect(await writing).toEqual({ error: null });
  await expect(descriptor.close()).rejects.toBe(null);
  expect(host.events.closed).toBe(1);
  expect(host.events.stageWrites).toBe(0);
  expect(host.events.released).toBe(host.events.acquired);
});

it.each(["writePage", "truncate"])("never publishes partially failed private %s mutations", async method => {
  const host = fixture(4);
  const reason = new Error("unknown private mutation outcome");
  const createStaging = host.store.createStaging!;
  let failing = false;
  host.store.createStaging = async (...args) => {
    const staging = await createStaging(...args);
    return {
      ...staging,
      async writePage(...values) { await staging.writePage(...values); if (failing && method === "writePage") throw reason; },
      async truncate(...values) { await staging.truncate(...values); if (failing && method === "truncate") throw reason; },
    };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  await descriptor.write(Uint8Array.of(1, 2, 3, 4), null);
  failing = true;
  await expect(method === "writePage" ? descriptor.write(Uint8Array.of(5, 6, 7, 8), null) : descriptor.truncate(2)).rejects.toBe(reason);
  await expect(descriptor.close()).rejects.toBe(reason);
  expect(host.files.get("/file")!.stat.size).toBe(0);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("releases a read-page reservation on invalid data without stranding other handles", async () => {
  const host = fixture(4);
  const createStaging = host.store.createStaging!;
  let invalid = true;
  host.store.createStaging = async (...args) => {
    const staging = await createStaging(...args);
    return { ...staging, async readPage(...values) {
      if (invalid) return new Uint8Array(5);
      return staging.readPage(...values);
    } };
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const first = await fs.open!("/first", { access: "readwrite", creation: "ifMissing" });
  await first.write(new Uint8Array(4), null);
  await expect(first.read(new Uint8Array(4), 0)).rejects.toMatchObject({ code: "EIO" });
  invalid = false;
  const second = await fs.open!("/second", { access: "write", creation: "ifMissing" });
  await second.write(new Uint8Array(8), null);
  await Promise.all([first.close(), second.close()]);
  expect(host.events.closed).toBe(2);
  expect(host.events.released).toBe(host.events.acquired);
});

it("does not roll back acknowledged publication when cancellation arrives with its receipt", async () => {
  const host = fixture(4);
  const controller = new AbortController();
  const publish = host.store.publish!;
  host.store.publish = async (...args) => {
    const receipt = await publish(...args);
    if (args[3].size > 0) controller.abort(false);
    return receipt;
  };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  await descriptor.write(new Uint8Array(8), null);
  await expect(descriptor.sync(false, { signal: controller.signal })).rejects.toBe(false);
  await expect(descriptor.close()).rejects.toBe(false);
  expect(host.files.get("/file")!.stat.size).toBe(8);
  expect(host.events.publications).toBe(2);
  expect(host.events.closed).toBe(1);
  expect(host.events.released).toBe(host.events.acquired);
});

it("keeps previously accepted bytes after a later write is refused before mutation admission", async () => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  await descriptor.write(Uint8Array.of(1, 2, 3, 4), null);
  const controller = new AbortController();
  controller.abort(false);
  await expect(descriptor.write(new Uint8Array(4), null, { signal: controller.signal })).rejects.toBe(false);
  await descriptor.close();
  expect(host.files.get("/file")!.chunks[0]).toEqual(Uint8Array.of(1, 2, 3, 4));
  expect(host.events.closed).toBe(1);
});

it("requires backend authorization before acquiring private staging", async () => {
  const host = fixture(4);
  host.store.acquire = async () => { throw new FsError("EACCES"); };
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 4 });
  await expect(fs.open!("/file", { access: "write", creation: "ifMissing" })).rejects.toMatchObject({ code: "EACCES" });
  expect(host.events.created).toBe(0);
  expect(host.events.publications).toBe(0);
});

it("rejects a spill budget smaller than one page instead of enlarging it", async () => {
  const host = fixture(4);
  const fs = withObjectFileDescriptors(host.namespace, host.store, { chunkBytes: 4, maxStagedBytes: 3 });
  const descriptor = await fs.open!("/file", { access: "write", creation: "ifMissing" });
  await expect(descriptor.write(Uint8Array.of(1), null)).rejects.toMatchObject({ code: "ENOSPC" });
  await expect(descriptor.close()).rejects.toMatchObject({ code: "ENOSPC" });
  expect(host.events.stageWrites).toBe(0);
  expect(host.events.closed).toBe(host.events.created);
  expect(host.events.released).toBe(host.events.acquired);
});
