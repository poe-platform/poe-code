import { expect, it } from "vitest";
import { readGnumeric } from "./gnumeric.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { context, unpackOdf } from "./odf-write.test.js";
import { odfAttributes, odfChildren, odfObject } from "./odf-write-support.js";

// Calc's ScXMLCellFieldURLContext collects character data, but has no child
// contexts for text:s, text:tab or text:line-break inside the URL field.
it.each([
  ["Open Data", "Open Data"],
  ["  Open  Data  ", "  Open  Data  "],
  ["Open\tData\nnext\rline", "Open&#9;Data&#10;next&#13;line"],
  ['Café & <Data> "now"', "Café &amp; &lt;Data&gt; &quot;now&quot;"]
])("exports hyperlink display text as character data: %j", async (label, encoded) => {
  const input = '<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles>' +
    '<g:StyleRegion startRow="0" endRow="0" startCol="0" endCol="0"><g:Style><g:HyperLink type="GnmHLinkCurWB" target="S!A2"/></g:Style></g:StyleRegion>' +
    '</g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="60">original</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>';
  const original = await readGnumeric(new TextEncoder().encode(input), context);
  for (const profile of ["strict", "extended"] as const) for (const regions of [true, false]) {
    const book = { ...original, sheets: original.sheets.map(s => ({ ...s,
      ...(regions ? {} : { unsupportedRecords: [] }),
      cells: s.cells.map(c => ({ ...c, value: { kind: "string" as const, value: label } })) })) };
    const bytes = await createOdfWriter(profile)(book, [], context);
    const xml = (await unpackOdf(bytes)).parts.get("content.xml")!;
    expect(xml).toContain(`>${encoded}</text:a>`);
    const reopened = await readOdf(bytes, context);
    expect(reopened.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: label });
  }
});

it.each([
  ["'Bang!'!$A$1:$B$2", "#'Bang!'.$A$1:$B$2"],
  ["'O\\'Brien'!A1", "#'O''Brien'.A1"],
  ["Q.1!A1", "#'Q.1'.A1"],
  ["'Path\\\\Data'!A1", "#'Path%5CData'.A1"],
  ["'Rate%20'!A1", "#'Rate%2520'.A1"],
  ["'Bang!'!Total", "#'Bang!'.Total"],
  ["Total", "#Total"]
])("preserves internal hyperlink target %s across ODF exports", async (target, href) => {
  const input = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles>
    <g:StyleRegion startRow="0" endRow="1" startCol="0" endCol="0"><g:Style><g:HyperLink type="GnmHLinkCurWB" target="${target}"/></g:Style></g:StyleRegion>
    </g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="60">link</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(input), context);
  const cellsOnly = { ...original, sheets: original.sheets.map(s => ({ ...s, unsupportedRecords: [] })) };
  for (const profile of ["strict", "extended"] as const) for (const book of [original, cellsOnly]) {
    const bytes = await createOdfWriter(profile)(book, [], context);
    expect((await unpackOdf(bytes)).parts.get("content.xml")).toContain(`xlink:href="${href}"`);
    const reopened = await readOdf(bytes, context);
    const styles = reopened.sheets[0]!.unsupportedRecords?.find(r => r.kind === "Styles");
    const targets = odfChildren(styles?.data).flatMap(region => odfChildren(region).flatMap(style => odfChildren(style)
      .filter(n => odfObject(n)?.name === "HyperLink").map(n => odfAttributes(n).target)));
    expect(targets).toContain(target);
    // Force paragraph regeneration so retained ODF XML cannot hide a bad import.
    const edited = { ...reopened, sheets: reopened.sheets.map(s => ({ ...s,
      cells: s.cells.map(c => ({ ...c, value: { kind: "string" as const, value: "edited" } })) })) };
    const second = await createOdfWriter(profile)(edited, [], context);
    expect((await unpackOdf(second)).parts.get("content.xml")).toContain(`xlink:href="${href}"`);
  }
});

// Calc SID_JUMPTOMARK calls MakeRangeFromName, which recognizes the UI
// local-name spelling, not the Sheet.Name formula spelling.
it.each([
  ["Data", "Data!Total", "#Total%20(Data)"],
  ["O'Brien", "'O\\'Brien'!Total", "#Total%20(O'Brien)"],
  ["Data (Q1)", "'Data (Q1)'!Total", "#Total%20(Data%20(Q1))"],
  ["Path\\Rate%20", "'Path\\\\Rate%20'!Total", "#Total%20(Path%5CRate%2520)"]
])("exports a Calc-resolvable local-name hyperlink on %s", async (sheet, target, href) => {
  const input = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd">
    <g:Names><g:Name><g:name>Total</g:name><g:value>=S!$B$1</g:value></g:Name></g:Names>
    <g:Sheets><g:Sheet><g:Name>S</g:Name><g:Styles>
    <g:StyleRegion startRow="0" endRow="1" startCol="0" endCol="0"><g:Style><g:HyperLink type="GnmHLinkCurWB" target="${target}"/></g:Style></g:StyleRegion>
    </g:Styles><g:Cells><g:Cell Row="0" Col="0" ValueType="60">link</g:Cell><g:Cell Row="0" Col="1" ValueType="40">999</g:Cell></g:Cells></g:Sheet>
    <g:Sheet><g:Name>${sheet}</g:Name><g:Names><g:Name><g:name>Total</g:name><g:value>=$A$1</g:value></g:Name></g:Names>
    <g:Cells><g:Cell Row="0" Col="0" ValueType="40">7</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const original = await readGnumeric(new TextEncoder().encode(input), context);
  expect(original.names?.filter(n => n.name === "Total")).toHaveLength(2);
  for (const profile of ["strict", "extended"] as const) for (const regions of [true, false]) {
    const book = regions ? original : { ...original, sheets: original.sheets.map(s => ({ ...s, unsupportedRecords: [] })) };
    const bytes = await createOdfWriter(profile)(book, [], context);
    expect((await unpackOdf(bytes)).parts.get("content.xml")).toContain(`xlink:href="${href}"`);
    const reopened = await readOdf(bytes, context);
    expect(reopened.names).toContainEqual(expect.objectContaining({ name: "Total", sheet }));
    const styles = reopened.sheets[0]!.unsupportedRecords?.find(r => r.kind === "Styles");
    const targets = odfChildren(styles?.data).flatMap(region => odfChildren(region).flatMap(style => odfChildren(style)
      .filter(n => odfObject(n)?.name === "HyperLink").map(n => odfAttributes(n).target)));
    expect(targets).toContain(target);
    const edited = { ...reopened, sheets: reopened.sheets.map((s, index) => index ? s : { ...s,
      cells: s.cells.map(c => c.column ? c : { ...c, value: { kind: "string" as const, value: "edited" } }) }) };
    const second = await createOdfWriter(profile)(edited, [], context);
    expect((await unpackOdf(second)).parts.get("content.xml")).toContain(`xlink:href="${href}"`);
  }
});
