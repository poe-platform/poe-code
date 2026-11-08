import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine, defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { formatA1 } from "@poe-code/spreadsheet-ast";
import { readXlsx } from "./xlsx.js";

const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, limits: defaultSsconvertLimits,
  environment: { env: {}, locale: "C", timezone: "UTC" } };
async function fixture(columns: string, rows: string) {
  const parts = [
    ["_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="sheet"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="${rel}/worksheet" Target="sheet.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<styleSheet xmlns="${ns}"><cellXfs><xf numFmtId="0"/><xf numFmtId="2"/><xf numFmtId="9"/></cellXfs></styleSheet>`],
    ["xl/sheet.xml", `<worksheet xmlns="${ns}"><cols>${columns}</cols><sheetData>${rows}</sheetData></worksheet>`]
  ];
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
    maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = [];
  for (const [name, text] of parts) entries.push(await zip.makeZipEntry(name!, new TextEncoder().encode(text),
    { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

it.each([false, true])("admits repeated column styles without multiplying work by cell count (storage: %s)", async stored => {
  const input = await fixture(Array.from({ length: 1000 }, (_, index) => `<col min="1" max="1" style="${index % 2 + 1}"/>`).join(""),
    Array.from({ length: 1000 }, (_, row) => `<row r="${row + 1}"><c r="A${row + 1}"><v>${row}</v></c></row>`).join(""));
  const limits = { ...defaultSsconvertLimits, workbookWork: 600000 };
  const fs = createMemoryFileSystem();
  const engine = createEngine({ limits, ...(stored ? { workingFiles: { fs, directory: "/", cacheBytes: 16384 } } : {}),
    codecs: [{ id: "fixture", description: "", extensions: [], readSource: readXlsx }] });
  try {
    const book = await engine.readWorkbook({ kind: "range", source: { size: input.length,
      async read(at, count) { return input.subarray(at, at + Math.min(count, 257)); } } }, { importType: "fixture" }, { signal: context.signal });
    expect(book.sheets[0]!.cells).toHaveLength(1000);
    expect(book.sheets[0]!.cells.every(cell => cell.format === "0%")).toBe(true);
  } finally { await engine.dispose(); }
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves last styled span, undefined style clearing, boundaries, and row/cell overrides", async () => {
  const input = await fixture('<col min="1" max="16384" style="1"/><col min="2" max="3" style="2"/>' +
    '<col min="3" max="4" style="999999999999"/><col min="2" max="2"/><col min="16384" max="16384" style="2"/>',
    '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c><c r="D1"><v>4</v></c><c r="XFD1"><v>5</v></c></row>' +
    '<row r="2" customFormat="1" s="1"><c r="B2"><v>6</v></c><c r="C2" s="2"><v>7</v></c></row>' +
    '<row r="3" s="1"><c r="B3"><v>8</v></c></row>');
  const book = await readXlsx(input, context);
  expect(book.sheets[0]!.cells.map(cell => cell.format)).toEqual(["0.00", "0%", "General", "General", "0%", "0.00", "0%", "0%"]);
});


it("matches ordered range overrides across nested, disjoint and uncovered columns", async () => {
  const spans = Array.from({ length: 120 }, (_, index) => {
    const min = index * 17 % 31 + 1;
    return { min, max: Math.min(32, min + index % 7), style: index % 5 === 0 ? undefined : index % 4 };
  });
  const input = await fixture(spans.map(span => `<col min="${span.min}" max="${span.max}"${span.style === undefined ? "" : ` style="${span.style}"`}/>`).join(""),
    `<row r="1">${Array.from({ length: 40 }, (_, column) => `<c r="${formatA1(0, column)}"><v>1</v></c>`).join("")}</row>`);
  const book = await readXlsx(input, context);
  expect(book.sheets[0]!.cells.map(cell => cell.format)).toEqual(Array.from({ length: 40 }, (_, column) => {
    const matches = spans.filter(span => span.style !== undefined && column + 1 >= span.min && column + 1 <= span.max);
    return ["General", "0.00", "0%"][matches.at(-1)?.style ?? 0] ?? "General";
  }));
});

it("validates overridden declarations in source order", async () => {
  const input = await fixture('<col min="bad" max="1" style="1"/><col min="1" max="1" style="-1"/>',
    '<row r="1"><c r="A1"><v>1</v></c></row>');
  await expect(readXlsx(input, context)).rejects.toThrow("invalid number 'bad'");
});
