import { expect, it } from "vitest";
import { readGnumeric } from "./gnumeric.js";
import { createOdfWriter, readOdf } from "./odf.js";
import { context, unpackOdf } from "./odf-write.test.js";
import { odfAttributes, odfChildren, odfObject } from "./odf-write-support.js";

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
