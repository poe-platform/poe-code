import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 3, operations: 100 } };

async function parts(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = createZipCodec(), bounds = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, bounds, context.signal), result = new Map<string, string>();
  for (const entry of archive.entries) {
    const decoder = new TextDecoder(); let text = "";
    for await (const chunk of zip.decodeZipEntry(entry, bounds, context.signal)) text += decoder.decode(chunk, { stream: true });
    result.set(entry.name, text + decoder.decode());
  }
  return result;
}

it.each(["2006", "2008"] as const)("%s classifies every malformed cell coordinate as outside writer limits", async edition => {
  for (const coordinate of [NaN, 0.5, Infinity, -1, 1048576]) {
    const book: Workbook = { sheets: [{ id: "s", name: "S", size: { rows: 1048576, columns: 16384 },
      cells: [{ row: coordinate, column: 0, value: { kind: "number", value: 1 } }] }] };
    await expect(createXlsxWriter(edition)(book, [], context)).rejects.toMatchObject({ code: "unsupported-feature",
      message: "Unsupported ssconvert feature: XLSX cell outside writer sheet limits" });
    const columnBook: Workbook = { sheets: [{ ...book.sheets[0]!,
      cells: [{ row: 0, column: coordinate, value: { kind: "number", value: 1 } }] }] };
    await expect(createXlsxWriter(edition)(columnBook, [], context)).rejects.toMatchObject({ code: "unsupported-feature" });
  }
});

it.each(["2006", "2008"] as const)("%s preserves empty and axis-only sheets without phantom cells", async edition => {
  const book: Workbook = { sheets: [{ id: "empty", name: "Empty", cells: [] }, { id: "axis", name: "Axis", cells: [],
    rows: [{ index: 7, hidden: true, outlineLevel: 1 }], columns: [{ index: 3, hidden: true }] }] };
  const bytes = await createXlsxWriter(edition)(book, [], context), xml = await parts(bytes);
  expect(xml.get("xl/worksheets/sheet1.xml")).toContain('<dimension ref="A1"/>');
  expect(xml.get("xl/worksheets/sheet2.xml")).toContain('<dimension ref="A1:D8"/>');
  expect(xml.get("xl/worksheets/sheet2.xml")).toContain('<row r="8" spans="1:4" hidden="1" outlineLevel="1"/>');
  const reopened = await readXlsx(bytes, context);
  expect(reopened.sheets.map(sheet => sheet.cells)).toEqual([[], []]);
  expect(reopened.sheets[1]!.rows).toContainEqual(expect.objectContaining({ index: 7, hidden: true, outlineLevel: 1 }));
  expect(reopened.sheets[1]!.columns).toContainEqual(expect.objectContaining({ index: 3, hidden: true }));
});

it.each(["2006", "2008"] as const)("%s admits the final XLSX address and preserves typed caches and input order", async edition => {
  const book: Workbook = { calculationMode: "manual", sheets: [{ id: "s", name: "S", size: { rows: 1048576, columns: 16384 }, cells: [
    { row: 1048575, column: 16383, value: { kind: "boolean", value: false } },
    { row: 0, column: 2, formula: "=1/0", value: { kind: "blank" }, cachedResult: { kind: "error", value: "#DIV/0!" } },
    { row: 0, column: 1, formula: "=FALSE", value: { kind: "blank" }, cachedResult: { kind: "boolean", value: false } },
    { row: 0, column: 0, formula: "=0", value: { kind: "blank" }, cachedResult: { kind: "number", value: 0 } }
  ] }] };
  const initialOrder = book.sheets[0]!.cells.map(cell => [cell.row, cell.column]);
  const bytes = await createXlsxWriter(edition)(book, [], context), xml = (await parts(bytes)).get("xl/worksheets/sheet1.xml")!;
  expect(xml).toContain('<dimension ref="A1:XFD1048576"/>');
  expect(xml).toContain('<c r="XFD1048576" t="b"><v>0</v></c>');
  expect(xml).toContain('<c r="A1"><f>0</f><v>0</v></c>');
  expect(xml).toContain('<c r="B1" t="b"><f>FALSE</f><v>0</v></c>');
  expect(xml).toContain('<c r="C1" t="e"><f>1/0</f><v>#DIV/0!</v></c>');
  expect(book.sheets[0]!.cells.map(cell => [cell.row, cell.column])).toEqual(initialOrder);
  const reopened = await readXlsx(bytes, context);
  expect(reopened.sheets[0]!.cells.slice(0, 3).map(cell => cell.cachedResult)).toEqual([
    { kind: "number", value: 0 }, { kind: "boolean", value: false }, { kind: "error", value: "#DIV/0!" }
  ]);
  expect(await createXlsxWriter(edition)(book, [], context)).toEqual(bytes);
});

it.each(["2006", "2008"] as const)("%s preserves falsey cancellation identity before any workbook observation", async edition => {
  const controller = new AbortController(); controller.abort(0);
  const input = { get sheets(): never { throw new Error("cancelled writer read workbook"); } };
  await expect(createXlsxWriter(edition)(input, [], { ...context, signal: controller.signal })).rejects.toBe(0);
});

it.each(["2006", "2008"] as const)("%s distinguishes soft imported sizes from explicit and API-only sizes", async edition => {
  const axisStyle = (name: string, hardSize: string) => ({ gnumeric: { name, namespace: "http://www.gnumeric.org/v10.dtd",
    attributes: [{ name: "HardSize", namespace: "", value: hardSize }], children: [] } });
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], rows: [
    { index: 0, sizePoints: 15, style: axisStyle("RowInfo", "0") },
    { index: 1, sizePoints: 16, style: axisStyle("RowInfo", "1") },
    { index: 2, sizePoints: 17 }
  ], columns: [
    { index: 0, sizePoints: 48, style: axisStyle("ColInfo", "0") },
    { index: 1, sizePoints: 48, style: axisStyle("ColInfo", "1") },
    { index: 2, sizePoints: 48 }
  ] }] };
  const sheet = (await parts(await createXlsxWriter(edition)(book, [], context))).get("xl/worksheets/sheet1.xml")!;
  expect(sheet).toContain('<row r="1" spans="1:3" ht="15"/>');
  expect(sheet).toContain('<row r="2" spans="1:3" customHeight="1" ht="16"/>');
  expect(sheet).toContain('<row r="3" spans="1:3" customHeight="1" ht="17"/>');
  expect(sheet).toContain('<col min="1" max="1" style="0" width="9.142307692307693"/>');
  expect(sheet).toContain('<col min="2" max="2" style="0" width="9.142307692307693" customWidth="1"/>');
  expect(sheet).toContain('<col min="3" max="3" style="0" width="9.142307692307693" customWidth="1"/>');
});

it.each(["2006", "2008"] as const)("%s retains loss warnings for unknown or unconverted axis records", async edition => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [
    { source: "Gnumeric_XmlIO:sax", kind: "Rows", disposition: "retained" },
    { source: "Gnumeric_XmlIO:sax", kind: "Cols", disposition: "retained" }
  ] }, { id: "t", name: "T", cells: [], rows: [], columns: [], unsupportedRecords: [
    { source: "foreign-importer", kind: "Rows", disposition: "retained" },
    { source: "foreign-importer", kind: "Cols", disposition: "retained" }
  ] }] };
  const warnings: string[] = [];
  await createXlsxWriter(edition)(book, [], { ...context, async diagnostic(value) { warnings.push(value.message); } });
  expect(warnings).toEqual(["XLSX writer does not export sheet 'S' record 'Rows'", "XLSX writer does not export sheet 'S' record 'Cols'",
    "XLSX writer does not export sheet 'T' record 'Rows'", "XLSX writer does not export sheet 'T' record 'Cols'"]);
});

it.each(["2006", "2008"] as const)("%s computes outline maxima independently for each axis and sheet", async edition => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [],
    rows: [{ index: 0, outlineLevel: 1 }, { index: 5, outlineLevel: 4 }, { index: 9, outlineLevel: 2 }],
    columns: [{ index: 0, outlineLevel: 6 }, { index: 3, outlineLevel: 3 }, { index: 7, outlineLevel: 0 }] },
  { id: "t", name: "T", cells: [], rows: [{ index: 2, outlineLevel: 0 }], columns: [{ index: 2 }] }] };
  const xml = await parts(await createXlsxWriter(edition)(book, [], context));
  expect(xml.get("xl/worksheets/sheet1.xml")).toContain('<sheetFormatPr defaultColWidth="48" defaultRowHeight="12.75" outlineLevelRow="4" outlineLevelCol="6"/>');
  expect(xml.get("xl/worksheets/sheet2.xml")).toContain('<sheetFormatPr defaultColWidth="48" defaultRowHeight="12.75"/>');
});
