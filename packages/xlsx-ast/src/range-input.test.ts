import { expect, it } from "vitest";
import { createEngine, defaultSsconvertLimits, SsconvertError, type CapabilityContext, type Codec, type RangeSource } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createZipCodec } from "@poe-code/office-package";
import { probeXlsx, readXlsx, createXlsxWriter } from "./index.js";

const signal = new AbortController().signal;
const context: CapabilityContext = { signal, limits: defaultSsconvertLimits,
  environment: { locale: "C", timezone: "UTC", cwd: "/", env: {} }, own() {} };
const limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
  maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity,
  maxTextBytes: Infinity, chunkSize: 16384 };
const zip = createZipCodec();

it("probes retained ZIP ranges without reading a large unused member", async () => {
  const attributes = { modified: new Date("2000-01-01T00:00:00Z"), mode: 0o100644,
    directory: false, symlink: false, compression: "store" as const };
  const entries = await Promise.all([
    zip.makeZipEntry("unused", new Uint8Array(256 * 1024), attributes, limits, signal),
    zip.makeZipEntry("xl/workbook.xml", new TextEncoder().encode("<workbook/>"), attributes, limits, signal)
  ]);
  const archive = await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal);
  let readBytes = 0;
  const reused = new Uint8Array(257);
  const source: RangeSource = { size: archive.length, async read(position, maximum, options) {
    expect(options?.signal).toBe(signal);
    expect(maximum).toBeLessThanOrEqual(16384);
    expect(position < 4096 || position > 180 * 1024).toBe(true);
    const count = Math.min(maximum, reused.length, archive.length - position);
    reused.set(archive.subarray(position, position + count)); readBytes += count;
    return reused.subarray(0, count);
  } };
  expect(await probeXlsx(source, { ...context, limits: { ...context.limits, zipRatio: 1 } })).toBe(true);
  expect(readBytes).toBeLessThan(80 * 1024);
});

it("reads the same workbook through borrowed short ranges and buffered input", async () => {
  const fixture: Codec = { id: "fixture", description: "fixture", extensions: [], async read() {
    return { sheets: [{ id: "s", name: "Data", cells: [
      { row: 0, column: 0, value: { kind: "string", value: "Label" } },
      { row: 1, column: 0, value: { kind: "number", value: 42 } }
    ] }] };
  } };
  const engine = createEngine({ workingFiles: { fs: createMemoryFileSystem(), directory: "/", cacheBytes: 16384 }, codecs: [fixture, { id: "xlsx", description: "XLSX", extensions: [], read: readXlsx, readSource: readXlsx, write: createXlsxWriter("2008") }] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", source: [] }, { importType: "fixture" }, { signal });
    let bytes = new Uint8Array();
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(chunk) { bytes = new Uint8Array(chunk); } } }, { exportType: "xlsx" }, { signal });
    const reused = new Uint8Array(31);
    const source: RangeSource = { size: bytes.length, async read(position, maximum) {
      const count = Math.min(maximum, reused.length, bytes.length - position);
      reused.set(bytes.subarray(position, position + count)); return reused.subarray(0, count);
    } };
    expect(await readXlsx(source, context)).toEqual(await readXlsx(bytes, context));
    expect(await engine.readWorkbook({ kind: "range", source }, { importType: "xlsx" }, { signal })).toEqual(
      await engine.readWorkbook({ kind: "stream", source: [bytes] }, { importType: "xlsx" }, { signal }));
  } finally { await engine.dispose(); }
});

it.each([new Error("range backend failed"), new SsconvertError("io", "range backend failed"), null])("preserves retained range failure identity and cancellation (%s)", async failure => {
  await expect(probeXlsx({ size: 100, async read() { throw failure; } }, context)).rejects.toBe(failure);
  const controller = new AbortController();
  const cancelled = { ...context, signal: controller.signal };
  await expect(readXlsx({ size: 100, async read() {
    controller.abort(failure); return new Uint8Array(100);
  } }, cancelled)).rejects.toBe(failure);
});

it("enforces compression ratios on retained members before decoding", async () => {
  const entry = await zip.makeZipEntry("xl/workbook.xml", new Uint8Array(65536), {
    modified: new Date("2000-01-01T00:00:00Z"), mode: 0o100644,
    directory: false, symlink: false, compression: "deflate"
  }, limits, signal);
  const bytes = await zip.writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal);
  const source: RangeSource = { size: bytes.length, async read(position, maximum) { return bytes.subarray(position, position + maximum); } };
  await expect(probeXlsx(source, { ...context, limits: { ...context.limits, zipRatio: 2 } })).rejects.toMatchObject({ code: "resource-limit" });
});
