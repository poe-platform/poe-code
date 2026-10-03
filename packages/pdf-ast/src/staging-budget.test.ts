import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "./source.js";
import { PdfStagingStorage } from "./staging-budget.js";

it("shares live staging admission across independent sources and reuses released capacity", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 100);
  const first = await PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(60)]);
  expect(storage.liveBytes).toBe(60);
  await expect(PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(41)])).rejects.toThrow("staging");
  expect(storage.liveBytes).toBe(60);
  const second = await PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(40)]);
  expect(storage.liveBytes).toBe(100);
  await first.close(); await first.close(); expect(storage.liveBytes).toBe(40);
  const third = await PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(60)]);
  await Promise.all([second.close(), third.close()]); expect(storage.liveBytes).toBe(0);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("charges concurrent pending writes before calling the backend", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = fs.createStagedFile!.bind(fs); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const entered = vi.fn();
  vi.spyOn(fs, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await original(...args);
    return { ...staged, writer: { finish: opts => staged.writer!.finish(opts), async write(bytes, opts) { entered(); await pending; await staged.writer!.write(bytes, opts); } } };
  });
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 100);
  const parent = await fs.stat("/scratch");
  const a = await storage.fs.createStagedFile!("/scratch/a", "bytes", { type: "file", data: new Uint8Array() }, { parent, retainCleanup: true });
  const b = await storage.fs.createStagedFile!("/scratch/b", "bytes", { type: "file", data: new Uint8Array() }, { parent, retainCleanup: true });
  const write = a.writer!.write(new Uint8Array(60));
  await expect(b.writer!.write(new Uint8Array(41))).rejects.toThrow("staging");
  expect(entered).toHaveBeenCalledOnce(); expect(storage.liveBytes).toBe(60);
  release(); await write;
  await Promise.all([a.cleanup!.remove(), b.cleanup!.remove()]);
  await Promise.all([a.cleanup!.close(), b.cleanup!.close()]); expect(storage.liveBytes).toBe(0);
});

it("retains admission for uncertain writes until successful retained cleanup", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = fs.createStagedFile!.bind(fs); const failure = new Error("write response lost");
  vi.spyOn(fs, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await original(...args);
    return { ...staged, writer: { finish: opts => staged.writer!.finish(opts), async write(bytes, opts) { await staged.writer!.write(bytes, opts); throw failure; } } };
  });
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 100);
  await expect(PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(60)])).rejects.toBe(failure);
  expect(storage.liveBytes).toBe(0); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("does not refund uncertain cleanup or conceal its original failure", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const original = fs.createStagedFile!.bind(fs); const failure = new Error("cleanup unavailable");
  vi.spyOn(fs, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await original(...args);
    return { ...staged, cleanup: { remove: async () => { throw failure; }, close: () => staged.cleanup!.close() } };
  });
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 100);
  const source = await PdfFileSource.fromStream(storage.fs, storage.directory, [new Uint8Array(60)]);
  await expect(source.close()).rejects.toBe(failure); expect(storage.liveBytes).toBe(60);
  await expect(source.close()).rejects.toBe(failure); expect(storage.liveBytes).toBe(60);
});

it("accounts for an object index and decoded content in the same operation", async () => {
  const { PdfObjectIndex } = await import("./cos/object-index.js");
  const { parseContentStreamEvents } = await import("./content/range-events.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 128);
  const index = await PdfObjectIndex.build([
    { type: "uncompressed", objectNumber: 1, generationNumber: 0, offset: 10 },
    { type: "uncompressed", objectNumber: 2, generationNumber: 0, offset: 20 },
  ], storage, { chunkBytes: 32, cacheBytes: 32 });
  expect(storage.liveBytes).toBe(64);
  const bytes = new TextEncoder().encode("q ".repeat(40));
  const denied = parseContentStreamEvents([bytes], storage, { chunkBytes: 32 });
  await expect(denied.next()).rejects.toThrow("aggregate staging");
  expect(storage.liveBytes).toBe(64);
  expect(await index.get(2)).toMatchObject({ objectNumber: 2, offset: 20 });
  await index.close(); expect(storage.liveBytes).toBe(0);
  const allowed = parseContentStreamEvents([bytes], storage, { chunkBytes: 32 });
  expect((await allowed.next()).value?.kind).toBe("begin-group"); expect(storage.liveBytes).toBe(bytes.length);
  await allowed.return(); expect(storage.liveBytes).toBe(0);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits initial payloads before creation and preserves existing filesystem capabilities", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const create = vi.spyOn(fs, "createStagedFile");
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 4);
  expect(storage.fs.capabilities).toBe(fs.capabilities);
  const parent = await storage.fs.stat("/scratch");
  await expect(storage.fs.createStagedFile!("/scratch/a", "bytes", { type: "file", data: new Uint8Array(5) }, { parent, retainCleanup: true })).rejects.toThrow("staging");
  expect(create).not.toHaveBeenCalled(); expect(storage.liveBytes).toBe(0);
  const entry = await storage.fs.createStagedFile!("/scratch/a", "bytes", { type: "file", data: new Uint8Array(4) }, { parent, retainCleanup: true });
  expect(storage.liveBytes).toBe(4);
  await Promise.all([entry.cleanup!.remove(), entry.cleanup!.remove()]);
  await entry.cleanup!.close(); expect(storage.liveBytes).toBe(0);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("accepts a frozen caller filesystem without violating proxy invariants", () => {
  const fs = createMemoryFileSystem();
  Object.defineProperty(fs, "createStagedFile", { value: fs.createStagedFile!.bind(fs), writable: false, configurable: false });
  const storage = new PdfStagingStorage({ fs, directory: "/scratch" }, 100);
  expect(() => storage.fs.createStagedFile).not.toThrow();
  expect("createStagedFile" in storage.fs).toBe(true);
});
