import { expect, it } from "vitest";
import * as docx from "./index.js";
import { paragraph, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

it("inspects merged anchors, omitted slots and exact nested cell text", async () => {
  const body = '<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr>' + paragraph("  海 é 🌊  ") + '</w:tc><w:tc>' + paragraph("Label") + '</w:tc></w:tr>' +
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>' + table([paragraph("Nested")]) + '<w:p/></w:tc></w:tr>' +
    '<w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr><w:tc>' + paragraph("Middle") + '</w:tc></w:tr></w:tbl>';
  const bytes = await textFixture(body);
  const data = (await docx.inspectDocumentTable(bytes, { table: 1 }, textContext)).item.details;
  expect(data).toMatchObject({ kind: "tables", rows: 3, columns: 3, omitted: [{ row: 1, before: 0, after: 0 }, { row: 2, before: 0, after: 0 }, { row: 3, before: 1, after: 1 }] });
  expect(data.cells.map(({ row, column, rowSpan, columnSpan, text }) => ({ row, column, rowSpan, columnSpan, text }))).toEqual([
    { row: 1, column: 1, rowSpan: 2, columnSpan: 2, text: "  海 é 🌊  " },
    { row: 1, column: 3, rowSpan: 1, columnSpan: 1, text: "Label" },
    { row: 2, column: 3, rowSpan: 1, columnSpan: 1, text: "Nested\n" },
    { row: 3, column: 2, rowSpan: 1, columnSpan: 1, text: "Middle" }
  ]);
  const document = await docx.openDocumentLocations(bytes, textContext);
  expect(data.cells[0]!.location.token).toBe(document.cell(document.at("table", 1).token, "B2").token);
});

it("rejects ambiguous, stale and missing table anchors", async () => {
  const bytes = await textFixture(table([paragraph("One")]) + table([paragraph("Two")]));
  await expect(docx.inspectDocumentTable(bytes, { table: 3 }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  const old = await docx.openDocumentLocations(await textFixture(table([paragraph("Old")])), textContext);
  await expect(docx.inspectDocumentTable(bytes, { select: old.at("table", 1).token }, textContext)).rejects.toMatchObject({ code: "stale-selection" });
});

it("discovers table read/edit schemas and documents structural indexing", () => {
  const parse = (words: string[]) => docx.parseDocxArguments(words.map(word => new TextEncoder().encode(word)));
  for (const operation of ["tables.get", "tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove"]) {
    expect(docx.getDocxDiscovery(parse(["schema", ...operation.split(".")]))!.data).toMatchObject({ operations: [{ support: operation === "tables.get" ? "read" : "edit" }] });
  }
  const help = docx.getDocxDiscovery(parse(["tables", "rows", "add", "--help"]))!.human;
  expect(help).toContain("count+1");
  expect(help).not.toContain("--image ");
  expect(help).not.toContain("--all ");
  expect(docx.getDocxDiscovery(parse(["tables", "rows", "remove", "--help"]))!.human).not.toContain("--all ");
  expect(docx.getDocxDiscovery(parse(["capabilities"]))!.data).toHaveProperty("features", expect.arrayContaining([expect.objectContaining({ id: "F20", level: "edit" })]));
});

it("reads header table coordinates and cached fields without crossing into body tables", async () => {
  const body = table([paragraph("Body")]) + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>';
  const bytes = await textFixture(body, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}">` + table(['<w:p><w:bookmarkStart w:id="4" w:name="Harbor"/><w:fldSimple w:instr="PAGE"><w:r><w:t>004</w:t></w:r></w:fldSimple><w:bookmarkEnd w:id="4"/></w:p>']) + '</w:hdr>' } });
  const data = await docx.inspectDocumentTable(bytes, { table: 1, scope: "headers" }, textContext);
  expect(data.item.details.cells.map(cell => cell.text)).toEqual(["004"]);
  expect(data.item.location.value.part).toBe("/word/header.xml");
});

it("accepts a table location for row insertion instead of treating it as a story insertion", async () => {
  const document = await docx.openDocumentLocations(await textFixture(table([paragraph("Anchor")])), textContext);
  const anchor = document.at("table", 1);
  expect(docx.resolveDocxSelection(document, { operation: "tables.rows.add", inputs: ["document"], options: { select: anchor.token, dryRun: true } })).toEqual([anchor]);
});

it("validates omitted grid counts even when no physical cell is present", async () => {
  const bytes = await textFixture('<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="1e0"/><w:gridAfter w:val="1"/></w:trPr></w:tr></w:tbl>');
  await expect(docx.inspectDocumentTable(bytes, { table: 1 }, textContext)).rejects.toMatchObject({ code: "invalid-package" });
});
