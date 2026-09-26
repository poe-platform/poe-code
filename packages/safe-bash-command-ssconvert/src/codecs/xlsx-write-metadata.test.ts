import { expect, it } from "vitest";
import { readGnumeric } from "./gnumeric.js";
import { createXlsxWriter } from "./xlsx.js";
import { createZipCodec } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 3, operations: 1000 } };
const fixture = `<?xml version="1.0"?><g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" Version="14"><g:Sheets><g:Sheet Rows="65536" Cols="256"><g:Name>S</g:Name><g:Styles><g:StyleRegion startRow="0" endRow="2" startCol="0" endCol="1"><g:Style Format="0.000"><g:Validation Style="GNM_VALIDATION_STYLE_WARNING" Type="GNM_VALIDATION_TYPE_AS_INT" Operator="GNM_VALIDATION_OP_BETWEEN" AllowBlank="1" UseDropdown="1" Title="Bad" Message="range"><g:Expression0>1</g:Expression0><g:Expression1>9</g:Expression1></g:Validation><g:Condition Operator="2"><g:Expression0>5</g:Expression0><g:Style Back="FFFF:0000:0000" Shade="1"/></g:Condition></g:Style></g:StyleRegion><g:StyleRegion startRow="0" endRow="0" startCol="2" endCol="2"><g:Style><g:HyperLink type="GnmHLinkURL" target="https://example.com/path#location" tip="go"/></g:Style></g:StyleRegion></g:Styles><g:Objects><g:CellComment ObjectBound="A1" ObjectOffset="1 0 1 0" Direction="17" Print="1" Author="Me" Text="hello &amp; world"/></g:Objects><g:Cells><g:Cell Row="0" Col="0" ValueType="40">3</g:Cell><g:Cell Row="0" Col="1">=A1+2</g:Cell><g:Cell Row="0" Col="2" ValueType="60">link</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
it.each(["2006", "2008"] as const)("exports measured style regions, validation, CF, comments and links (%s)", async edition => {
  const book = await readGnumeric(new TextEncoder().encode(fixture), context);
  const parts = await unpack(await createXlsxWriter(edition)(book, [], context));
  const sheet = parts.get("xl/worksheets/sheet1.xml")!;
  expect(sheet).toContain('dimension ref="A1:C3"');
  expect(sheet).toContain('<c r="A3" s="1"/>');
  expect(sheet).toContain('conditionalFormatting sqref="A1:B3"');
  expect(sheet).toContain('type="cellIs" dxfId="0" priority="1" stopIfTrue="1" operator="equal"');
  expect(sheet).toContain('dataValidation type="whole" errorStyle="warning" allowBlank="1" showDropDown="0"');
  expect(sheet).toContain('<formula1>1</formula1><formula2>9</formula2>');
  expect(sheet).toContain('hyperlink ref="C1" r:id="rId3" location="location" tooltip="go"');
  expect(sheet).toContain('legacyDrawing r:id="rId2"');
  expect(parts.get("xl/comments1.xml")).toContain('hello &amp; world');
  expect(parts.get("xl/worksheets/_rels/sheet1.xml.rels")).toContain('Target="https://example.com/path"');
  expect(parts.get("xl/styles.xml")).toContain('<dxfs count="1">');
  const types = parts.get("[Content_Types].xml")!;
  expect(types).not.toContain('Override PartName="/xl/drawings/vmlDrawing1.vml"');
  expect(types.indexOf('PartName="/xl/comments1.xml"')).toBeLessThan(types.indexOf('PartName="/xl/worksheets/sheet1.xml"'));
});
it("writes typed custom and mapped workbook properties in native UTF-8 key order", async () => {
  const book = { properties: { "dc:title": "Title", "meta:initial-creator": "Author", "dc:publisher": "Company", "meta:editing-duration": "PT2M30S",
    Z: true, Amount: 2.5, Editor: "person", A: "custom", "\ue000": "bmp", "\u{10000}": "supplementary" }, sheets: [{ id: "s", name: "S", cells: [] }] };
  const parts = await unpack(await createXlsxWriter("2008")(book, [], context));
  expect(parts.get("docProps/app.xml")).toContain('<Company>Company</Company><TotalTime>3</TotalTime>');
  expect(parts.get("docProps/core.xml")).toContain('<dc:title>Title</dc:title><dc:creator>Author</dc:creator>');
  const custom = parts.get("docProps/custom.xml")!;
  expect(custom).toContain('pid="29" name="A"><vt:lpwstr>custom</vt:lpwstr>');
  expect(custom).toContain('pid="30" name="Amount"><vt:decimal>2.5</vt:decimal>');
  expect(custom).toContain('pid="2" name="Editor"><vt:lpwstr>person</vt:lpwstr>');
  expect(custom).toContain('<vt:bool>true</vt:bool>');
  expect(custom.indexOf('name="\ue000"')).toBeLessThan(custom.indexOf('name="\u{10000}"'));
});
it("exports property and format keys that collide with Object.prototype as user data", async () => {
  const properties = Object.fromEntries([["constructor", "a"], ["toString", "b"], ["__proto__", "c"]]);
  const parts = await unpack(await createXlsxWriter("2008")({ properties, sheets: [{ id: "s", name: "S",
    cells: [{ row: 0, column: 0, value: { kind: "number", value: 1 }, format: "constructor" }] }] }, [], context));
  expect(parts.get("docProps/custom.xml")).toContain('name="constructor"><vt:lpwstr>a</vt:lpwstr>');
  expect(parts.get("docProps/custom.xml")).toContain('name="__proto__"><vt:lpwstr>c</vt:lpwstr>');
  expect(parts.get("xl/styles.xml")).toContain('formatCode="constructor" numFmtId="100"');
});
it("preserves a whole-sheet style across explicit column metadata and uncovered columns", async () => {
  const input = { sheets: [{ id: "s", name: "S", cells: [], columns: [{ index: 0, sizePoints: 40 }], unsupportedRecords: [{
    source: "Gnumeric_XmlIO:sax", kind: "Styles", disposition: "retained" as const, data: { name: "Styles", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: [], children: [{
      name: "StyleRegion", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: { startRow: "0", endRow: "65535", startCol: "0", endCol: "255" },
      children: [{ name: "Style", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: { Format: "0.000" }, children: [] }] }] } }] }] };
  const parts = await unpack(await createXlsxWriter("2008")(input, [], context));
  const sheet = parts.get("xl/worksheets/sheet1.xml")!;
  expect(sheet).toContain('col min="1" max="1" style="1"');
  expect(sheet).toContain('col min="2" max="256" style="1"');
});

it("warns only for document metadata not represented by exported properties", async () => {
  const meta = `<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"><office:meta><meta:creation-date>2000-01-01T00:00:00Z</meta:creation-date><meta:user-defined meta:name="Amount" meta:value-type="float">2.5</meta:user-defined>EXTRA</office:meta></office:document-meta>`;
  for (const extra of ["", "<meta:unknown>lost</meta:unknown>"]) {
    const warnings: string[] = [];
    const book = await readGnumeric(new TextEncoder().encode(fixture.replace("<g:Sheets>", meta.replace("EXTRA", extra) + "<g:Sheets>")), context);
    await createXlsxWriter("2008")(book, [], { ...context, async diagnostic(d) { warnings.push(d.message); } });
    expect(warnings.filter(w => w.includes("document-meta"))).toHaveLength(extra ? 1 : 0);
  }
});
it("warns for differential style fields that cannot be exported", async () => {
  const warnings: string[] = [];
  const book = await readGnumeric(new TextEncoder().encode(fixture.replace('Back="FFFF:0000:0000" Shade="1"', 'Back="FFFF:0000:0000" Shade="1" Format="0.00" HAlign="8"')), context);
  await createXlsxWriter("2008")(book, [], { ...context, async diagnostic(d) { warnings.push(d.message); } });
  expect(warnings).toContain("XLSX writer does not export sheet 'S' differential style fields 'Format, HAlign'");
});
it("materializes a missing formula cache even in a manual-calculation workbook", async () => {
  const book = { calculationMode: "manual" as const, sheets: [{ id: "s", name: "S", cells: [
    { row: 0, column: 0, value: { kind: "number" as const, value: 3 } },
    { row: 0, column: 1, formula: "=A1+2", value: { kind: "blank" as const } }
  ] }] };
  const parts = await unpack(await createXlsxWriter("2008")(book, [], context));
  expect(parts.get("xl/worksheets/sheet1.xml")).toContain("<f>A1+2</f><v>5</v>");
  expect(parts.get("xl/workbook.xml")).toContain('calcMode="manual"');
});

async function unpack(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = createZipCodec(); const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, new AbortController().signal); const result = new Map<string, string>();
  for (const entry of archive.entries) {
    let text = ""; const decoder = new TextDecoder();
    for await (const chunk of zip.decodeZipEntry(entry, limits, new AbortController().signal)) text += decoder.decode(chunk, { stream: true });
    result.set(entry.name, text + decoder.decode());
  }
  return result;
}
