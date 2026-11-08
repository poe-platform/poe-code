import { expect, it } from "vitest";
import type { Workbook } from "../workbook.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { content, context, fixture } from "./odf.test.js";
import { unpackOdf } from "./odf-write.test.js";
import { metadataNode } from "./xlsx-write-support.js";

// LibreOffice weighhdl.cxx maps normal/bold to 400/700 and accepts 100..900.
// GOffice go-format.c represents rich weight as (Pango weight - 400) / 300.
for (const weight of [100, 157, 170, 183, 196, 200, 219, 232, 245, 300, 350, 400, 500, 600, 700, 800, 900]) {
  const bold = (weight - 400) / 300;
  it(`imports numeric rich weight ${weight} in cells and annotations`, async () => {
    const style = `<style:style style:name="Weight" style:family="text"><style:text-properties fo:font-weight="${weight}"/></style:style>`;
    const paragraph = '<text:p><text:span text:style-name="Weight">é😀</text:span></text:p>';
    const bytes = await fixture({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content(
      '<table:table table:name="S"><table:table-row><table:table-cell office:value-type="string">' +
      `<office:annotation>${paragraph}</office:annotation>${paragraph}</table:table-cell></table:table-row></table:table>`, style) });
    const book = await readOdf(bytes, context);
    expect(book.sheets[0]!.cells[0]!.richText).toEqual([{ start: 0, end: 6, attributes: { bold } }]);
    const objects = metadataNode(book.sheets[0]!.unsupportedRecords!.find(record => record.kind === "Objects")!.data)!;
    expect(objects.children[0]!.attributes.TextFormat).toBe(`@[bold=${bold}:0:6]`);
  });

  for (const profile of ["strict", "extended"] as const) it(`exports numeric rich weight ${weight} through ${profile} ODF`, async () => {
    const richText = [{ start: 0, end: 6, attributes: { bold } }];
    const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
      value: { kind: "string", value: "é😀" }, richText }] }] };
    const bytes = await createOdfWriter(profile)(book, [], context);
    const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
    expect(xml).toContain(`fo:font-weight="${weight === 400 ? "normal" : weight === 700 ? "bold" : weight}"`);
    expect((await readOdf(bytes, context)).sheets[0]!.cells[0]!.richText).toEqual(richText);
  });
}

for (const profile of ["strict", "extended"] as const) it(`retains GOffice truncation for fractional rich weight through ${profile} ODF`, async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [{ row: 0, column: 0,
    value: { kind: "string", value: "A" }, richText: [{ start: 0, end: 1, attributes: { bold: -0.809 } }] }] }] };
  const bytes = await createOdfWriter(profile)(book, [], context);
  expect((await unpackOdf(bytes)).parts.get("content.xml")).toContain('fo:font-weight="157"');
});
