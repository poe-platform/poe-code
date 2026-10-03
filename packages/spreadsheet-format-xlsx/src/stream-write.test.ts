import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine, defaultSsconvertLimits } from "@poe-code/spreadsheet-engine";
import { createXlsxWriter } from "@poe-code/xlsx-ast";
import * as xmlSupport from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { xlsxFormat } from "./index.js";

it.each(["2006", "2008"] as const)("publishes XLSX %s using caller-backed ZIP records and bounded output", async edition => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let written = 0, largestWrite = 0, closed = 0, pendingBytes = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole file write"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async (bytes, ...args) => {
      pendingBytes += bytes.length; expect(pendingBytes).toBeLessThanOrEqual(16384);
      written += bytes.length; largestWrite = Math.max(largestWrite, bytes.length);
      try { await Promise.resolve(); return await write(bytes, ...args); }
      finally { pendingBytes -= bytes.length; }
    });
    vi.spyOn(handle, "close").mockImplementation(async (...args) => { closed++; await close(...args); });
    return handle;
  });
  const array = vi.fn(() => { throw new Error("buffered writer"); });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 },
    formats: [{ ...xlsxFormat, services: xlsxFormat.services.map(codec => codec.direction === "write" ? { ...codec, write: array } : codec) }] });
  const signal = new AbortController().signal;
  const raw = { sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 800 }, (_, row) => ({ row, column: 0,
    value: { kind: "string" as const, value: `shared é🦀${row % 400}` } })) }] };
  // Shared values can exceed ZIP pathname limits; no workbook limit is lowered.
  raw.sheets[0]!.cells[0]!.value.value = raw.sheets[0]!.cells[400]!.value.value = "é🦀".repeat(22000);
  const expected = await createXlsxWriter(edition)(raw, [], { signal, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  try {
    const book = await engine.adoptWorkbook(raw, { signal }), chunks: Uint8Array[] = [];
    const keys = new Set(raw.sheets[0]!.cells.map(cell => JSON.stringify([cell.value.value, []])));
    const set = Map.prototype.set;
    const stringMaps = vi.spyOn(Map.prototype, "set").mockImplementation(function(this: Map<unknown, unknown>, key, value) {
      if (typeof key === "string" && keys.has(key)) throw new Error("resident shared-string index");
      return set.call(this, key, value);
    });
    const createXml = xmlSupport.createXlsxXml;
    const containers = vi.spyOn(xmlSupport, "createXlsxXml").mockImplementation(context => {
      const writer = createXml(context);
      return { ...writer, element(name, ...args) {
        if (["row", "sheetData", "worksheet", "sst"].includes(name)) throw new Error("buffered XML container: " + name);
        return writer.element(name, ...args);
      } };
    });
    const encode = TextEncoder.prototype.encode;
    const encoding = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function(this: TextEncoder, text) {
      expect(text?.length ?? 0).toBeLessThanOrEqual(16384);
      return encode.call(this, text);
    });
    try {
      await engine.writeWorkbook(book, { kind: "stream", sink: { async write(bytes) {
        expect(bytes.length).toBeLessThanOrEqual(16384); await Promise.resolve(); chunks.push(bytes.slice());
      } } }, { exportType: edition === "2006" ? "Gnumeric_Excel:xlsx" : "Gnumeric_Excel:xlsx2" }, { signal });
    } finally { encoding.mockRestore(); containers.mockRestore(); stringMaps.mockRestore(); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(expected)); expect(chunks.length).toBeGreaterThan(1);
    expect(array).not.toHaveBeenCalled(); expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(800 * 16384); expect(pendingBytes).toBe(0); expect(largestWrite).toBeLessThanOrEqual(16384);
    expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});

it.each(["write", "read", "sink", "cancel"])("releases XLSX staging and preserves the %s failure", async mode => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController(), reason = new Error(mode);
  let closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async (...args) => { closed++; await close(...args); });
    if (mode === "write") vi.spyOn(handle, "write").mockRejectedValue(reason);
    if (mode === "read") vi.spyOn(handle, "read").mockRejectedValue(reason);
    return handle;
  });
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [xlsxFormat] });
  const raw = { sheets: [{ id: "s", name: "Data", cells: Array.from({ length: 800 }, (_, row) => ({ row, column: 0,
    value: { kind: "string" as const, value: row % 3 === 0 ? "shared é🦀" : `row${row}:${Math.imul(row + 1, 2654435761) >>> 0}` } })) }] };
  try {
    const book = await engine.adoptWorkbook(raw, { signal: controller.signal });
    await expect(engine.writeWorkbook(book, { kind: "stream", sink: { async write() {
      if (mode === "sink") throw reason;
      if (mode === "cancel") controller.abort(reason);
    } } }, { exportType: "Gnumeric_Excel:xlsx" }, { signal: controller.signal })).rejects.toBe(reason);
    expect(closed).toBe(1); expect(await fs.readdir("/")).toEqual([]);
  } finally { await engine.dispose(); }
});
