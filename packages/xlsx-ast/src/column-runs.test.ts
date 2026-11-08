import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { Workbook } from "@poe-code/spreadsheet-ast";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
async function worksheet(bytes: Uint8Array): Promise<string> {
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/worksheets/sheet1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  return xml;
}
for (const edition of ["2006", "2008"] as const) {
  it(`keeps a default full-sheet column range compact over repeated ${edition} conversions`, async () => {
    let book: Workbook = { sheets: [{ id: "s", name: "Data", size: { rows: 1048576, columns: 16384 }, cells: [{ row: 0, column: 0, value: { kind: "number", value: 42 } }] }] };
    for (let repeat = 0; repeat < 3; repeat++) {
      const bytes = await createXlsxWriter(edition)(book, [], context);
      const xml = await worksheet(bytes);
      expect(xml.split("<col ").length - 1).toBe(1);
      expect(xml.length).toBeLessThan(10000);
      book = await readXlsx(bytes, context);
      expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
    }
  });
  it(`coalesces adjacent equal ${edition} columns without crossing formatting boundaries`, async () => {
    const book: Workbook = { sheets: [{ id: "s", name: "Data", size: { rows: 1048576, columns: 16384 }, cells: [], columns: [
      { index: 1, sizePoints: 30 }, { index: 2, sizePoints: 30 },
      { index: 3, sizePoints: 30, hidden: true }, { index: 4, sizePoints: 30, hidden: true },
      { index: 5, sizePoints: 30, hidden: true, outlineLevel: 1 },
      { index: 6, sizePoints: 30, hidden: true, outlineLevel: 1, collapsed: true },
      { index: 8, sizePoints: 40 }, { index: 9, sizePoints: 40 },
      { index: 10, style: { gnumeric: { name: "Style", attributes: { Format: "0.00" }, children: [] } } },
      { index: 11, style: { gnumeric: { name: "Style", attributes: { Format: "0.00" }, children: [] } } },
      { index: 12, style: { gnumeric: { name: "Style", attributes: { Format: "0%" }, children: [] } } }
    ] }] };
    const bytes = await createXlsxWriter(edition)(book, [], context), xml = await worksheet(bytes);
    expect(xml).toContain('<col min="2" max="3"');
    expect(xml).toContain('<col min="4" max="5"');
    expect(xml).toContain('<col min="6" max="6"');
    expect(xml).toContain('<col min="7" max="7"');
    expect(xml).toContain('<col min="9" max="10"');
    expect(xml).toContain('<col min="11" max="12"');
    expect(xml).toContain('<col min="13" max="13"');
    expect(xml).toContain('<col min="14" max="16384"');
    const first = await readXlsx(bytes, context);
    const second = await readXlsx(await createXlsxWriter(edition)(first, [], context), context);
    expect(second.sheets[0]!.columns).toEqual(first.sheets[0]!.columns);
  });
}
