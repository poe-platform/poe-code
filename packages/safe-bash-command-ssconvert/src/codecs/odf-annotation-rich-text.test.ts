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

// Calc xmlannoi.cxx delegates annotation children to its shape text context
// and records character-style selections via AddContentStyle.
it("imports annotation character styles and an explicitly empty author", async () => {
  expect(comment(await readOdf(await source(), context)).attributes).toMatchObject({
    Author: "", Text: value, TextFormat: "@[bold=1:0:6]"
  });
});

for (const profile of ["strict", "extended"] as const) {
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
