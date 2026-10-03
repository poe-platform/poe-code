import { expect, it, vi } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createZipCodec } from "@poe-code/office-package";
import { probeXlsx } from "./xlsx.js";

it.each(["success", "write", "cancel", "invalid-late"])("externalizes XLSX directory indexes and retires them on %s", async mode => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController(), signal = controller.signal;
  const failure = new Error("directory spill failed");
  let bytesWritten = 0, maximum = 0, storesClosed = 0, handlesClosed = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, position, options) => {
      bytesWritten += bytes.length; maximum = Math.max(maximum, bytes.length);
      if (mode === "write" || mode === "cancel") { if (mode === "cancel") controller.abort(failure); throw failure; }
      return write(bytes, position, options);
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { handlesClosed++; await close(options); });
    return handle;
  });
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
    maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = [];
  for (let i = 0; i < 600; i++) entries.push(await zip.makeZipEntry(i ? mode === "invalid-late" && i === 599 ? "unused/%61.xml" : `unused/${i}.xml` : "xl/workbook.xml", new Uint8Array(), {
    modified: new Date("2000-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"
  }, limits, signal));
  const bytes = await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
  const reused = new Uint8Array(257);
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, codecs: [{
    id: "xlsx", description: "XLSX", extensions: [],
    async probeSource(source, context) {
      return probeXlsx(source, { ...context, createWorkingStorage() {
        const store = context.createWorkingStorage!();
        return { ...store, async close() { storesClosed++; await store.close(); } };
      } });
    },
    async readSource() { expect(mode).toBe("success"); expect(storesClosed).toBeGreaterThan(0); return { sheets: [] }; }
  }] });
  const result = engine.readWorkbook({ kind: "range", source: { size: bytes.length, async read(position, maximum) {
    const length = Math.min(maximum, reused.length, bytes.length - position);
    reused.set(bytes.subarray(position, position + length)); return reused.subarray(0, length);
  } } }, {}, { signal });
  if (mode === "success") await result;
  else if (mode === "invalid-late") await expect(result).rejects.toThrow();
  else await expect(result).rejects.toBe(failure);
  expect(storesClosed).toBeGreaterThan(0);
  expect(bytesWritten).toBeGreaterThanOrEqual(16384); expect(maximum).toBeLessThanOrEqual(16384);
  expect(handlesClosed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});
