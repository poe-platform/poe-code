import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfReferenceSet } from "./reference-set.js";

// Only scalar run descriptors persist. Every stored byte is checked on write
// and regenerated on read, so this oracle cannot hide a payload in a RAM spool.
function externalStorage() {
  const scope = {};
  type Run = { first: number; count: number; revision: number; identity: string };
  const live = new Map<string, Run>();
  let peakFiles = 0;
  let outstanding = 0;
  let peakWrite = 0;
  const stat = (run: Run): FileStat => ({ type: "file", size: run.count * 32, identityScope: scope, opaqueIdentity: run.identity,
    revision: run.revision, mode: 0o600, mtimeMs: run.revision, ctimeMs: run.revision, atimeMs: 0 });
  const fs = {
    capabilities: { retainedRead: true, retainedStagingWrite: true, retainedStagingCleanup: true },
    stat: async () => ({ type: "directory", size: 0 }),
    async createStagedFile(path: string) {
      const run = { first: -1, count: 0, revision: 0, identity: path };
      live.set(path, run); peakFiles = Math.max(peakFiles, live.size);
      return { file: { path, stat: stat(run) }, cleanup: { remove: async () => { live.delete(path); }, close: async () => {} }, writer: {
        async write(bytes: Uint8Array) {
          outstanding += bytes.length; peakWrite = Math.max(peakWrite, outstanding);
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(2048); expect(bytes.length % 32).toBe(0);
          await Promise.resolve();
          for (let at = 0; at < bytes.length; at += 32) {
            const view = new DataView(bytes.buffer, bytes.byteOffset + at, 32);
            const number = view.getFloat64(0); if (run.first < 0) run.first = number;
            expect(number).toBe(run.first + run.count); expect(view.getFloat64(8)).toBe(0);
            expect(view.getFloat64(16)).toBe(0); expect(view.getFloat64(24)).toBe(1); run.count++;
          }
          run.revision++; outstanding -= bytes.length;
        }, finish: async () => stat(run),
      } };
    },
    async openReadFile(path: string) {
      const run = live.get(path)!;
      return { stat: async () => stat(run), close: async () => {}, async read(position: number, length: number) {
        expect(length).toBeLessThanOrEqual(2048);
        const bytes = new Uint8Array(Math.min(length, run.count * 32 - position));
        const row = new Uint8Array(32); const view = new DataView(row.buffer); view.setFloat64(24, 1);
        for (let at = 0; at < bytes.length; at++) { const absolute = position + at; view.setFloat64(0, run.first + Math.floor(absolute / 32)); bytes[at] = row[absolute % 32]!; }
        return bytes;
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as FileSystem;
  return { fs, directory: "/authorized", live, get peakFiles() { return peakFiles; }, get peakWrite() { return peakWrite; } };
}

describe("externally backed traversal references", () => {
  it.each([65, 513])("tracks %i visited references with bounded outstanding bytes", async count => {
    const storage = externalStorage(); const visited = new PdfReferenceSet(storage);
    for (let number = 0; number < count; number++) expect(await visited.add(number)).toBe(true);
    for (let number = count - 1; number >= 0; number--) expect(await visited.add(number)).toBe(false);
    expect(storage.live.size).toBeLessThanOrEqual(4); expect(storage.peakFiles).toBeLessThanOrEqual(12);
    expect(storage.peakWrite).toBeLessThanOrEqual(2048);
    await visited.close(); expect(storage.live.size).toBe(0); await visited.close();
  });

  it("includes retained runs in staging admission and cleans failed compaction", async () => {
    const storage = externalStorage(); const visited = new PdfReferenceSet(storage, 4096);
    for (let number = 0; number < 127; number++) await visited.add(number);
    await expect(visited.add(127)).rejects.toThrow("limit");
    expect(storage.live.size).toBe(1);
    await visited.close(); expect(storage.live.size).toBe(0);
  });

  it("honors cancellation and rejects use after close", async () => {
    const storage = externalStorage(); const abort = new AbortController(); const visited = new PdfReferenceSet(storage, Infinity, abort.signal);
    for (let number = 0; number < 64; number++) await visited.add(number);
    const failure = new Error("cancel traversal"); abort.abort(failure);
    await expect(visited.add(65)).rejects.toBe(failure); await visited.close(); expect(storage.live.size).toBe(0);
    await expect(visited.add(66)).rejects.toThrow("closed");
  });
});
