import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import type { PdfXRefEntry } from "../ast.js";
import { PdfFileSource } from "../source.js";
import { openPdfCrossReference } from "./cross-reference.js";
import { PdfObjectIndex } from "./object-index.js";

// This backend stores only constant-size descriptors for each live sorted run.
// Record bytes are checked on write and generated on read, never RAM-spooled.
function externalOracle() {
  const scope = {};
  const live = new Map<string, { first: number; count: number; identity: string; revision: number; visited: boolean }>();
  let peakFiles = 0;
  let maxWrite = 0;
  let reads = 0;
  const stat = (state: { count: number; identity: string; revision: number }): FileStat => ({
    type: "file", size: state.count * 32, identityScope: scope, opaqueIdentity: state.identity, revision: state.revision, mode: 0o600, mtimeMs: state.revision, ctimeMs: state.revision, atimeMs: 0,
  });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const state = { first: -1, count: 0, identity: path, revision: 0, visited: false };
      const file = path + "/bytes";
      live.set(file, state);
      peakFiles = Math.max(peakFiles, live.size);
      return { file: { path: file, stat: stat(state) }, cleanup: { remove: async () => { live.delete(file); }, close: async () => {} },
        writer: { async write(bytes: Uint8Array) {
          maxWrite = Math.max(maxWrite, bytes.buffer.byteLength);
          expect(bytes.length % 32).toBe(0);
          for (let offset = 0; offset < bytes.length; offset += 32) {
            const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 32);
            const key = view.getFloat64(0);
            if (state.first < 0) { state.first = key; state.visited = key === 9 && view.getFloat64(8) === 0; }
            expect(key).toBe(state.first + state.count);
            expect(view.getFloat64(8)).toBe(state.visited ? 0 : key * 10);
            expect(view.getFloat64(16)).toBe(0);
            expect(view.getFloat64(24)).toBe(1);
            state.count++;
          }
          state.revision++;
        }, finish: async () => stat(state) } };
    },
    async openReadFile(path: string) {
      const state = live.get(path)!;
      return { stat: async () => stat(state), close: async () => {}, async read(position: number, length: number) {
        reads++;
        const result = new Uint8Array(Math.min(length, state.count * 32 - position));
        const record = new Uint8Array(32);
        const view = new DataView(record.buffer);
        for (let i = 0; i < result.length; i++) {
          const absolute = position + i;
          const key = state.first + Math.floor(absolute / 32);
          view.setFloat64(0, key); view.setFloat64(8, state.visited ? 0 : key * 10); view.setFloat64(16, 0); view.setFloat64(24, 1);
          result[i] = record[absolute % 32]!;
        }
        return result;
      } };
    },
    readFile() { throw new Error("whole-file reads forbidden"); },
    writeFile() { throw new Error("whole-file writes forbidden"); },
  } as unknown as FileSystem;
  return { fs, directory: "/authorized", live, get peakFiles() { return peakFiles; }, get maxWrite() { return maxWrite; }, get reads() { return reads; } };
}

async function storage() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/authorized");
  return { fs, directory: "/authorized" };
}
const options = { runEntries: 2, chunkBytes: 64, cacheBytes: 128 };

describe("externally backed PDF object index", () => {
  it("sorts arbitrary revisions and preserves the first entry, including free tombstones", async () => {
    const backing = await storage();
    const entries: PdfXRefEntry[] = [
      { objectNumber: 3, type: "free", generationNumber: 2, nextFreeObjectNumber: 0 },
      { objectNumber: 1, type: "uncompressed", generationNumber: 1, offset: 90 },
      { objectNumber: 4, type: "compressed", objectStreamNumber: 8, indexInStream: 2 },
      { objectNumber: 3, type: "uncompressed", offset: 30 },
      { objectNumber: 2, type: "uncompressed", offset: 20 },
      { objectNumber: 1, type: "uncompressed", offset: 10 },
    ];
    const index = await PdfObjectIndex.build(entries, backing, options);
    expect(index.size).toBe(4);
    expect(await index.get(1)).toMatchObject(entries[1]!);
    expect(await index.get(3)).toMatchObject(entries[0]!);
    expect(await index.get(4)).toMatchObject(entries[2]!);
    expect(await index.get(5)).toBeUndefined();
    const keys: number[] = [];
    for await (const entry of index.entries()) keys.push(entry.objectNumber);
    expect(keys).toEqual([1, 2, 3, 4]);
    expect(await backing.fs.readdir("/authorized")).toHaveLength(1);
    await index.close();
    await index.close();
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it.each([1, 2, 3, 5, 30])("keeps the last row of a revision across merge batches of %i", async runEntries => {
    const backing = await storage();
    const entries: PdfXRefEntry[] = [];
    for (let i = 0; i < 23; i++) entries.push({ objectNumber: i % 4, type: "uncompressed", offset: i });
    entries.push({ objectNumber: 1, type: "free", generationNumber: 2, nextFreeObjectNumber: 0 });
    const index = await PdfObjectIndex.build(entries, backing, { ...options, runEntries, duplicate: "last" });
    for (let i = 0; i < 4; i++) expect(await index.get(i)).toMatchObject(entries.filter(entry => entry.objectNumber === i).at(-1)!);
    await index.close();
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it("copies reused input records before asking for the next one", async () => {
    const backing = await storage();
    function* entries() {
      const entry = { objectNumber: 0, type: "uncompressed" as const, offset: 0 };
      for (let i = 10; i > 0; i--) { entry.objectNumber = i; entry.offset = i * 10; yield entry; }
    }
    const index = await PdfObjectIndex.build(entries(), backing, options);
    for (let i = 1; i <= 10; i++) expect(await index.get(i)).toMatchObject({ objectNumber: i, offset: i * 10 });
    await index.close();
  });

  it("charges entry and staging budgets, cleans failed runs and closes its input", async () => {
    const backing = await storage();
    let returned = false;
    function* entries() {
      try { for (let i = 0; i < 10; i++) yield { objectNumber: i, type: "uncompressed" as const, offset: i * 10 }; }
      finally { returned = true; }
    }
    await expect(PdfObjectIndex.build(entries(), backing, { ...options, maxEntries: 3 })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(returned).toBe(true);
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
    await expect(PdfObjectIndex.build(entries(), backing, { ...options, maxStagingBytes: 80 })).rejects.toMatchObject({ code: "E_LIMIT" });
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it("does not consume later batches while a staged write is pending", async () => {
    const backing = await storage();
    const create = backing.fs.createStagedFile!.bind(backing.fs);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(backing.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args);
      const write = staged.writer!.write.bind(staged.writer);
      return { ...staged, writer: { ...staged.writer!, write: async (...writeArgs) => { entered(); await gate; await write(...writeArgs); } } };
    });
    let consumed = 0;
    function* entries() { for (let i = 0; i < 8; i++) { consumed++; yield { objectNumber: i, type: "uncompressed" as const, offset: i }; } }
    const pending = PdfObjectIndex.build(entries(), backing, options);
    await started;
    expect(consumed).toBe(2);
    release();
    const index = await pending;
    await index.close();
  });
  it("uses external runs, bounded writes and logarithmic lookups for generated entries", async () => {
    const backing = externalOracle();
    function* entries() { for (let i = 256; i > 0; i--) yield { objectNumber: i, type: "uncompressed" as const, offset: i * 10 }; }
    const index = await PdfObjectIndex.build(entries(), backing, { ...options, runEntries: 8 });
    expect(index.size).toBe(256);
    expect(backing.maxWrite).toBeLessThanOrEqual(64);
    expect(backing.peakFiles).toBeLessThanOrEqual(8);
    expect(backing.live.size).toBe(1);
    const reads = backing.reads;
    expect(await index.get(197)).toMatchObject({ objectNumber: 197, offset: 1970 });
    expect(backing.reads - reads).toBeLessThanOrEqual(9);
    await index.close();
    expect(backing.live.size).toBe(0);
  });

  it("cancels a stalled producer and releases completed runs", async () => {
    const backing = await storage();
    const controller = new AbortController();
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    let n = 0;
    const input: AsyncIterable<PdfXRefEntry> = { [Symbol.asyncIterator]() { return {
      async next() {
        if (n < 2) return { done: false as const, value: { objectNumber: ++n, type: "uncompressed" as const, offset: n } };
        entered(); return new Promise<IteratorResult<PdfXRefEntry>>(() => {});
      }, return: returned,
    }; } };
    const pending = PdfObjectIndex.build(input, backing, { ...options, signal: controller.signal });
    const failure = new Error("cancel build");
    const result = pending.catch(error => error);
    await waiting;
    controller.abort(failure);
    expect(await result).toBe(failure);
    expect(returned).toHaveBeenCalledOnce();
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it("rejects use after close even for an empty index", async () => {
    const backing = await storage();
    const index = await PdfObjectIndex.build([], backing, options);
    expect(index.size).toBe(0);
    expect(await index.get(1)).toBeUndefined();
    await index.close();
    await expect(index.get(1)).rejects.toMatchObject({ code: "E_CAPABILITY" });
    await expect(index.entries().next()).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });

  it("preserves staging failures and removes earlier runs", async () => {
    const backing = await storage();
    const create = backing.fs.createStagedFile!.bind(backing.fs);
    const failure = new Error("staging write failed");
    let count = 0;
    vi.spyOn(backing.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args);
      if (++count !== 3) return staged;
      return { ...staged, writer: { ...staged.writer!, write: async () => { throw failure; } } };
    });
    function* entries() { for (let i = 0; i < 8; i++) yield { objectNumber: i, type: "uncompressed" as const, offset: i }; }
    await expect(PdfObjectIndex.build(entries(), backing, options)).rejects.toBe(failure);
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it("retains exact safe-integer keys, large offsets and compressed index aliases", async () => {
    const backing = await storage();
    const index = await PdfObjectIndex.build([
      { objectNumber: Number.MAX_SAFE_INTEGER, type: "uncompressed", offset: Number.MAX_SAFE_INTEGER, generationNumber: 65535 },
      { objectNumber: 4, type: "compressed", objectStreamNumber: 8, indexInObjectStream: 12 },
    ], backing, options);
    expect(await index.get(Number.MAX_SAFE_INTEGER)).toMatchObject({ offset: Number.MAX_SAFE_INTEGER, generationNumber: 65535 });
    expect(await index.get(4)).toMatchObject({ objectStreamNumber: 8, indexInStream: 12 });
    await index.close();
  });

  it("honors the build signal after construction, including empty indexes", async () => {
    const backing = await storage();
    const controller = new AbortController();
    const index = await PdfObjectIndex.build([], backing, { ...options, signal: controller.signal });
    const failure = new Error("cancel index");
    controller.abort(failure);
    await expect(index.get(1)).rejects.toBe(failure);
    await index.close();
    expect(await backing.fs.readdir("/authorized")).toEqual([]);
  });

  it("does not retain a cancellation reaction for every index entry", async () => {
    const backing = externalOracle();
    const signal = new AbortController().signal;
    const attachments = new WeakMap<object, number>();
    let maximum = 0;
    const then = Promise.prototype.then;
    const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
    Object.defineProperty(Promise.prototype, "then", { ...descriptor, value: new Proxy(then, {
      apply(target, receiver: object, args) {
        const count = (attachments.get(receiver) ?? 0) + 1;
        attachments.set(receiver, count);
        maximum = Math.max(maximum, count);
        return Reflect.apply(target, receiver, args);
      },
    }) });
    function* entries() { for (let i = 128; i > 0; i--) yield { objectNumber: i, type: "uncompressed" as const, offset: i * 10 }; }
    let index: PdfObjectIndex | undefined;
    try {
      index = await PdfObjectIndex.build(entries(), backing, { ...options, runEntries: 8, signal });
      expect(maximum).toBeLessThan(32);
    } finally { Object.defineProperty(Promise.prototype, "then", descriptor); await index?.close(); }
  });

  it.each([65, 257])("builds a %i-row document index without input or staging payloads in RAM", async count => {
    const backend = externalOracle();
    const head = `%PDF-1.7\nxref\n1 ${count}\n`;
    const tail = `trailer << /Root 1 0 R /Size ${count + 1} >>\nstartxref\n9\n%%EOF`;
    const size = head.length + count * 20 + tail.length;
    const scratch = new Uint8Array(64);
    let maximumRead = 0;
    const input = {
      capabilities: { retainedRead: true },
      async openReadFile() { return {
        stat: async () => ({ type: "file", size }), close: async () => {},
        async read(position: number, length: number) {
          maximumRead = Math.max(maximumRead, length);
          expect(length).toBeLessThanOrEqual(64);
          const available = Math.min(length, size - position);
          for (let i = 0; i < available; i++) {
            const offset = position + i;
            if (offset < head.length) scratch[i] = head.charCodeAt(offset);
            else if (offset >= head.length + count * 20) scratch[i] = tail.charCodeAt(offset - head.length - count * 20);
            else {
              const row = Math.floor((offset - head.length) / 20) + 1;
              const encoded = `${String(row * 10).padStart(10, "0")} 00000 n \n`;
              scratch[i] = encoded.charCodeAt((offset - head.length) % 20);
            }
          }
          return scratch.subarray(0, available);
        },
      }; },
      readFile() { throw new Error("full input reads forbidden"); },
    } as unknown as FileSystem;
    const source = await PdfFileSource.open(input, "/generated.pdf", { chunkBytes: 64, cacheBytes: 128 });
    const result = await openPdfCrossReference(source, backend, { index: { runEntries: 32, chunkBytes: 64, cacheBytes: 128 } });
    expect(result.index.size).toBe(count);
    expect(await result.index.get(count)).toMatchObject({ offset: count * 10 });
    expect(maximumRead).toBeLessThanOrEqual(64);
    expect(backend.maxWrite).toBeLessThanOrEqual(64);
    expect(backend.peakFiles).toBeLessThanOrEqual(20);
    expect(backend.live.size).toBe(1);
    await result.index.close();
    expect(backend.live.size).toBe(0);
    await source.close();
  });

});
