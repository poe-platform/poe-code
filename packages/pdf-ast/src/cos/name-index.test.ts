import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem } from "@poe-code/safe-fs/contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfNameIndex } from "./name-index.js";

describe("caller-backed exact string membership", () => {
  it("preserves empty keys, prefixes, Unicode, and isolated code units across spills", async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    const set = new PdfNameIndex({ fs, directory: "/scratch" });
    const keys = ["", "a", "aa", "é", "e\u0301", "\ud800", "\ud801", "\ufffd", "😀", ...Array.from({ length: 70 }, (_, i) => `file-${i}`)];
    for (const key of keys) expect((await set.intern(key)).added).toBe(true);
    for (const key of [...keys].reverse()) expect((await set.intern(key)).added).toBe(false);
    expect(await fs.readdir("/scratch")).not.toEqual([]);
    await set.close(); expect(await fs.readdir("/scratch")).toEqual([]);
    await expect(set.intern("later")).rejects.toThrow("closed");
  });

  it("cleans retained runs after admission failure or cancellation", async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    const set = new PdfNameIndex({ fs, directory: "/scratch" }, 4096);
    await expect(async () => { for (let i = 0; i < 100; i++) await set.intern(`name${i}`); }).rejects.toThrow("limit");
    await set.close(); expect(await fs.readdir("/scratch")).toEqual([]);
    const controller = new AbortController(); const cancelled = new PdfNameIndex({ fs, directory: "/scratch" }, Infinity, controller.signal);
    await cancelled.intern("a".repeat(40)); controller.abort(new Error("cancel names"));
    await expect(cancelled.intern("b")).rejects.toThrow("cancel names"); await cancelled.close(); expect(await fs.readdir("/scratch")).toEqual([]);
  });
});

// Only scalar run descriptors persist. Every stored byte is checked on write
// and regenerated on read, so this oracle cannot hide a payload in a RAM spool.
function externalStorage() {
  const scope = {};
  const fields = (record: number) => {
    const step = Math.floor(record / 3);
    return record % 3 === 0 ? [(step * 2 + 1) * 257 + 66, step * 2 + 2] : record % 3 === 1 ? [(step * 2 + 2) * 257 + 1, step * 2 + 3] : [(step * 2 + 3) * 257, step];
  };
  const ordinal = (key: number) => {
    const node = Math.floor(key / 257), suffix = key % 257;
    return suffix === 66 ? (node - 1) / 2 * 3 : suffix === 1 ? (node - 2) / 2 * 3 + 1 : (node - 3) / 2 * 3 + 2;
  };
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
            const number = view.getFloat64(0); if (run.first < 0) run.first = ordinal(number);
            const expected = fields(run.first + run.count); expect(number).toBe(expected[0]); expect(view.getFloat64(8)).toBe(expected[1]);
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
        for (let at = 0; at < bytes.length; at++) { const absolute = position + at; const expected = fields(run.first + Math.floor(absolute / 32)); view.setFloat64(0, expected[0]!); view.setFloat64(8, expected[1]!); bytes[at] = row[absolute % 32]!; }
        return bytes;
      } };
    },
    readFile() { throw new Error("whole read forbidden"); }, writeFile() { throw new Error("whole write forbidden"); },
  } as unknown as FileSystem;
  return { fs, directory: "/authorized", live, get peakFiles() { return peakFiles; }, get peakWrite() { return peakWrite; } };
}


describe("name membership on generated external storage", () => {
  it.each([33, 171])("deduplicates %i prefixes without retaining stored bytes", async count => {
    const storage = externalStorage(); const names = new PdfNameIndex(storage);
    for (let i = 1; i <= count; i++) expect(await names.intern("A".repeat(i))).toEqual({ index: i - 1, added: true });
    for (let i = count; i > 0; i--) expect(await names.intern("A".repeat(i))).toEqual({ index: i - 1, added: false });
    expect(storage.peakFiles).toBeLessThanOrEqual(12); expect(storage.peakWrite).toBeLessThanOrEqual(2048);
    await names.close(); expect(storage.live.size).toBe(0);
  });
});

it("interns streamed UTF-16 units without retaining an entire token", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const names = new PdfNameIndex({ fs, directory: "/scratch" });
  try {
    const expected = await names.intern("name\ud800");
    expect(await names.intern((async function* () { for (const unit of [110, 97, 109, 101, 0xd800]) yield unit; })())).toEqual({ index: expected.index, added: false });
    const long = await names.intern((async function* () { for (let i = 0; i < 256; i++) yield 65; })());
    expect(await names.intern("A".repeat(256))).toEqual({ index: long.index, added: false });
  } finally { await names.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const mode of ["invalid", "cancel", "source-error"]) it(`closes a streamed name iterator after ${mode}`, async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("streamed name failure");
  const names = new PdfNameIndex({ fs, directory: "/scratch" }, Infinity, controller.signal);
  let closed = false;
  async function* units() {
    try {
      for (let i = 0; i < 40; i++) yield 65;
      if (mode === "cancel") controller.abort(reason);
      if (mode === "source-error") throw reason;
      yield mode === "invalid" ? 65536 : 66;
    } finally { closed = true; }
  }
  try { await expect(names.intern(units())).rejects.toThrow(mode === "invalid" ? "Invalid PDF name code unit" : reason.message); }
  finally { await names.close(); }
  expect(closed).toBe(true); expect(await fs.readdir("/scratch")).toEqual([]);
});
