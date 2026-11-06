import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { encodePng, encodeRgbaToPng } from "./raster.js";
import { encodeRetainedPng } from "./retained-png.js";

it.each([true, false])("preserves PNG bytes with opaque=%s and reusable small input chunks", async opaque => {
  const width = 13, height = 9; const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? opaque ? 255 : i % 256 : i * 31 % 256);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const expected = encodePng({ width, height, data: data.slice() });
  async function* input() { const bytes = new Uint8Array(7); for (let at = 0; at < data.length; at += bytes.length) { bytes.set(data.subarray(at, at + bytes.length)); yield bytes.subarray(0, Math.min(bytes.length, data.length - at)); } }
  const actual = [];
  for await (const chunk of encodeRetainedPng(width, height, input(), { fs, directory: "/scratch" }, { chunkBytes: 32 })) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(32); actual.push(...chunk); }
  expect(new Uint8Array(actual)).toEqual(expected); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("can preserve RGBA encoding and pads truncated pixels like the buffered encoder", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const data = new Uint8Array([1, 2, 3, 255, 5]);
  async function* input() { yield data; }
  const actual = []; for await (const bytes of encodeRetainedPng(2, 2, input(), { fs, directory: "/scratch" }, { alpha: "rgba" })) actual.push(...bytes);
  expect(new Uint8Array(actual)).toEqual(encodeRgbaToPng(2, 2, data)); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cleans pixel and compressed staging after consumer return", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* input() { yield new Uint8Array(400); }
  const output = encodeRetainedPng(10, 10, input(), { fs, directory: "/scratch" });
  expect((await output.next()).done).toBe(false); expect(await fs.readdir("/scratch")).not.toEqual([]);
  await output.return(); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits impossible output budgets before reading pixels", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const read = vi.fn();
  async function* input() { read(); yield new Uint8Array(4); }
  await expect(async () => { for await (const ignored of encodeRetainedPng(1, 1, input(), { fs, directory: "/scratch" }, { maxOutputBytes: 56 })) { /* drain */ } }).rejects.toThrow("limit");
  expect(read).not.toHaveBeenCalled(); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cleans staging on late producer failure and stalled-producer cancellation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" };
  async function* failure() { yield new Uint8Array(32); throw new Error("pixel failure"); }
  await expect(async () => { for await (const ignored of encodeRetainedPng(4, 4, failure(), storage)) { /* drain */ } }).rejects.toThrow("pixel failure");
  expect(await fs.readdir("/scratch")).toEqual([]);
  const controller = new AbortController(); const reason = new Error("cancel pixel read");
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
  const input = { [Symbol.asyncIterator]() { return { next() { controller.abort(reason); return new Promise<IteratorResult<Uint8Array>>(() => {}); }, return: returned }; } };
  await expect(async () => { for await (const ignored of encodeRetainedPng(4, 4, input, storage, { signal: controller.signal })) { /* drain */ } }).rejects.toBe(reason);
  expect(returned).toHaveBeenCalledOnce(); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("charges simultaneous pixel and compressed staging and output limits before writes", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const maximum = 410; let live = 0; const create = fs.createStagedFile.bind(fs);
  vi.spyOn(fs, "createStagedFile").mockImplementation(async (...args) => {
    const staged = await create(...args); let size = 0;
    return { ...staged, writer: { finish: options => staged.writer!.finish(options), async write(bytes, options) {
      expect(live + bytes.length).toBeLessThanOrEqual(maximum); await staged.writer!.write(bytes, options); size += bytes.length; live += bytes.length;
    } }, cleanup: { async remove(options) { await staged.cleanup!.remove(options); live -= size; size = 0; }, close: () => staged.cleanup!.close() } };
  });
  async function* input() { yield new Uint8Array(400); }
  await expect(async () => { for await (const ignored of encodeRetainedPng(10, 10, input(), { fs, directory: "/scratch" }, { maxStagingBytes: maximum })) { /* drain */ } }).rejects.toThrow("limit");
  expect(live).toBe(0); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves automatic alpha decisions with truncated and trailing input", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  for (const length of [0, 2, 7, 8, 9, 12]) {
    const data = new Uint8Array(length); for (let i = 3; i < length; i += 4) data[i] = 255;
    async function* input() { yield data; }
    const actual = []; for await (const bytes of encodeRetainedPng(1, 2, input(), { fs, directory: "/scratch" })) actual.push(...bytes);
    expect(new Uint8Array(actual)).toEqual(encodePng({ width: 1, height: 2, data: data.slice() }));
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});

it.each([16, 1024])("encodes %i generated rows using external storage with no retained payload", async height => {
  const { createByteCodec } = await import("@poe-code/compression");
  const width = 64, chunkBytes = 1024; const scope = {}; let created = 0; let pending = 0; let peak = 0;
  type Run = { pixels: boolean; size: number; revision: number; identity: string };
  const live = new Map<string, Run>();
  function* compressed() {
    const codec = createByteCodec({ direction: "encode", format: "zlib", chunkSize: chunkBytes }); const zero = new Uint8Array(chunkBytes);
    try {
      for (let left = height * (width * 3 + 1); left > 0; left -= chunkBytes) yield* codec.push(zero.subarray(0, Math.min(left, chunkBytes)));
      yield* codec.push(new Uint8Array(), true);
    } finally { codec.close(); }
  }
  const expected = (pixels: boolean, position: number, length: number) => {
    const result = new Uint8Array(length);
    if (pixels) { for (let i = 0; i < length; i++) if ((position + i) % 4 === 3) result[i] = 255; }
    else {
      let at = 0;
      for (const bytes of compressed()) {
        const start = Math.max(position, at), end = Math.min(position + length, at + bytes.length);
        if (start < end) result.set(bytes.subarray(start - at, end - at), start - position);
        at += bytes.length; if (at >= position + length) break;
      }
    }
    return result;
  };
  const stat = (run: Run) => ({ type: "file" as const, size: run.size, identityScope: scope, opaqueIdentity: run.identity,
    revision: run.revision, mode: 0o600, mtimeMs: run.revision, ctimeMs: run.revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const run: Run = { pixels: created++ === 0, size: 0, revision: 0, identity: path }; live.set(path, run);
      return { file: { path, stat: stat(run) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) {
          pending += bytes.length; peak = Math.max(peak, pending);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(chunkBytes); expect(bytes).toEqual(expected(run.pixels, run.size, bytes.length));
          await Promise.resolve(); run.size += bytes.length; run.revision++; pending -= bytes.length;
        }, finish: async () => stat(run),
      } };
    },
    async openReadFile(path: string) {
      const run = live.get(path)!;
      return { stat: async () => stat(run), close: async () => {}, async read(position: number, length: number) {
        expect(length).toBeLessThanOrEqual(chunkBytes); return expected(run.pixels, position, Math.min(length, run.size - position));
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  async function* input() {
    const bytes = expected(true, 0, chunkBytes);
    for (let at = 0; at < width * height * 4; at += bytes.length) { expect(pending).toBe(0); yield bytes; }
  }
  let size = 0;
  for await (const bytes of encodeRetainedPng(width, height, input(), { fs, directory: "/external" }, { chunkBytes })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(chunkBytes); size += bytes.length; }
  let encoded = 0; for (const bytes of compressed()) encoded += bytes.length;
  expect(size).toBe(encoded + 57); expect(peak).toBeLessThanOrEqual(chunkBytes); expect(live.size).toBe(0);
});

it("cancels between output chunks and removes sealed staging", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController();
  async function* input() { yield new Uint8Array([1, 2, 3, 255]); }
  const output = encodeRetainedPng(1, 1, input(), { fs, directory: "/scratch" }, { chunkBytes: 1, signal: controller.signal });
  expect((await output.next()).value).toEqual(new Uint8Array([137]));
  const reason = new Error("cancel PNG output"); controller.abort(reason);
  await expect(output.next()).rejects.toBe(reason); expect(await fs.readdir("/scratch")).toEqual([]);
});
