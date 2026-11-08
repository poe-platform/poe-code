import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
async function fixture(sheet: string) {
  const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = { "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="t" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${ss}"><fonts count="2"><font><name val="Sans"/><sz val="14"/><b/><color rgb="FFFF0000"/></font><font><name val="Sans"/><sz val="8"/></font></fonts><cellXfs count="2"><xf numFmtId="2" fontId="0"/><xf numFmtId="1" fontId="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ss}">${sheet}</worksheet>` };
  const zip = createZipCodec(), limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000, maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 }, entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text), { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return readXlsx(await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal), context);
}
it("applies style zero to new cells that omit an explicit style", async () => {
  const book = await fixture('<sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData>'), cell = book.sheets[0]!.cells[0]!;
  expect(cell.format).toBe("0.00");
  const style = metadataNode(cell.style?.gnumeric)!;
  expect(style.attributes.Fore).toBe("FFFF:0:0");
  expect(style.children.find(n => n.name === "Font")).toMatchObject({ text: "Sans", attributes: { Unit: "14", Bold: "1" } });
});
it.each([
  '<sheetData><row r="1"><c r="A1" s="1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData>',
  '<sheetData><row r="1" customFormat="1" s="1"><c r="A1"><v>2</v></c></row></sheetData>',
  '<cols><col min="1" max="1" style="1"/></cols><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData>'
])("preserves explicit/repeated/axis style precedence: %s", async sheet => {
  const cell = (await fixture(sheet)).sheets[0]!.cells[0]!;
  expect(cell.format).toBe("0");expect(metadataNode(cell.style?.gnumeric)!.children.find(n => n.name === "Font")!.attributes.Unit).toBe("8");
});
it("does not allocate a missing inline-string payload just because a default style exists", async () => {
  const book = await fixture('<sheetData><row r="1"><c r="A1" t="inlineStr"/></row></sheetData>');
  expect(book.sheets[0]!.cells).toEqual([]);
});
