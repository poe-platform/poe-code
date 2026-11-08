import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { readOdf } from "./odf.js";
import { readXlsx } from "./xlsx.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import { readSpreadsheetML } from "./spreadsheetml.js";
import { readHtml } from "./html.js";
import { createOdfXml } from "./odf-write-support.js";
import { createXlsxXml } from "./xlsx-write-support.js";
import type { ImportedValue } from "../workbook.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: Infinity, outputBytes: Infinity, cells: Infinity, sheets: Infinity, operations: Infinity }
};
const office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0", table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const deep = "<ignored>".repeat(150) + "</ignored>".repeat(150);

async function archive(parts: Readonly<Record<string, string>>) {
  const zip = createZipCodec(), limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
    maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text), {
    modified: new Date("2000-01-01T00:00:00Z"), mode: 0o644, directory: false, symlink: false, compression: "store"
  }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

const formats = [
  { name: "ODF", read: readOdf, async input(extra: string, longPath = false) {
    return archive({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml":
      `<office:document-content xmlns:office="${office}" xmlns:table="${table}"><office:body><office:spreadsheet><table:table table:name="S"/></office:spreadsheet></office:body>${extra}</office:document-content>`,
      ...(longPath ? { ["x".repeat(4097)]: "unused" } : {}) });
  } },
  { name: "XLSX", read: readXlsx, async input(extra: string, longPath = false) {
    return archive({ "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets>${extra}</workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="sheet.xml"/></Relationships>`,
      "xl/sheet.xml": `<worksheet xmlns="${ss}"><sheetData/></worksheet>`,
      ...(longPath ? { ["x".repeat(4097)]: "unused" } : {}) });
  } },
  { name: "Gnumeric", read: readGnumeric, async input(extra: string) {
    return new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cells/></g:Sheet></g:Sheets>${extra}</g:Workbook>`);
  } },
  { name: "SpreadsheetML", read: readSpreadsheetML, async input(extra: string) {
    return new TextEncoder().encode(`<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="S"><Table/></Worksheet>${extra}</Workbook>`);
  } }
];

for (const format of formats) {
  it(`${format.name} accepts deep XML with omitted limits and enforces an explicit depth`, async () => {
    const bytes = await format.input(deep);
    expect((await format.read(bytes, context)).sheets[0]?.name).toBe("S");
    expect((await format.read(bytes, { ...context, limits: { ...context.limits, xmlDepth: Infinity } })).sheets[0]?.name).toBe("S");
    await expect(format.read(bytes, { ...context, limits: { ...context.limits, xmlDepth: 128 } })).rejects.toThrow();
  });
}
for (const format of formats.slice(0, 2)) {
  it(`${format.name} accepts archive member names beyond the former implicit path ceiling`, async () => {
    expect((await format.read(await format.input("", true), context)).sheets[0]?.name).toBe("S");
  });
}
for (const [name, create] of [["ODF", (context: CapabilityContext) => createOdfXml(context, false)], ["XLSX", createXlsxXml]] as const) {
  it(`${name} writers accept work beyond the former implicit ceiling and enforce explicit work`, () => {
    const writer = create(context);
    expect(() => writer.charge(10_000_001)).not.toThrow();
    expect(writer.element("value")).toBe("<value/>");
    expect(() => create({ ...context, limits: { ...context.limits, workbookWork: 10 } }).charge(11)).toThrow("work limit");
  });
}

it("HTML import accepts deep markup and enforces explicitly configured depth", async () => {
  const bytes = new TextEncoder().encode(`<html><body><table><tr><td>${"<div>".repeat(300)}value${"</div>".repeat(300)}</td></tr></table></body></html>`);
  expect((await readHtml(bytes, context)).sheets[0]?.cells[0]?.value).toEqual({ kind: "string", value: "value" });
  await expect(readHtml(bytes, { ...context, limits: { ...context.limits, xmlDepth: 128 } })).rejects.toThrow("depth");
});

it("ODF retained metadata uses only the configured XML depth", () => {
  let node: ImportedValue = { name: "span", namespace: "urn:oasis:names:tc:opendocument:xmlns:text:1.0", text: "value" };
  for (let index = 0; index < 150; index++) node = { name: "span", namespace: "urn:oasis:names:tc:opendocument:xmlns:text:1.0", children: [node] };
  expect(createOdfXml(context, false).retained(node)).toContain("value");
  expect(() => createOdfXml({ ...context, limits: { ...context.limits, xmlDepth: 128 } }, false).retained(node)).toThrow("depth");
});

it("Gnumeric retained metadata uses only the configured XML depth", async () => {
  let node: ImportedValue = { name: "Attribute", namespace: "http://www.gnumeric.org/v10.dtd", text: "value" };
  for (let index = 0; index < 150; index++) node = { name: "Attributes", namespace: "http://www.gnumeric.org/v10.dtd", children: [node] };
  const book = { sheets: [{ id: "s", name: "S", cells: [] }], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Attributes", disposition: "retained" as const, data: node }] };
  expect(new TextDecoder().decode(await writeGnumeric(book, [], context))).toContain("value");
  await expect(writeGnumeric(book, [], { ...context, limits: { ...context.limits, xmlDepth: 128 } })).rejects.toThrow("depth");
});
