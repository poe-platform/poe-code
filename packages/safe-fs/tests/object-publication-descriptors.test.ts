import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { PythonFileSystem } from "../src/python/index.js";
import { FsError } from "../src/contracts/errors.js";
import { dirname } from "../src/contracts/virtual-path.js";
import type { FileStat } from "../src/contracts/filesystem.js";
import { withObjectFileDescriptors, type ObjectFilePublicationStore, type ObjectFileVersion } from "../src/fs/object-publication/index.js";
import { createObjectFilePublicationConformanceCases } from "../src/testing/object-publication.js";

function publicationStore(storage: MemoryFileSystem) {
  const bindings = new Map<string, { parent: FileStat; expected: FileStat }>();
  const events = { acquired: 0, released: 0, publications: 0, largestRead: 0 };
  const snapshot = (data: Uint8Array, stat: FileStat, parent: FileStat): ObjectFileVersion => {
    const revision = `${parent.ino}:${stat.ino}:${stat.revision}`;
    bindings.set(revision, { parent, expected: stat });
    events.acquired++;
    let closed = false;
    return {
      revision, stat,
      async read(position, maxBytes, options) {
        options?.signal?.throwIfAborted();
        if (closed) throw new FsError("EBADF");
        events.largestRead = Math.max(events.largestRead, maxBytes);
        return data.slice(position, position + maxBytes);
      },
      async close() { if (!closed) { closed = true; events.released++; } },
    };
  };
  const store: ObjectFilePublicationStore = {
    async acquire(path, options) {
      try {
        const expected = await storage.stat(path, options);
        const data = await storage.readFile(path, options);
        const verified = await storage.stat(path, options);
        if (expected.ino !== verified.ino || expected.revision !== verified.revision) throw new FsError("EAGAIN");
        return snapshot(data, expected, await storage.stat(dirname(path), options));
      } catch (error) {
        if (error instanceof FsError && error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async publish(path, revision, source, options) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of source) { options.signal?.throwIfAborted(); chunks.push(chunk.slice()); size += chunk.length; }
      expect(size).toBe(options.size);
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      const binding = revision === null ? { parent: await storage.stat(dirname(path), options), expected: null } : bindings.get(revision);
      if (!binding) throw new FsError("EAGAIN");
      const stat = await storage.writeFileConditional(path, data, { ...binding, ...options });
      events.publications++;
      return snapshot(data, stat, binding.parent);
    },
  };
  return { store, events };
}

for (const conformance of createObjectFilePublicationConformanceCases({ createFixture() {
  const fs = new MemoryFileSystem();
  const { store, events } = publicationStore(fs);
  return { fs, store, root: "/", dispose() { expect(events.released).toBe(events.acquired); } };
} })) it(conformance.name, conformance.run);

it("supports Python reads over an explicitly configured whole-file object backend", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/input.txt", new TextEncoder().encode("canonical input"));
  Object.defineProperty(storage, "open", { value: undefined });
  expect(new TextDecoder().decode(await storage.readFile("/input.txt"))).toBe("canonical input");
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    const descriptor = await service.dispatch({ op: "open", args: ["/input.txt", { access: "read" }] });
    const bytes = await service.dispatch({ op: "read", args: [descriptor, 15, 0] });
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("canonical input");
  } finally { await service.close(); }
  expect(events.released).toBe(events.acquired);
  expect(events.largestRead).toBeLessThanOrEqual(4);
});

it("keeps Python null descriptors outside the authoritative object publication store", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", Uint8Array.of(1));
  const { store, events } = publicationStore(storage);
  let acquisitions = 0;
  const acquire = store.acquire;
  store.acquire = (path, options) => { acquisitions++; return acquire(path, options); };
  const fs = createDeviceFileSystem(withObjectFileDescriptors(storage, store));
  const service = new PythonFileSystem(fs, { cwd: "/" });
  try {
    for (const options of [
      { access: "read" },
      { access: "write", creation: "ifMissing", truncate: true },
      { access: "write", creation: "ifMissing", append: true },
      { access: "readwrite" },
    ]) {
      const id = await service.dispatch({ op: "open", args: ["/dev/null", options] });
      expect(await service.dispatch({ op: "fstat", args: [id] })).toMatchObject({ type: "character", size: 0 });
      if (options.access !== "read") expect(await service.dispatch({ op: "write", args: [id, Uint8Array.of(0, 255, 42), null] })).toBe(3);
      if (options.access !== "write") expect(await service.dispatch({ op: "read", args: [id, 3, null] })).toEqual(new Uint8Array());
      await service.dispatch({ op: "close", args: [id] });
    }
    expect(acquisitions).toBe(0);
    expect(events.publications).toBe(0);
    const descriptor = await fs.open("/file", { access: "write" });
    expect(descriptor.capabilities.publication).toBe("conditional");
    await descriptor.write(Uint8Array.of(2), 0);
    expect(await storage.readFile("/file")).toEqual(Uint8Array.of(1));
    await descriptor.close();
    expect(await storage.readFile("/file")).toEqual(Uint8Array.of(2));
    expect(acquisitions).toBe(1);
    expect(events.publications).toBe(1);
  } finally { await service.close(); }
});

it("pins old read versions and publishes private writer changes only on flush or close", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new TextEncoder().encode("original"));
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const reader = await fs.open!("/file", { access: "read" });
  const writer = await fs.open!("/file", { access: "readwrite" });
  expect(writer.capabilities.publication).toBe("conditional");
  await writer.write(new TextEncoder().encode("NEW"), 0);
  expect(new TextDecoder().decode(await storage.readFile("/file"))).toBe("original");
  await writer.sync(false);
  expect(new TextDecoder().decode(await storage.readFile("/file"))).toBe("NEWginal");
  const buffer = new Uint8Array(8);
  await reader.read(buffer, 0);
  expect(new TextDecoder().decode(buffer)).toBe("original");
  await writer.truncate(4);
  await writer.close();
  expect(new TextDecoder().decode(await storage.readFile("/file"))).toBe("NEWg");
  await reader.close();
  expect(events.released).toBe(events.acquired);
});

it("rejects conflicting writers without overwriting the acknowledged publication", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new Uint8Array([0]));
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const first = await fs.open!("/file", { access: "write" });
  const second = await fs.open!("/file", { access: "write" });
  await first.write(new Uint8Array([1]), 0);
  await second.write(new Uint8Array([2]), 0);
  await first.close();
  await expect(second.close()).rejects.toMatchObject({ code: "EAGAIN" });
  expect(await storage.readFile("/file")).toEqual(new Uint8Array([1]));
  expect(events.released).toBe(events.acquired);
});

it("bounds aggregate dirty pages and restores capacity after descriptor retirement", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/first", new Uint8Array(12));
  await storage.writeFile("/second", new Uint8Array(12));
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4, maxStagedBytes: 8 });
  const first = await fs.open!("/first", { access: "write" });
  const second = await fs.open!("/second", { access: "write" });
  await first.write(new Uint8Array([1]), 0);
  await second.write(new Uint8Array([2]), 0);
  await expect(first.write(new Uint8Array([3]), 8)).rejects.toMatchObject({ code: "ENOSPC" });
  await second.close();
  await first.write(new Uint8Array([3]), 8);
  await first.close();
  expect(await storage.readFile("/first")).toEqual(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0]));
  expect(events.released).toBe(events.acquired);
});

it("releases a late publication receipt when cancellation wins after the backend commits", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new Uint8Array([0]));
  const { store, events } = publicationStore(storage);
  const controller = new AbortController();
  const reason = new Error("cancelled publication");
  const publish = store.publish!;
  store.publish = async (...args) => {
    const result = await publish(...args);
    controller.abort(reason);
    return result;
  };
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write" });
  await descriptor.write(new Uint8Array([1]), 0);
  await expect(descriptor.sync(false, { signal: controller.signal })).rejects.toBe(reason);
  await expect(descriptor.close()).rejects.toBe(reason);
  expect(events.released).toBe(events.acquired);
});

it("creates exclusively, appends to its captured version, and zero-fills regrowth after truncation", async () => {
  const storage = new MemoryFileSystem();
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const created = await fs.open!("/file", { access: "readwrite", creation: "exclusive" });
  await expect(fs.open!("/file", { access: "write", creation: "exclusive" })).rejects.toMatchObject({ code: "EEXIST" });
  await created.write(new Uint8Array([1, 2, 3, 4, 5, 6]), 0);
  await created.sync(false);
  await created.truncate(2);
  await created.truncate(6);
  const buffer = new Uint8Array(6);
  await created.read(buffer, 0);
  expect(buffer).toEqual(new Uint8Array([1, 2, 0, 0, 0, 0]));
  await created.close();
  const append = await fs.open!("/file", { access: "write", append: true });
  await append.write(new Uint8Array([7]), null);
  expect(await append.getPosition!()).toBe(7);
  await append.close();
  expect(await storage.readFile("/file")).toEqual(new Uint8Array([1, 2, 0, 0, 0, 0, 7]));
  expect(events.released).toBe(events.acquired);
});

it("preserves readonly policy and rejects absent publication authority before acquisition", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new Uint8Array([1]));
  const { store, events } = publicationStore(storage);
  const readonly = withObjectFileDescriptors(new ReadOnlyFileSystem(storage), store);
  await expect(readonly.open!("/file", { access: "write" })).rejects.toMatchObject({ code: "EROFS" });
  const readerOnly = withObjectFileDescriptors(storage, { acquire: store.acquire });
  await expect(readerOnly.open!("/file", { access: "write" })).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(events.acquired).toBe(0);
  expect(events.publications).toBe(0);
  const reader = await readerOnly.open!("/file", { access: "read" });
  await reader.close();
  expect(events.released).toBe(1);
});

it("reads and updates a large immutable binary with bounded range reads and one dirty page", async () => {
  const storage = new MemoryFileSystem();
  const data = new Uint8Array(16 * 1024 * 1024);
  data[0] = 19;
  data[data.length - 1] = 31;
  await storage.writeFile("/large", data);
  storage.readdir = async () => { throw new Error("descriptor adapter must not mirror the workspace"); };
  storage.mkdir = async () => { throw new Error("flat publication must not require staging directories"); };
  const { store, events } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 65536, maxStagedBytes: 65536 });
  const descriptor = await fs.open!("/large", { access: "readwrite" });
  const buffer = new Uint8Array(1024 * 1024);
  expect(await descriptor.read(buffer, 0)).toBe(buffer.length);
  expect(buffer[0]).toBe(19);
  await descriptor.write(new Uint8Array([47]), data.length - 1);
  await descriptor.close();
  const output = await storage.readFile("/large");
  expect(output[0]).toBe(19);
  expect(output[output.length - 1]).toBe(47);
  expect(events.largestRead).toBeLessThanOrEqual(65536);
  expect(events.released).toBe(events.acquired);
});

it("bounds dirty-page metadata independently of payload bytes", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new Uint8Array([0, 0, 0]));
  const { store } = publicationStore(storage);
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 1, maxStagedBytes: 1024, maxStagedPages: 2 });
  const descriptor = await fs.open!("/file", { access: "write" });
  await expect(descriptor.write(new Uint8Array([1, 2, 3]), 0)).rejects.toMatchObject({ code: "ENOSPC" });
  await descriptor.close();
  expect(await storage.readFile("/file")).toEqual(new Uint8Array([0, 0, 0]));
});

it("drains an admitted publication-body read before retiring its immutable lease", async () => {
  const storage = new MemoryFileSystem();
  await storage.writeFile("/file", new Uint8Array(8));
  const { store, events } = publicationStore(storage);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let publishing = false;
  const acquire = store.acquire;
  store.acquire = async (...args) => {
    const value = await acquire(...args);
    return value && { ...value, async read(position, length, options) {
      if (publishing) { entered(); await gate; }
      return value.read(position, length, options);
    } };
  };
  const conflict = new FsError("EAGAIN");
  let pendingRead: Promise<unknown> | undefined;
  store.publish = async (_path, _revision, source) => {
    publishing = true;
    const iterator = source[Symbol.asyncIterator]();
    pendingRead = iterator.next();
    void pendingRead.catch(() => {});
    await started;
    throw conflict;
  };
  const fs = withObjectFileDescriptors(storage, store, { chunkBytes: 4 });
  const descriptor = await fs.open!("/file", { access: "write" });
  await descriptor.write(new Uint8Array([1]), 4);
  let closed = false;
  const closing = descriptor.close();
  void closing.then(() => { closed = true; }, () => { closed = true; });
  try {
    await started;
    await new Promise(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(events.released).toBe(0);
  } finally {
    release();
    await expect(closing).rejects.toBe(conflict);
    await Promise.allSettled([pendingRead]);
  }
  expect(events.released).toBe(events.acquired);
});
