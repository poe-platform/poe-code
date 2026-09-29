import { expect, it } from "vitest";
import type { Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { content, context, fixture } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";
import { metadataNode } from "./xlsx-write-support.js";

const value = "é😀 \t\nz";
function commentBook(author = "Ada", format = "@[bold=1:0:2][italic=1:2:6]"): Workbook {
  return { sheets: [{ id: "S", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: {
    name: "Objects", attributes: {}, children: [{ name: "CellComment", attributes: {
      ObjectBound: "A1", Author: author, Text: value, TextFormat: format
    }, children: [], text: "" }], text: ""
  } }] }] };
}
function comment(book: Workbook) {
  return metadataNode(book.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!.data)!.children[0]!;
}
async function source() {
  return fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    '<table:table table:name="S"><table:table-row><table:table-cell><office:annotation office:display="true" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator/><dc:date>2026-01-01T00:00:00</dc:date>' +
    '<text:p><text:span text:style-name="Bold">é😀</text:span><text:s/><text:tab/><text:line-break/>z</text:p>' +
    '</office:annotation></table:table-cell></table:table-row></table:table>',
    '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>') });
}

async function legacySource(author: string, text = '<text:p><text:span text:style-name="Bold">é😀</text:span></text:p>') {
  return fixture({ mimetype: "application/vnd.sun.xml.calc", "content.xml":
    '<office:document-content xmlns:office="http://openoffice.org/2000/office" xmlns:table="http://openoffice.org/2000/table" xmlns:text="http://openoffice.org/2000/text" xmlns:style="http://openoffice.org/2000/style" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg">' +
    '<office:automatic-styles><style:style style:name="Bold" style:family="text"><style:properties fo:font-weight="bold"/></style:style></office:automatic-styles>' +
    '<office:body><table:table table:name="S"><table:table-row><table:table-cell>' +
    `<office:annotation office:author="${author}" office:create-date="2026-01-01T00:00:00" office:create-date-string="New Year" office:display="true" svg:x="2cm" svg:y="3cm">` +
    text + '</office:annotation>' +
    '</table:table-cell></table:table-row></table:table></office:body></office:document-content>' });
}

for (const author of ["Ada", ""]) it(`imports legacy office:author ${JSON.stringify(author)} with comment formatting`, async () => {
  expect(comment(await readOdf(await legacySource(author), context)).attributes).toMatchObject({
    Author: author, Text: "é😀", TextFormat: "@[bold=1:0:6]"
  });
});

it("reads nested legacy annotation spans and explicit whitespace", async () => {
  const bytes = await legacySource("Ada", '<text:p><text:span text:style-name="Bold">é<text:span>😀<text:tab-stop/></text:span><text:line-break/><text:s text:c="2"/>z</text:span></text:p>');
  expect(comment(await readOdf(bytes, context)).attributes).toMatchObject({ Author: "Ada", Text: "é😀\t\n  z", TextFormat: "@[bold=1:0:11]" });
});

it("lets an explicitly empty dc:creator override legacy office:author", async () => {
  const bytes = await legacySource("Ada", '<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/"/><text:p>note</text:p>');
  expect(comment(await readOdf(bytes, context)).attributes).toMatchObject({ Author: "", Text: "note" });
});

// Calc xmlannoi.cxx delegates annotation children to its shape text context
// and records character-style selections via AddContentStyle.
it("imports annotation character styles and an explicitly empty author", async () => {
  expect(comment(await readOdf(await source(), context)).attributes).toMatchObject({
    Author: "", Text: value, TextFormat: "@[bold=1:0:6]"
  });
});

for (const profile of ["strict", "extended"] as const) {
  it(`upgrades legacy annotation author, dates, position and text into ${profile} ODF`, async () => {
    const book = await readOdf(await legacySource("Ada"), context);
    const output = await createOdfWriter(profile)(book, [], context);
    const xml = (await unpackOdf(output)).parts.get("content.xml")!;
    expect(comment(await readOdf(output, context)).attributes).toMatchObject({ Author: "Ada", Text: "é😀", TextFormat: "@[bold=1:0:6]" });
    expect(xml).toContain('<dc:date>2026-01-01T00:00:00</dc:date>');
    expect(xml).toContain('<meta:date-string>New Year</meta:date-string>');
    expect(xml).toContain('office:display="true"');
    expect(xml).toContain('svg:x="2cm"');
    expect(xml).toContain('svg:y="3cm"');
    expect(xml).not.toContain('office:author=');
  });

  for (const author of ["Grace", "", undefined]) it(`preserves original annotation paragraphs when only author becomes ${String(author)} in ${profile} ODF`, async () => {
    const paragraphs = '<text:p><text:span text:style-name="Unrepresented">é😀</text:span></text:p><text:p>tail</text:p>';
    const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
      '<table:table table:name="S"><table:table-row><table:table-cell><office:annotation xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:creator>Ada</dc:creator>' + paragraphs + '</office:annotation></table:table-cell></table:table-row></table:table>',
      '<style:style style:name="Unrepresented" style:family="text"><style:text-properties fo:font-family="Example:Family]" fo:font-weight="bold" style:text-position="17% 71%"/></style:style>') });
    const book = await readOdf(bytes, context);
    expect(comment(book).attributes.TextFormat).toBeUndefined();
    const objects = book.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!;
    const node = metadataNode(objects.data)!;
    const attributes = { ...comment(book).attributes };
    if (author === undefined) delete attributes.Author; else attributes.Author = author;
    const edited: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: book.sheets[0]!.unsupportedRecords!.map(record =>
      record === objects ? { ...record, data: { ...node, children: [{ ...node.children[0]!, attributes, children: [] }] } } : record) }] };
    const output = await createOdfWriter(profile)(edited, [], context);
    expect((await unpackOdf(output)).parts.get("content.xml")).toContain(paragraphs);
    const result = comment(await readOdf(output, context)).attributes;
    expect(result.Author).toBe(author);
    expect(result.Text).toBe("é😀\ntail");
  });

  it(`exports rich annotation text and controls through ${profile} ODF`, async () => {
    const book = commentBook();
    const reopened = await readOdf(await createOdfWriter(profile)(book, [], context), context);
    expect(comment(reopened).attributes).toMatchObject(comment(book).attributes);
  });

  it(`keeps untouched annotation XML but applies comment edits and deletion in ${profile} ODF`, async () => {
    const book = await readOdf(await source(), context);
    const original = (await unpackOdf(await createOdfWriter(profile)(book, [], context))).parts.get("content.xml")!;
    expect(original).toContain("2026-01-01T00:00:00");
    const replacement = commentBook("Grace", "@[underline=double:0:6]").sheets[0]!.unsupportedRecords![0]!;
    const edited: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: book.sheets[0]!.unsupportedRecords!.map(record =>
      record.kind === "Objects" ? replacement : record) }] };
    const output = await createOdfWriter(profile)(edited, [], context);
    const xml = (await unpackOdf(output)).parts.get("content.xml")!;
    expect(xml).toContain('office:display="true"');
    expect(xml).toContain("2026-01-01T00:00:00");
    const reopened = await readOdf(output, context);
    expect(comment(reopened).attributes).toMatchObject({ Author: "Grace", Text: value, TextFormat: "@[underline=double:0:6]" });
    const removed: Workbook = { ...book, sheets: [{ ...book.sheets[0]!, unsupportedRecords: book.sheets[0]!.unsupportedRecords!.filter(record => record.kind !== "Objects") }] };
    const deleted = await readOdf(await createOdfWriter(profile)(removed, [], context), context);
    expect(deleted.sheets[0]!.unsupportedRecords!.some(record => record.kind === "Objects")).toBe(false);
  });
}
