import { expect, it } from "vitest";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";
import xmlFormat from "./providers/xml.js";
import { createXlsxStreamWriter } from "./xlsx.js";
import { createOdfStreamWriter } from "./odf.js";
import { writeGnumericStream, writeCompressedGnumericStream } from "./gnumeric.js";

const book: Workbook = { sheets: [{ id: "s", name: "Data", size: { rows: 128, columns: 128 },
  rows: [{ index: 4, hidden: true, sizePoints: 17 }, { index: 0, sizePoints: 23 }],
  columns: [{ index: 2, sizePoints: 42, outlineLevel: 1 }],
  cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 } }] }] };
const source = { metadata: { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: [], rows: [], columns: [] })) },
  async *cells(id: string) { yield* book.sheets.find(sheet => sheet.id === id)!.cells; },
  async *axes(id: string, kind: "rows" | "columns") { yield* book.sheets.find(sheet => sheet.id === id)![kind]!; } };

it.each(["xlsx2006", "xlsx2008", "ods-strict", "ods-extended", "gnumeric", "gnumeric-gzip"])("preserves streamed axis metadata for direct %s export", async kind => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  const writer = kind === "gnumeric-gzip" ? writeCompressedGnumericStream : kind === "gnumeric" ? writeGnumericStream : kind.startsWith("xlsx") ? createXlsxStreamWriter(kind === "xlsx2006" ? "2006" : "2008") : createOdfStreamWriter(kind === "ods-strict" ? "strict" : "extended");
  async function bytes(input: typeof source | Workbook) {
    const chunks: Uint8Array[] = [];
    const stream = "metadata" in input ? writer(input, [], context) : writer(input, [], context);
    for await (const chunk of stream) chunks.push(chunk.slice());
    return Buffer.concat(chunks);
  }
  expect(await bytes(source)).toEqual(await bytes(book));
});


it.each([writeGnumericStream, writeCompressedGnumericStream])("exports Gnumeric axes without collecting axis records", async writer => {
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  const push = Array.prototype.push;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item !== null && typeof item === "object" && "index" in item && "sizePoints" in item))
      throw new Error("resident axis collection");
    return push.apply(this, items);
  };
  try {
    let bytes = 0;
    for await (const chunk of writer(source, [], context)) bytes += chunk.length;
    expect(bytes).toBeGreaterThan(0);
  } finally { Array.prototype.push = push; }
});


it.each(["Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2"])("streams axes through the registered %s exporter with caller storage", async id => {
  const fs = createMemoryFileSystem();
  const engine = createEngine({ workingFiles: { fs, directory: "/", cacheBytes: 16384 }, formats: [xmlFormat, xlsxFormat], codecs: [{
    id: "fixture", description: "fixture", extensions: [], async readSource() { throw new Error("buffered reader"); },
    async readWorkbookSource() { return source; }
  }] });
  const push = Array.prototype.push;
  let bytes = 0, pending = 0;
  Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
    if (items.some(item => item !== null && typeof item === "object" && "index" in item && "sizePoints" in item))
      throw new Error("resident axis collection");
    return push.apply(this, items);
  };
  try {
    await engine.convert({ input: { kind: "range", source: { size: 0, async read() { return new Uint8Array(); } } },
      importType: "fixture", exportType: id,
      destination: { kind: "stream", sink: { async write(chunk) {
        expect(++pending).toBe(1); await Promise.resolve(); bytes += chunk.length; pending--;
      } } } }, { signal: new AbortController().signal });
    expect(bytes).toBeGreaterThan(0);
  } finally { Array.prototype.push = push; await engine.dispose(); }
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([writeGnumericStream, writeCompressedGnumericStream])("preserves replay failure and cancellation while closing axes", async writer => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(), failure = new Error("axis replay failed");
    let columnPass = 0, closed = 0;
    const failing = { ...source, async *axes(id: string, kind: "rows" | "columns") {
      if (kind !== "columns" || ++columnPass === 1) { yield* source.axes(id, kind); return; }
      try {
        yield { index: 0, hidden: true };
        if (cancel) { controller.abort(failure); yield { index: 1, hidden: true }; }
        else throw failure;
      } finally { closed++; }
    } };
    const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: controller.signal,
      environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
    await expect((async () => { for await (const chunk of writer(failing, [], context)) void chunk; })()).rejects.toBe(failure);
    expect(closed).toBe(1);
  }
});

it("applies output backpressure to axes and closes an unfinished replay", async () => {
  let pass = 0, emitted = 0, closed = 0;
  const large = { metadata: { sheets: [{ id: "s", name: "Data", cells: [], rows: [], columns: [] }] },
    async *cells() {}, async *axes(_id: string, kind: "rows" | "columns") {
      if (kind !== "rows") return;
      const replay = ++pass > 1;
      try { for (let index = 0; index < 10000; index++) { if (replay) emitted++; yield { index, sizePoints: 17 }; } }
      finally { if (replay) closed++; }
    } };
  const context: CapabilityContext = { limits: defaultSsconvertLimits, signal: new AbortController().signal,
    environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} };
  const output = writeGnumericStream(large, [], context);
  expect((await output.next()).done).toBe(false);
  expect(emitted).toBeGreaterThan(0); expect(emitted).toBeLessThan(10000);
  const paused = emitted; await Promise.resolve(); expect(emitted).toBe(paused);
  await output.return(undefined); expect(closed).toBe(1);
});
