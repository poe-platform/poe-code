import { expect, it } from "vitest";
import { encodeTiff } from "./raster.js";
import { decodeLzw } from "../cos/filters.js";
import { decodeJpegToRgba } from "../extract/images.js";
const data = Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) => i * 67 % 256);
function strip(bytes: Uint8Array) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const count = view.getUint16(8, true); let offset = 0, size = 0; for (let i = 0; i < count; i++) { const at = 10 + i * 12; const tag = view.getUint16(at, true); if (tag === 273) offset = view.getUint32(at + 8, true); if (tag === 279) size = view.getUint32(at + 8, true); } return bytes.subarray(offset, offset + size); }
it("writes actual LZW data for the TIFF LZW compression tag", () => {
  const encoded = encodeTiff({ width: 17, height: 13, data }, 72, "lzw");
  expect(decodeLzw(strip(encoded))).toEqual(data.filter((_, i) => i % 4 !== 3));
});
it("writes an interoperable JPEG stream for the TIFF JPEG compression tag", () => {
  const encoded = encodeTiff({ width: 17, height: 13, data }, 72, "jpeg");
  const decoded = decodeJpegToRgba(strip(encoded)); expect(decoded.width).toBe(17); expect(decoded.height).toBe(13);
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { encodeRetainedTiff } from "./retained-tiff.js";
import { vi } from "vitest";
it.each(["none", "packbits", "deflate", "lzw", "jpeg"] as const)("streams %s TIFF with byte parity and bounded owned chunks", async compression => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const actual: number[] = [];
  async function* input() { const chunk = new Uint8Array(7); for (let at = 0; at < data.length; at += 7) { chunk.set(data.subarray(at, at + 7)); yield chunk.subarray(0, Math.min(7, data.length - at)); } }
  for await (const bytes of encodeRetainedTiff(17, 13, input(), { fs, directory: "/scratch" }, { compression, dpi: 150, chunkBytes: 31 })) { expect(bytes.buffer.byteLength).toBeLessThanOrEqual(31); actual.push(...bytes); }
  expect(new Uint8Array(actual)).toEqual(encodeTiff({ width: 17, height: 13, data }, 150, compression)); expect(await fs.readdir("/scratch")).toEqual([]);
});
it("admits working/output bounds before reading pixels and cleans staging on failure", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const storage = { fs, directory: "/scratch" }; const read = vi.fn();
  async function* input() { read(); yield data; }
  for (const options of [{ maxOutputBytes: 179 }, { maxWorkingBytes: 1 }]) {
    await expect(async () => { for await (const ignored of encodeRetainedTiff(17, 13, input(), storage, options)) { /* Drain. */ } }).rejects.toThrow("limit");
  }
  expect(read).not.toHaveBeenCalled();
  await expect(async () => { for await (const ignored of encodeRetainedTiff(17, 13, input(), storage, { maxStagingBytes: 1 })) { /* Drain. */ } }).rejects.toThrow("limit");
  async function* failure() { yield new Uint8Array(4); throw new Error("pixel failure"); }
  await expect(async () => { for await (const ignored of encodeRetainedTiff(17, 13, failure(), storage)) { /* Drain. */ } }).rejects.toThrow("pixel failure");
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it("cleans sealed TIFF staging when cancelled during output", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController();
  async function* input() { yield data; }
  const output = encodeRetainedTiff(17, 13, input(), { fs, directory: "/scratch" }, { signal: controller.signal, chunkBytes: 1 });
  expect((await output.next()).value).toEqual(new Uint8Array([73])); controller.abort(new Error("cancel tiff"));
  await expect(output.next()).rejects.toThrow("cancel tiff"); expect(await fs.readdir("/scratch")).toEqual([]);
});
it.each([32, 4096])("encodes %i generated rows using external storage without retaining payloads", async height => {
  const width = 256, chunkBytes = 1024, scope = {}; let size = 0, revision = 0, live = false, pending = 0, peak = 0;
  const stat = () => ({ type: "file" as const, size, revision, identityScope: scope, opaqueIdentity: "strip", mode: 0o600, mtimeMs: revision, ctimeMs: revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      live = true;
      return { file: { path, stat: stat() }, cleanup: { remove: async () => { live = false; }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) { pending += bytes.length; peak = Math.max(peak, pending); expect(bytes.buffer.byteLength).toBeLessThanOrEqual(chunkBytes); expect(bytes.every(n => n === 0)).toBe(true); await Promise.resolve(); size += bytes.length; revision++; pending -= bytes.length; }, finish: async () => stat(),
      } };
    },
    async openReadFile() { return { stat: async () => stat(), close: async () => {}, async read(at: number, length: number) { expect(length).toBeLessThanOrEqual(chunkBytes); return new Uint8Array(Math.min(length, size - at)); } }; },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as import("@poe-code/safe-fs/contracts").FileSystem;
  async function* input() { const row = new Uint8Array(width * 4); for (let y = 0; y < height; y++) { expect(pending).toBe(0); yield row; } }
  let bytes = 0;
  for await (const chunk of encodeRetainedTiff(width, height, input(), { fs, directory: "/external" }, { chunkBytes, maxWorkingBytes: 8192 })) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(chunkBytes); bytes += chunk.length; }
  expect(bytes).toBe(width * height * 3 + 180); expect(peak).toBeLessThanOrEqual(chunkBytes); expect(live).toBe(false);
});
it("matches LZW resets and code-width transitions on varied samples", async () => {
  let seed = 17; const data = Uint8Array.from({ length: 128 * 128 * 4 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed >>> 24; });
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* input() { for (let at = 0; at < data.length; at += 113) yield data.subarray(at, at + 113); }
  const bytes: number[] = []; for await (const chunk of encodeRetainedTiff(128, 128, input(), { fs, directory: "/scratch" }, { compression: "lzw", chunkBytes: 47 })) bytes.push(...chunk);
  const result = new Uint8Array(bytes); expect(result).toEqual(encodeTiff({ width: 128, height: 128, data }, 72, "lzw")); expect(decodeLzw(strip(result))).toEqual(data.filter((_, i) => i % 4 !== 3));
});
