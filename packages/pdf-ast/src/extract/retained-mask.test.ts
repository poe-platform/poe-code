import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { applyRetainedImageMask } from "./retained-mask.js";
async function mask(values: number[]) {
  const fs = createMemoryFileSystem(); await fs.writeFile("/mask", new Uint8Array(values));
  return PdfFileSource.open(fs, "/mask", { chunkBytes: 4, cacheBytes: 4 });
}
async function collect(input: AsyncIterable<Uint8Array>) { const result = []; for await (const row of input) result.push([...row]); return result; }
async function* rows(count: number, bytes: number[]) { const row = new Uint8Array(bytes); for (let y = 0; y < count; y++) yield row; }

it("resamples soft masks by row, unmattes colors and owns output", async () => {
  const source = await mask([128, 0, 0, 7, 255, 0, 0, 7]); const read = vi.spyOn(source, "read");
  const base = [100, 120, 140, 19, 100, 120, 140, 19];
  const output = await collect(applyRetainedImageMask(rows(4, base), 2, 4, { source, width: 1, height: 2 }, { mode: "soft", matte: [50, 50, 50] }));
  const partial = [150, 189, 229, 128, 150, 189, 229, 128]; const full = [100, 120, 140, 255, 100, 120, 140, 255];
  expect(output).toEqual([partial, partial, full, full]); expect(read).toHaveBeenCalledTimes(2); await source.close();
});
it("thresholds explicit masks without overwriting remaining alpha", async () => {
  const source = await mask([127, 0, 0, 255, 128, 0, 0, 255]);
  expect(await collect(applyRetainedImageMask(rows(1, [10, 20, 30, 99, 40, 50, 60, 88]), 2, 1, { source, width: 2, height: 1 }, { mode: "explicit" })))
    .toEqual([[10, 20, 30, 99, 40, 50, 60, 0]]); await source.close();
});
it("admits row memory and output before pulling inputs", async () => {
  const source = await mask([255, 0, 0, 255]); const read = vi.spyOn(source, "read"); let pulls = 0;
  async function* input() { pulls++; yield new Uint8Array(4); }
  const options = { mode: "soft" as const };
  await expect(applyRetainedImageMask(input(), 1, 1, { source, width: 1, height: 1 }, { ...options, maxWorkingBytes: 15 }).next()).rejects.toThrow("limit");
  await expect(applyRetainedImageMask(input(), 1, 1, { source, width: 1, height: 1 }, { ...options, maxOutputBytes: 3 }).next()).rejects.toThrow("limit");
  expect(read).not.toHaveBeenCalled(); expect(pulls).toBe(0); await source.close();
});
it("closes row producers on cancellation and mask read failure while keeping mask caller-owned", async () => {
  const source = await mask([255, 0, 0, 255]); let returned = 0;
  async function* input() { try { yield new Uint8Array(4); yield new Uint8Array(4); } finally { returned++; } }
  const abort = new AbortController();
  const output = applyRetainedImageMask(input(), 1, 2, { source, width: 1, height: 1 }, { mode: "soft", signal: abort.signal });
  await output.next(); abort.abort(new Error("cancel mask")); await expect(output.next()).rejects.toThrow("cancel mask"); expect(returned).toBe(1);
  vi.spyOn(source, "read").mockRejectedValueOnce(new Error("backend read"));
  await expect(applyRetainedImageMask(input(), 1, 2, { source, width: 1, height: 1 }, { mode: "soft" }).next()).rejects.toThrow("backend read");
  expect(returned).toBe(2); expect(await source.read(0, 4)).toEqual(new Uint8Array([255, 0, 0, 255])); await source.close();
});

it.each([[], [1, 2, 3], [1, 2, 3, 4, 5]].map(values => ({ values })))("rejects malformed rows $values and closes their producer", async ({ values }) => {
  const source = await mask([255, 0, 0, 255]); let returned = false;
  async function* input() { try { yield new Uint8Array(values); } finally { returned = true; } }
  await expect(collect(applyRetainedImageMask(input(), 1, 1, { source, width: 1, height: 1 }, { mode: "soft" }))).rejects.toThrow("row");
  expect(returned).toBe(true); await source.close();
});
it("rejects truncated masks and too few or too many rows", async () => {
  const short = await mask([255, 0]);
  await expect(applyRetainedImageMask(rows(1, [0, 0, 0, 255]), 1, 1, { source: short, width: 1, height: 1 }, { mode: "soft" }).next()).rejects.toThrow("Truncated"); await short.close();
  const source = await mask([255, 0, 0, 255]);
  for (const count of [0, 2]) await expect(collect(applyRetainedImageMask(rows(count, [0, 0, 0, 255]), 1, 1, { source, width: 1, height: 1 }, { mode: "soft" }))).rejects.toThrow("row");
  await source.close();
});
it.each([1024, 8192])("applies %i generated mask rows with fixed memory and no read-ahead", async height => {
  let reads = 0; let closed = false; const scratch = new Uint8Array(8);
  const fs = {
    capabilities: { retainedRead: true },
    async openReadFile() { return {
      stat: async () => ({ type: "file", size: height / 2 * 8 }), close: async () => { closed = true; },
      async read(at: number, count: number) {
        reads++; expect(count).toBeLessThanOrEqual(8);
        for (let i = 0; i < count; i++) scratch[i] = Math.floor((at + i) / 4) % 251;
        return scratch.subarray(0, count);
      },
    }; },
    readFile() { throw new Error("whole read forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  const source = await PdfFileSource.open(fs, "/generated", { chunkBytes: 8, cacheBytes: 8 });
  async function* input() { const row = new Uint8Array(12).fill(255); for (let y = 0; y < height; y++) { row[0] = y % 256; yield row; } }
  let count = 0; let first: Uint8Array | undefined;
  for await (const row of applyRetainedImageMask(input(), 3, height, { source, width: 2, height: height / 2 }, { mode: "soft", maxWorkingBytes: 40 })) {
    first ??= row; expect(row.buffer.byteLength).toBe(12); expect(row[0]).toBe(count % 256);
    expect([row[3], row[7], row[11]]).toEqual([Math.floor(count / 2) * 2 % 251, Math.floor(count / 2) * 2 % 251, (Math.floor(count / 2) * 2 + 1) % 251]);
    expect(reads).toBe(Math.floor(count / 2) + 1); const before = reads; await Promise.resolve(); expect(reads).toBe(before); count++;
  }
  expect(count).toBe(height); expect(first![0]).toBe(0); expect(closed).toBe(false); await source.close(); expect(closed).toBe(true);
});
