import { expect, it } from "vitest";
import { inspectDocumentTable, openDocumentLocations } from "./index.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

const alternate = (content: string, fallback: string) =>
  `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:req="${w}" Requires="req">${content}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const grid = '<w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>';
const cell = `<w:tc>${paragraph("  007 海  ")}</w:tc>`;

it("inspects the active table grid without fabricating fallback columns", async () => {
  const bytes = await textFixture(`<w:tbl>${alternate(grid, '<w:tblGrid><w:gridCol/></w:tblGrid>')}<w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr>${paragraph("Owner")}</w:tc></w:tr></w:tbl>`);
  const details = (await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
  expect(details).toMatchObject({ rows: 1, columns: 3, cells: [{ columnSpan: 3, text: "Owner" }] });
  const document = await openDocumentLocations(bytes, textContext);
  expect(details.cells[0]!.location.token).toBe(document.cell(document.at("table", 1).token, "C1").token);
});

it.each(["properties", "before", "after"])("inspects active omitted slots wrapped at %s", async position => {
  const before = '<w:gridBefore w:val="1"/>';
  const after = '<w:gridAfter w:val="1"/>';
  const props = position === "properties" ? alternate(`<w:trPr>${before}${after}</w:trPr>`, '<w:trPr/>') :
    `<w:trPr>${position === "before" ? alternate(before, '<w:gridBefore w:val="0"/>') : before}${position === "after" ? alternate(after, '<w:gridAfter w:val="0"/>') : after}</w:trPr>`;
  const bytes = await textFixture(`<w:tbl>${grid}<w:tr>${props}${cell}</w:tr></w:tbl>`);
  const details = (await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
  expect(details.omitted).toEqual([{ row: 1, before: 1, after: 1 }]);
  expect(details.cells).toMatchObject([{ row: 1, column: 2, columnSpan: 1, text: "  007 海  " }]);
  expect(details.cells).toHaveLength(1);
});

it("uses the selected fallback grid when a choice namespace is unsupported", async () => {
  const body = `<w:tbl>${alternate('<w:tblGrid><w:gridCol/></w:tblGrid>', grid).replace(`xmlns:req="${w}"`, 'xmlns:req="urn:unavailable-grid"')}<w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr>${cell}</w:tr></w:tbl>`;
  const details = (await inspectDocumentTable(await textFixture(body), { table: 1 }, textContext)).item.details;
  expect(details.columns).toBe(3);
  expect(details.cells.map(item => [item.column, item.text])).toEqual([[2, "  007 海  "]]);
});

it("counts selected column declarations inside an otherwise direct grid", async () => {
  const bytes = await textFixture(`<w:tbl><w:tblGrid>${alternate('<w:gridCol/><w:gridCol/><w:gridCol/>', '<w:gridCol/>')}</w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr>${cell}</w:tr></w:tbl>`);
  const details = (await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
  expect(details).toMatchObject({ columns: 3, omitted: [{ before: 1, after: 1 }], cells: [{ column: 2 }] });
});

it("resolves an active grid under a renamed word namespace", async () => {
  const body = `<w:tbl xmlns:q="${w}">${alternate(grid, '<w:tblGrid/>')}<w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr>${cell}</w:tr></w:tbl>`;
  const details = (await inspectDocumentTable(await textFixture(body.split('w:').join('q:')), { table: 1 }, textContext)).item.details;
  expect(details).toMatchObject({ columns: 3, cells: [{ column: 2, text: "  007 海  " }] });
});

it.each([0, 1, 3].flatMap(before => [0, 1, 2].flatMap(after => [1, 2, 4].map(span => ({ before, after, span })))))(
  "keeps omitted slots distinct from all aliases of span $span with before $before and after $after",
  async ({ before, after, span }) => {
    const columns = before + span + after;
    const props = `<w:trPr><w:gridBefore w:val="${before}"/><w:gridAfter w:val="${after}"/></w:trPr>`;
    const owner = `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/><w:vMerge w:val="restart"/></w:tcPr>${paragraph("  007 海  ")}</w:tc>`;
    const continuation = `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/><w:vMerge/></w:tcPr><w:p/></w:tc>`;
    const bytes = await textFixture(`<w:tbl><w:tblGrid>${'<w:gridCol/>'.repeat(columns)}</w:tblGrid><w:tr>${props}${owner}</w:tr><w:tr>${props}${continuation}</w:tr></w:tbl>`);
    const saved = bytes.slice();
    const details = (await inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
    expect(details.omitted).toEqual([{ row: 1, before, after }, { row: 2, before, after }]);
    expect(details.cells).toMatchObject([{ row: 1, column: before + 1, rowSpan: 2, columnSpan: span, text: "  007 海  " }]);
    expect(details.cells).toHaveLength(1);
    const document = await openDocumentLocations(bytes, textContext);
    const table = document.at("table", 1);
    for (const row of [1, 2]) for (let column = 1; column <= columns; column++) {
      const coordinate = String.fromCharCode(64 + column) + row;
      if (column <= before || column > before + span) expect(() => document.cell(table.token, coordinate)).toThrow(expect.objectContaining({ code: "missing-selection" }));
      else expect(document.cell(table.token, coordinate).token).toBe(details.cells[0]!.location.token);
    }
    expect(bytes).toEqual(saved);
  }
);
