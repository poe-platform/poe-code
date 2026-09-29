import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { parseXml } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { readXlsxComments } from "./xlsx-metadata.js";
import { metadataNode } from "./xlsx-write-support.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 1000 } };
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// LibreOffice bce0998a commentsfragment.cxx delegates text to RichStringContext;
// richstring.cxx decodes each portion separately. Author uses ST_Xstring in OOXML.
it.each([
  ['<t>_x0042__x005F_x0000_</t>', "B_x0000_"],
  ['<r><t>_x0042_</t></r><r><t>_x005F_x0000_</t></r>', "B_x0000_"],
  ['<r><t>_x00</t></r><r><t>41_</t></r>', "_x0041_"],
  ['<t>_x0000__xD800__xFFFE_</t>', "\0\ud800\ufffe"],
  ['<t xml:space="preserve"> note &amp; text </t>', " note & text "],
])("imports comment string portions without trimming or rescanning: %s", (text, value) => {
  const record = readXlsxComments(parseXml(
    `<comments xmlns="${namespace}"><authors><author> Author _x0041_ </author></authors><commentList><comment ref="A1" authorId="0"><text>${text}</text></comment></commentList></comments>`), context);
  expect(metadataNode(record.data)).toMatchObject({ children: [{ attributes: { Author: " Author A ", Text: value } }] });
});

it("preserves an explicitly empty comment author", () => {
  const record = readXlsxComments(parseXml(
    `<comments xmlns="${namespace}"><authors><author/></authors><commentList><comment ref="A1" authorId="0"><text><t/></text></comment></commentList></comments>`), context);
  expect(metadataNode(record.data)).toMatchObject({ children: [{ attributes: { Author: "", Text: "" } }] });
});

// Gnumeric sheet-object-cell-comment.c:333-370 transports Pango markup in
// TextFormat. LibreOffice imports comment text through RichStringContext.
it("imports comment formatting with UTF-8 offsets after XString decoding", () => {
  const record = readXlsxComments(parseXml(
    `<comments xmlns="${namespace}"><authors><author>Ada</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><b/></rPr><t>é</t></r><r><rPr><i/></rPr><t>_xD83D__xDE00_</t></r><t>z</t></text></comment></commentList></comments>`), context);
  expect(metadataNode(record.data)).toMatchObject({ children: [{ attributes: {
    ObjectBound: "B2", Author: "Ada", Text: "é😀z", TextFormat: "@[bold=1:0:2][italic=1:2:6]"
  } }] });
});

for (const edition of ["2006", "2008"] as const)
it.each(["@[bold=1:0:2][italic=1:2:6]", "@[bold=1:0:7]"])(`preserves comment markup through Gnumeric and XLSX transport (${edition}): %s`, async format => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Objects><g:CellComment ObjectBound="B2" Author="Ada" Text="é😀z" TextFormat="${format}"/></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`;
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const before = structuredClone(book);
  const bytes = await createXlsxWriter(edition)(book, [], context);
  const zip = createZipCodec();
  const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const archive = await zip.readZipArchive(bytes, limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/comments1.xml")!;
  const decoder = new TextDecoder(); let content = "";
  for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) content += decoder.decode(chunk, { stream: true });
  const comments = parseXml(content + decoder.decode());
  const text = comments.children.find(node => node.localName === "commentList")!.children[0]!.children[0]!;
  // Calc applies the first portion to the caption shape, including single-run
  // comments. Keep that portion empty and format the visible text as a range.
  expect(text.children[0]!.children.find(node => node.localName === "t")?.text).toBe("");
  const portions = text.children.filter(run => run.children.find(node => node.localName === "t")?.text);
  expect(portions.map(run => ({ text: run.children.find(node => node.localName === "t")?.text,
    properties: run.children.find(node => node.localName === "rPr")?.children.map(property => property.localName) ?? [] }))).toEqual(format === "@[bold=1:0:7]" ? [{ text: "é😀z", properties: ["b"] }] : [
    { text: "é", properties: ["b"] }, { text: "😀", properties: ["i"] }, { text: "z", properties: [] }
  ]);
  // Calc's comment XText append path inherits the prior font without rPr.
  // An explicit empty rPr restores defaults without inventing markup values.
  if (portions.length === 3) expect(portions[2]!.children.find(node => node.localName === "rPr")).toMatchObject({ children: [] });
  const read = await readXlsx(bytes, context);
  const objects = read.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!;
  expect(metadataNode(objects.data)).toMatchObject({ children: [{ attributes: { Text: "é😀z", TextFormat: format } }] });
  expect(new TextDecoder().decode(await writeGnumeric(read, [], context))).toContain(`TextFormat="${format}"`);
  expect(book).toEqual(before);
});

it.each(["Font:Name]", "Font]Name"])("preserves rich comment font %s", async family => {
  const zip = createZipCodec();
  const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${packageNamespace}"><Relationship Id="w" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${namespace}" xmlns:r="${relationships}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageNamespace}"><Relationship Id="s" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${namespace}"><sheetData/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="${packageNamespace}"><Relationship Id="c" Type="${relationships}/comments" Target="../comments1.xml"/></Relationships>`,
    "xl/comments1.xml": `<comments xmlns="${namespace}"><authors><author>Ada</author></authors><commentList><comment ref="B2" authorId="0"><text><r><rPr><rFont val="${family}"/><b/></rPr><t>é</t></r></text></comment></commentList></comments>`
  };
  const entries = [];
  for (const [name, content] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(content),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  const book = await readXlsx(await zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal), context);
  if (!family.includes(":")) expect(metadataNode(book.sheets[0]!.unsupportedRecords!.find(r => r.kind === "Objects")!.data)!.children[0]!.attributes.TextFormat)
    .toContain(`[family=${family}:0:2]`);
  for (const edition of ["2006", "2008"] as const) {
    const output = await zip.readZipArchive(await createXlsxWriter(edition)(book, [], context), limits, context.signal);
    const entry = output.entries.find(entry => entry.name === "xl/comments1.xml")!;
    const decoder = new TextDecoder(); let content = "";
    for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) content += decoder.decode(chunk, { stream: true });
    expect(content + decoder.decode()).toContain(`<rFont val="${family}"/>`);
    expect(["<b/>", '<b val="1"/>', '<b val="true"/>'].some(bold => content.includes(bold))).toBe(true);
    expect(content).toContain("<t>é</t>");
  }
});

for (const edition of ["2006", "2008"] as const) {
  it.each([
    [" _x0041_ ", " _x005F_x0041_ "],
    ["\0\u0001\ud800\ufffe", "_x0000__x0001__xD800__xFFFE_"],
    [" plain & <text> \r\n\t", " plain & <text> \r\n\t"],
    ["", ""],
  ])(`exports and reimports comment author/text strings (${edition}): %j`, async (value, wire) => {
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{
      source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
        name: "Objects", namespace: "http://www.gnumeric.org/v10.dtd", text: "", attributes: {}, children: [{
          name: "CellComment", namespace: "http://www.gnumeric.org/v10.dtd", text: "", children: [],
          attributes: { ObjectBound: "A1", Author: value, Text: value }
        }]
      }
    }] }] };
    const before = structuredClone(book);
    const bytes = await createXlsxWriter(edition)(book, [], context);
    const zip = createZipCodec();
    const limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
      maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
    const archive = await zip.readZipArchive(bytes, limits, context.signal);
    const entry = archive.entries.find(entry => entry.name === "xl/comments1.xml")!;
    let source = "";
    const decoder = new TextDecoder();
    for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) source += decoder.decode(chunk, { stream: true });
    const xml = parseXml(source + decoder.decode());
    const author = xml.children.find(node => node.localName === "authors")!.children[0]!;
    const text = xml.children.find(node => node.localName === "commentList")!.children[0]!.children[0]!.children[0]!;
    expect(author.text).toBe(wire);
    expect(text.text).toBe(wire);
    if (value.trim() !== value) expect(source).toContain('xml:space="preserve"');
    const read = await readXlsx(bytes, context);
    const objects = read.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!;
    expect(metadataNode(objects.data)).toMatchObject({ children: [{ attributes: { Author: value, Text: value } }] });
    expect(book).toEqual(before);
  });
}
