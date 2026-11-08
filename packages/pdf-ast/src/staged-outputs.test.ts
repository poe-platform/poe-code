import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfStagedOutputs } from "./staged-outputs.js";

const bytes = (value: string) => new TextEncoder().encode(value);
async function* chunks(value: string) { yield bytes(value); }
async function fixture() { const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); return { fs, directory: "/scratch" }; }

describe("retained named PDF outputs", () => {
  it("keeps first filename order and last payload without a payload map", async () => {
    const storage = await fixture();
    const outputs = await PdfStagedOutputs.create(storage, [
      { name: "x", chunks: chunks("old") }, { name: "y", chunks: chunks("middle") }, { name: "x", chunks: chunks("new") },
    ], { chunkBytes: 32 });
    const actual = [];
    for await (const output of outputs.entries()) {
      let text = ""; for await (const chunk of output.contents()) { expect(chunk.length).toBeLessThanOrEqual(32); text += new TextDecoder().decode(chunk); }
      actual.push([output.name, text]);
    }
    expect(actual).toEqual([["x", "new"], ["y", "middle"]]);
    await outputs.close(); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("preserves exact Unicode names and reusable payload chunks", async () => {
    const storage = await fixture(); const data = new Uint8Array(32);
    async function* input() { for (let i = 0; i < 20; i++) { data.fill(i); yield data; } }
    const outputs = await PdfStagedOutputs.create(storage, [{ name: "\ud800-é-😀", chunks: input() }], { chunkBytes: 32 });
    const output = (await outputs.entries().next()).value!; expect(output.name).toBe("\ud800-é-😀");
    let offset = 0; for await (const chunk of output.contents()) { for (const byte of chunk) expect(byte).toBe(Math.floor(offset++ / 32)); }
    expect(offset).toBe(640); await outputs.close(); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("finishes reading all inputs before exposing publication candidates and cleans a later failure", async () => {
    const storage = await fixture();
    async function* fail() { yield bytes("part"); throw new Error("late output failure"); }
    await expect(PdfStagedOutputs.create(storage, [{ name: "first", chunks: chunks("okay") }, { name: "last", chunks: fail() }])).rejects.toThrow("late output failure");
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("cancels a stalled payload producer and requests its cleanup", async () => {
    const storage = await fixture(); const controller = new AbortController(); const failure = new Error("cancel outputs");
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const input: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
      next() { controller.abort(failure); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: returned,
    }; } };
    await expect(PdfStagedOutputs.create(storage, [{ name: "x", chunks: input }], { signal: controller.signal })).rejects.toBe(failure);
    expect(returned).toHaveBeenCalledOnce(); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("cancels a stalled entry producer and requests its cleanup", async () => {
    const storage = await fixture(); const controller = new AbortController(); const failure = new Error("cancel entries");
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    const input = { [Symbol.asyncIterator]() { return {
      next() { controller.abort(failure); return new Promise<IteratorResult<never>>(() => {}); }, return: returned,
    }; } };
    await expect(PdfStagedOutputs.create(storage, input, { signal: controller.signal })).rejects.toBe(failure);
    expect(returned).toHaveBeenCalledOnce(); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("handles an empty archive", async () => {
    const storage = await fixture(); const outputs = await PdfStagedOutputs.create(storage, []);
    expect((await outputs.entries().next()).done).toBe(true);
    await outputs.close(); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("awaits the backing writer before advancing a reusable producer", async () => {
    const storage = await fixture(); const create = storage.fs.createStagedFile!.bind(storage.fs);
    let pending = false; let peak = 0;
    vi.spyOn(storage.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args);
      return { ...staged, writer: { finish: options => staged.writer!.finish(options), async write(bytes, options) {
        expect(pending).toBe(false); pending = true; peak = Math.max(peak, bytes.buffer.byteLength);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await staged.writer!.write(bytes, options); pending = false;
      } } };
    });
    async function* input() {
      const data = new Uint8Array(32);
      for (let i = 0; i < 8; i++) { expect(pending).toBe(false); data.fill(i); yield data; }
    }
    const outputs = await PdfStagedOutputs.create(storage, [{ name: "x", chunks: input() }], { chunkBytes: 32 });
    expect(peak).toBeLessThanOrEqual(32); await outputs.close();
  });

  it("charges data and concurrent name/index merge runs against one staging budget", async () => {
    const storage = await fixture(); const maximum = 5500; let live = 0; let peak = 0;
    const create = storage.fs.createStagedFile!.bind(storage.fs);
    vi.spyOn(storage.fs, "createStagedFile").mockImplementation(async (...args) => {
      const staged = await create(...args); let size = 0;
      return { ...staged, writer: { finish: options => staged.writer!.finish(options), async write(bytes, options) {
        expect(live + bytes.length).toBeLessThanOrEqual(maximum);
        await staged.writer!.write(bytes, options); size += bytes.length; live += bytes.length; peak = Math.max(peak, live);
      } }, cleanup: { async remove(options) { await staged.cleanup!.remove(options); live -= size; size = 0; }, close: () => staged.cleanup!.close() } };
    });
    async function* input() { for (let i = 0; i < 40; i++) yield { name: `file-${i}`, chunks: [new Uint8Array(96)] }; }
    await expect(PdfStagedOutputs.create(storage, input(), { maxStagingBytes: maximum })).rejects.toThrow("limit");
    expect(peak).toBeLessThanOrEqual(maximum); expect(live).toBe(0); expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });

  it("admits staging and names before writes and cleans on failure", async () => {
    const storage = await fixture();
    await expect(PdfStagedOutputs.create(storage, [{ name: "x", chunks: chunks("data") }], { maxStagingBytes: 20 })).rejects.toThrow("limit");
    await expect(PdfStagedOutputs.create(storage, [{ name: "long", chunks: chunks("data") }], { maxNameChars: 3 })).rejects.toThrow("limit");
    expect(await storage.fs.readdir("/scratch")).toEqual([]);
  });
});

// Scalar descriptors only: the archive payload is checked on write and
// regenerated on reads, never retained by this external-storage oracle.
it.each([8192, 524288])("stages %i generated payload bytes without an in-memory spool", async size => {
  const scope = {}; let created = 0; let outstanding = 0; let peak = 0;
  type Run = { data: boolean; size: number; revision: number; identity: string };
  const live = new Map<string, Run>();
  const stat = (run: Run) => ({ type: "file" as const, size: run.size, identityScope: scope, opaqueIdentity: run.identity,
    revision: run.revision, mode: 0o600, mtimeMs: run.revision, ctimeMs: run.revision, atimeMs: 0 });
  const expected = (run: Run, position: number, length: number) => {
    const bytes = new Uint8Array(length);
    const tail = new Uint8Array(run.data ? 24 : 32); const view = new DataView(tail.buffer);
    if (run.data) { view.setFloat64(8, 1); view.setFloat64(16, size); }
    else { view.setFloat64(8, size + 26); view.setFloat64(24, 1); }
    for (let i = 0; i < length; i++) {
      const at = position + i;
      bytes[i] = run.data ? at < 2 ? at * 120 : at < size + 2 ? (at - 2) % 251 : tail[at - size - 2]! : tail[at]!;
    }
    return bytes;
  };
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const run: Run = { data: created++ === 0, size: 0, revision: 0, identity: path }; live.set(path, run);
      return { file: { path, stat: stat(run) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) {
          outstanding += bytes.length; peak = Math.max(peak, outstanding);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(2048);
          expect(bytes).toEqual(expected(run, run.size, bytes.length));
          await Promise.resolve(); run.size += bytes.length; run.revision++; outstanding -= bytes.length;
        }, finish: async () => stat(run),
      } };
    },
    async openReadFile(path: string) {
      const run = live.get(path)!;
      return { stat: async () => stat(run), close: async () => {}, async read(position: number, length: number) {
        expect(length).toBeLessThanOrEqual(2048); return expected(run, position, Math.min(length, run.size - position));
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  async function* payload() {
    const chunk = new Uint8Array(2048);
    for (let at = 0; at < size; at += chunk.length) { expect(outstanding).toBe(0); for (let i = 0; i < chunk.length; i++) chunk[i] = (at + i) % 251; yield chunk; }
  }
  const outputs = await PdfStagedOutputs.create({ fs, directory: "/external" }, [{ name: "x", chunks: payload() }], { chunkBytes: 2048 });
  let read = 0;
  for await (const entry of outputs.entries()) {
    expect(entry.name).toBe("x"); expect(entry.size).toBe(size);
    for await (const bytes of entry.contents()) { expect(bytes).toEqual(expected({ data: true } as Run, read + 2, bytes.length)); read += bytes.length; }
  }
  expect(read).toBe(size); expect(peak).toBeLessThanOrEqual(2048);
  await outputs.close(); expect(live.size).toBe(0);
});
