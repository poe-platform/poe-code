import { describe, expect, it, vi } from "vitest";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "./source.js";

// External-storage spy: records byte counts and checks content, but stores no
// payload in the test process. Replayed ranges are generated on demand.
function externalStorage() {
  let size = 0;
  let revision = 0;
  let identity = "owned-pdf";
  const scope = {};
  const stat = (): FileStat => ({ type: "file", size, identityScope: scope, opaqueIdentity: identity,
    revision, mode: 0o600, mtimeMs: revision, ctimeMs: revision, atimeMs: 0 });
  const read = vi.fn(async (position: number, count: number) => Uint8Array.from({ length: Math.min(count, size - position) }, (_, i) => (position + i) % 251));
  const readerClose = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  const cleanupClose = vi.fn(async () => {});
  const write = vi.fn(async (bytes: Uint8Array) => {
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(16);
    for (const [i, byte] of bytes.entries()) expect(byte).toBe((size + i) % 251);
    size += bytes.length;
    revision++;
  });
  const finish = vi.fn(async () => stat());
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: vi.fn(async () => ({ ...stat(), type: "directory" })),
    createStagedFile: vi.fn(async (path: string) => ({ file: { path: `${path}/bytes`, stat: stat() },
      cleanup: { remove, close: cleanupClose }, writer: { write, finish } })),
    openReadFile: vi.fn(async () => ({ stat: async () => stat(), read, close: readerClose })),
    readFile: vi.fn(() => { throw new Error("whole-file reads forbidden"); }),
    writeFile: vi.fn(() => { throw new Error("whole-file writes forbidden"); }),
  } as unknown as FileSystem;
  return { fs, write, finish, read, remove, cleanupClose, readerClose,
    replace() { identity = "replacement"; }, mutate() { revision++; }, get size() { return size; } };
}

const options = { chunkBytes: 16, cacheBytes: 32 };

async function* input(length: number) {
  const reused = new Uint8Array(23);
  for (let position = 0; position < length; position += reused.length) {
    const count = Math.min(reused.length, length - position);
    for (let i = 0; i < count; i++) reused[i] = (position + i) % 251;
    yield reused.subarray(0, count);
  }
}

describe("caller-owned PDF staging", () => {
  it("uses the real safe-fs retained-staging contract and removes its owned directory", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/authorized");
    const source = await PdfFileSource.fromStream(fs, "/authorized", input(64), options);
    expect(await source.read(10, 4)).toEqual(new Uint8Array([10, 11, 12, 13]));
    expect(await fs.readdir("/authorized")).toHaveLength(1);
    await source.close();
    expect(await fs.readdir("/authorized")).toHaveLength(0);
  });

  it("spills reused input chunks through bounded writes and owns cleanup until source close", async () => {
    const backend = externalStorage();
    const source = await PdfFileSource.fromStream(backend.fs, "/authorized", input(1000), options);
    expect(backend.size).toBe(1000);
    expect(source.size).toBe(1000);
    expect(backend.fs.createStagedFile).toHaveBeenCalledOnce();
    expect(backend.fs.readFile).not.toHaveBeenCalled();
    expect(backend.fs.writeFile).not.toHaveBeenCalled();
    expect(backend.remove).not.toHaveBeenCalled();
    expect(await source.read(991, 9)).toEqual(Uint8Array.from({ length: 9 }, (_, i) => (991 + i) % 251));
    await source.close();
    await source.close();
    expect(backend.readerClose).toHaveBeenCalledOnce();
    expect(backend.remove).toHaveBeenCalledOnce();
    expect(backend.cleanupClose).toHaveBeenCalledOnce();
  });

  it("detaches Buffer subclasses instead of passing their pooled backing storage", async () => {
    const backend = externalStorage();
    const pooled = Buffer.from(Array.from({ length: 23 }, (_, i) => i));
    const source = await PdfFileSource.fromStream(backend.fs, "/authorized", [pooled], options);
    expect(await source.read(0, 4)).toEqual(new Uint8Array([0, 1, 2, 3]));
    await source.close();
  });

  it("does not pull another input while a storage write is pending", async () => {
    const backend = externalStorage();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = backend.write.getMockImplementation()!;
    backend.write.mockImplementationOnce(async bytes => { await gate; await write(bytes); });
    let pulled = 0;
    async function* chunks() { for await (const chunk of input(46)) { pulled++; yield chunk; } }
    const pending = PdfFileSource.fromStream(backend.fs, "/authorized", chunks(), options);
    // Drain the acquisition microtasks until the first backend operation starts.
    while (backend.write.mock.calls.length === 0) await Promise.resolve();
    expect(pulled).toBe(1);
    release();
    const source = await pending;
    expect(pulled).toBe(2);
    await source.close();
  });

  it("charges input before writing and closes the input iterator on overflow", async () => {
    const backend = externalStorage();
    let returned = false;
    async function* chunks() { try { yield* input(46); } finally { returned = true; } }
    await expect(PdfFileSource.fromStream(backend.fs, "/authorized", chunks(), { ...options, maxInputBytes: 22 }))
      .rejects.toMatchObject({ code: "E_LIMIT" });
    expect(backend.write).not.toHaveBeenCalled();
    expect(backend.finish).not.toHaveBeenCalled();
    expect(returned).toBe(true);
    expect(backend.remove).toHaveBeenCalledOnce();
    expect(backend.cleanupClose).toHaveBeenCalledOnce();
  });

  it("preserves write failures over cleanup failures", async () => {
    const backend = externalStorage();
    const failure = new Error("external write failed");
    backend.write.mockRejectedValueOnce(failure);
    backend.remove.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(PdfFileSource.fromStream(backend.fs, "/authorized", input(100), options)).rejects.toBe(failure);
    expect(backend.finish).not.toHaveBeenCalled();
    expect(backend.cleanupClose).toHaveBeenCalledOnce();
  });

  it("cleans up after cancellation during a write", async () => {
    const backend = externalStorage();
    const controller = new AbortController();
    const failure = new Error("cancelled staging");
    backend.write.mockImplementationOnce(async () => { controller.abort(failure); });
    await expect(PdfFileSource.fromStream(backend.fs, "/authorized", input(100), { ...options, signal: controller.signal }))
      .rejects.toBe(failure);
    expect(backend.write).toHaveBeenCalledOnce();
    expect(backend.finish).not.toHaveBeenCalled();
    expect(backend.remove).toHaveBeenCalledOnce();
  });

  it("cancels a pending input read and requests iterator cleanup", async () => {
    const backend = externalStorage();
    const controller = new AbortController();
    const failure = new Error("cancelled input");
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const chunks: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next() { controller.abort(failure); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
          return: returned,
        };
      },
    };
    await expect(PdfFileSource.fromStream(backend.fs, "/authorized", chunks, { ...options, signal: controller.signal }))
      .rejects.toBe(failure);
    expect(returned).toHaveBeenCalledOnce();
    expect(backend.remove).toHaveBeenCalledOnce();
  }, 250);

  it("rejects replacement between sealing and acquisition", async () => {
    const backend = externalStorage();
    const finish = backend.finish.getMockImplementation()!;
    backend.finish.mockImplementationOnce(async () => { const sealed = await finish(); backend.replace(); return sealed; });
    await expect(PdfFileSource.fromStream(backend.fs, "/authorized", input(10), options))
      .rejects.toMatchObject({ code: "E_CAPABILITY" });
    expect(backend.readerClose).toHaveBeenCalledOnce();
    expect(backend.remove).toHaveBeenCalledOnce();
  });

  it("still removes staging when the reader close fails", async () => {
    const backend = externalStorage();
    const failure = new Error("reader close failed");
    backend.readerClose.mockRejectedValueOnce(failure);
    const source = await PdfFileSource.fromStream(backend.fs, "/authorized", input(10), options);
    await expect(source.close()).rejects.toBe(failure);
    expect(backend.remove).toHaveBeenCalledOnce();
    expect(backend.cleanupClose).toHaveBeenCalledOnce();
  });

  it("rejects modifications even when the requested range is cached", async () => {
    const backend = externalStorage();
    const source = await PdfFileSource.fromStream(backend.fs, "/authorized", input(32), options);
    await source.read(0, 4);
    backend.mutate();
    await expect(source.read(0, 4)).rejects.toMatchObject({ code: "E_CAPABILITY" });
    await source.close();
  });
});
