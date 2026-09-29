import { expect, it } from "vitest";
import { parseXml } from "@poe-code/safe-fs/xml";
import type { Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { content, context, fixture } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";

const styles = '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="Reset" style:family="text" style:parent-style-name="Bold"><style:text-properties fo:font-weight="normal" fo:font-style="italic"/></style:style>';
const paragraph = '<text:p>é<text:span text:style-name="Bold">😀<text:span text:style-name="Reset">x</text:span><text:s/>z</text:span></text:p><text:p>tail</text:p>';
const source = () => fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
  `<table:table table:name="S"><table:table-row><table:table-cell office:value-type="string">${paragraph}</table:table-cell></table:table-row></table:table>`, styles) });

// Calc celltextparacontext.cxx:118-192 submits text and its text style as a
// span; styles are character properties, not merely opaque source metadata.
it("imports inherited and nested character styles at decoded UTF-8 boundaries", async () => {
  const book = await readOdf(await source(), context);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ value: { kind: "string", value: "é😀x z\ntail" }, richText: [
    { start: 2, end: 6, attributes: { bold: 1 } },
    { start: 6, end: 7, attributes: { bold: 0, italic: 1 } },
    { start: 7, end: 9, attributes: { bold: 1 } }
  ] });
});

for (const profile of ["strict", "extended"] as const) {
  it(`exports editable rich text through ${profile} ODF without losing Unicode or whitespace`, async () => {
    const value = "é😀 \t\n\ufeffz";
    const richText = [{ start: 2, end: 6, attributes: { family: "Noto Sans", size: 13312, bold: 1,
      italic: 0, strikethrough: 1, color: "12x34xAB", underline: "doubleAccounting" } }];
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [0, 1].map(row => ({ row, column: 0,
      value: { kind: "string", value }, richText })) }] };
    const bytes = await createOdfWriter(profile)(book, [], context);
    const { parts } = await unpackOdf(bytes);
    const xml = parseXml(parts.get("content.xml")!);
    const automatic = xml.children.find(node => node.localName === "automatic-styles")!;
    expect(automatic.children.filter(node => node.attributes.some(a => a.localName === "family" && a.value === "text"))).toHaveLength(1);
    const fonts = xml.children.find(node => node.localName === "font-face-decls")!;
    expect(fonts.children.some(node => node.attributes.some(a => a.localName === "font-family" && a.value === "Noto Sans"))).toBe(true);
    expect(parts.get("content.xml")).toContain('style:text-underline-type="double"');
    const reopened = await readOdf(bytes, context);
    const expected = [{ ...richText[0], attributes: { ...richText[0]!.attributes, underline: profile === "extended" ? "doubleAccounting" : "double" } }];
    for (const cell of reopened.sheets[0]!.cells) {
      expect(cell.value).toEqual({ kind: "string", value });
      expect(cell.richText).toEqual(expected);
    }
  });

  it(`preserves untouched rich XML but applies same-text formatting edits in ${profile} ODF`, async () => {
    const book = await readOdf(await source(), context);
    const original = await createOdfWriter(profile)(book, [], context);
    const retained = (await unpackOdf(original)).parts.get("content.xml")!;
    expect(retained).toContain('<text:span text:style-name="Bold">');
    expect((await readOdf(original, context)).sheets[0]!.cells[0]!.value).toEqual(book.sheets[0]!.cells[0]!.value);
    const cell = book.sheets[0]!.cells[0]!;
    const edited = { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ ...cell,
      richText: [{ start: 2, end: 6, attributes: { underline: "double" } }] }] }] };
    const output = await createOdfWriter(profile)(edited, [], context);
    const reopened = await readOdf(output, context);
    expect(reopened.sheets[0]!.cells[0]!.richText).toEqual(edited.sheets[0]!.cells[0]!.richText);
    const cleared = { ...book, sheets: [{ ...book.sheets[0]!, cells: [{ ...cell, richText: [] }] }] };
    expect((await readOdf(await createOdfWriter(profile)(cleared, [], context), context)).sheets[0]!.cells[0]!.richText).toBeUndefined();
  });
}

it("does not apply paragraph formatting to a different stored string value", async () => {
  const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
    `<table:table table:name="S"><table:table-row><table:table-cell office:string-value="other">${paragraph}</table:table-cell></table:table-row></table:table>`, styles) });
  const cell = (await readOdf(bytes, context)).sheets[0]!.cells[0]!;
  expect(cell.value).toEqual({ kind: "string", value: "other" });
  expect(cell.richText).toBeUndefined();
});

it("rejects a rich boundary inside a UTF-8 character before returning an ODF archive", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
    value: { kind: "string", value: "😀" }, richText: [{ start: 1, end: 4, attributes: { bold: 1 } }] }] }] };
  await expect(createOdfWriter("extended")(book, [], context)).rejects.toMatchObject({ code: "invalid-request" });
});
