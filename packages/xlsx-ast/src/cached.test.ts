import { expect, test } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import * as xlsx from "./index.js";

const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 20, maxPathBytes: 1000, maxDepth: 100, maxPaxBytes: 1000, maxTextBytes: 1000000, chunkSize: 512 };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

test("full reader recognizes present inline formula caches, including empty strings", async () => {
  const input = await fixture(`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><f>"hello"</f><is><t>hello</t></is></c><c r="B1" t="inlineStr"><f>""</f><is><t/></is></c><c r="C1" t="inlineStr"><f>"missing"</f></c></row></sheetData></worksheet>`);
  const bytes = await input.codec.writeZipArchive(input.archive, limits, input.signal);
  const book = await xlsx.readXlsx(bytes, { signal: input.signal, own() {},
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 100000 } });
  expect(book.sheets[0]!.cells).toMatchObject([
    { formulaDirty: false, cachedResult: { kind: "string", value: "hello" } },
    { formulaDirty: false, cachedResult: { kind: "string", value: "" } },
    { formulaDirty: true },
  ]);
  expect(book.sheets[0]!.cells[2]).not.toHaveProperty("cachedResult");
});
async function fixture(sheet: string) {
  const codec = createZipCodec(), signal = new AbortController().signal;
  const parts = {
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="${rel}/officeDocument" Target="xl/book.xml"/></Relationships>`,
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/book.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/book.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><workbookPr date1904="1"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Data" r:id="data"/></sheets></workbook>`,
    "xl/_rels/book.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="${rel}/worksheet" Target="worksheets/data.xml"/><Relationship Id="strings" Type="${rel}/sharedStrings" Target="strings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/strings.xml": `<sst xmlns="${ns}"><si><r><t>é</t></r><rPh><t>phonetic</t></rPh><r><t>漢</t></r></si></sst>`,
    "xl/styles.xml": `<styleSheet xmlns="${ns}"><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    "xl/worksheets/data.xml": sheet
  };
  const entries = [];
  for (const [name, source] of Object.entries(parts)) entries.push(await codec.makeZipEntry(name, new TextEncoder().encode(source), {
    modified: new Date("2020-01-01T00:00:00Z"), mode: 0o100644, directory: false, symlink: false, compression: "store"
  }, limits, signal));
  return { archive: { entries, comment: new Uint8Array() }, codec, limits, signal, maxXmlNodes: 10000, work() {}, retain(_bytes: number) {} };
}

test("cached reader retains dimensions, raw ISO dates, styles and cached formulas", async () => {
  expect(xlsx).toHaveProperty("readCachedXlsx");
  const input = await fixture(`<worksheet xmlns="${ns}"><dimension ref="A1:B2"/><sheetData><row r="2"><c r="B2" t="d" s="1"><v>2026-09-29T12:30:00Z</v></c><c t="s"><v>0</v></c><c><f>UNSUPPORTED.FUNCTION()</f><v>42</v></c><c><f>1+1</f></c></row></sheetData></worksheet>`);
  const result = await xlsx.readCachedXlsx(input);
  expect(result.date1904).toBe(true);
  expect(result.activeTab).toBe(0);
  expect(result.sheets[0]).toMatchObject({ name: "Data", dimension: "A1:B2", cells: [
    { row: 1, column: 1, type: "d", value: "2026-09-29T12:30:00Z", format: "yyyy-mm-dd" },
    { row: 1, column: 2, type: "s", value: "é漢" },
    { row: 1, column: 3, type: "n", value: 42 },
    { row: 1, column: 4, type: "n" }
  ] });
  expect(result.sheets[0]!.cells[3]!.value).toBeUndefined();
});

test("cached names-only reads skip malformed worksheet bodies", async () => {
  const result = await xlsx.readCachedXlsx({ ...await fixture("<malformed"), namesOnly: true });
  expect(result.sheets.map(sheet => sheet.name)).toEqual(["Data"]);
});

test("cached XML admits memory before parsing and charges checkpoints", async () => {
  const input = await fixture(`<worksheet xmlns="${ns}"><!--${"x".repeat(32768)}--></worksheet>`);
  let work = 0;
  await expect(xlsx.readCachedXlsx({ ...input, work() { if (++work > 64) throw new Error("work admission"); } })).rejects.toThrow("work admission");
  await expect(xlsx.readCachedXlsx({ ...input, retain() { throw new Error("memory admission"); } })).rejects.toThrow("memory admission");
});

test("cached XML refuses DTDs and enforces node and nesting bounds", async () => {
  await expect(xlsx.readCachedXlsx(await fixture(`<!DOCTYPE worksheet><worksheet xmlns="${ns}"/>`))).rejects.toThrow("DTD and entity declarations are forbidden");
  const input = await fixture(`<worksheet xmlns="${ns}">${"<nested>".repeat(8)}${"</nested>".repeat(8)}</worksheet>`);
  await expect(xlsx.readCachedXlsx({ ...input, limits: { ...limits, maxDepth: 6 } })).rejects.toThrow();
  await expect(xlsx.readCachedXlsx({ ...input, maxXmlNodes: 4 })).rejects.toThrow();
});

test.each([false, null, new SyntaxError("cancel")])("cached reader preserves cancellation reason %s", async reason => {
  const input = await fixture(`<worksheet xmlns="${ns}"/>`);
  const controller = new AbortController(); controller.abort(reason);
  await expect(xlsx.readCachedXlsx({ ...input, signal: controller.signal })).rejects.toBe(reason);
});
