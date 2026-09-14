import { expect, it } from "vitest";
import { Volume } from "memfs";
import { editDocumentTables, type TableEditRequest } from "./table-edit.js";
import { getDocumentXml, inspectDocumentTable, openDocumentLocations, createDocxInspectionCommandEngine, getDocxDiscovery, parseDocxArguments } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const cell = (text: string, props = "") => `<w:tc><w:tcPr>${props}</w:tcPr>${text ? paragraph(text) : '<w:p/>'}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
const table = (...rows: string[]) => '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' + rows.join("") + '</w:tbl>';
const square = table(row(cell("North"), cell("East")), row(cell("South"), cell("West")));
async function edit(source: string | Uint8Array, operation: string, options: Record<string, unknown>) {
  const bytes = typeof source === "string" ? await textFixture(source) : source;
  const volume = Volume.fromJSON({ "/out": "" });
  try {
    const data = await editDocumentTables(bytes, { operation, options: { table: 1, output: "-", ...options } } as TableEditRequest, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(chunk) { volume.appendFileSync("/out", chunk); } }
    });
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    const xml = new TextDecoder().decode(await getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
    return { bytes: output, xml, data, details: (await inspectDocumentTable(output, { table: options.table as number ?? 1 }, textContext)).item.details };
  } catch (error) { expect(volume.readFileSync("/out")).toHaveLength(0); throw error; }
}

it("joins a rectangular span in row order and aliases all covered coordinates", async () => {
  const result = await edit(square, "tables.merge", { from: "A1", to: "B2", join: "paragraphs" });
  expect(result.details.cells).toMatchObject([{ row: 1, column: 1, rowSpan: 2, columnSpan: 2, text: "North\nEast\nSouth\nWest" }]);
  const document = await openDocumentLocations(result.bytes, textContext);
  expect(document.cell(document.at("table", 1).token, "B2").token).toBe(document.cell(document.at("table", 1).token, "A1").token);
  await expect(edit(result.bytes, "tables.set", { cell: "B2", text: "changed" })).rejects.toMatchObject({ code: "ambiguous-selection" });
  expect((await edit(result.bytes, "tables.set", { cell: "B2", text: "changed", covered: "owner" })).details.cells[0]!.text).toBe("changed");
});

it.each(["anchor", "paragraphs"])("splits into original grid slots with explicit %s distribution", async distribute => {
  const merged = await edit(square, "tables.merge", { from: "A1", to: "B2", join: "paragraphs" });
  const result = await edit(merged.bytes, "tables.split", { cell: "B2", rows: 2, cols: 2, distribute });
  expect(result.details.cells.map(c => c.text)).toEqual(distribute === "anchor" ? ["North\nEast\nSouth\nWest", "", "", ""] : ["North", "East", "South", "West"]);
  expect(result.xml).not.toContain('vMerge');
  expect(result.xml).not.toContain('gridSpan');
});

it("combines existing horizontal and vertical spans without dropping nested blocks", async () => {
  const nested = table(row(cell("Inner"), cell("Pair")));
  const source = table(row(cell("Top", '<w:vMerge w:val="restart"/>'), cell("Side")), row(cell("", '<w:vMerge/>'), cell("Bottom"))).replace(paragraph("Top"), nested + paragraph("Top"));
  const merged = await edit(source, "tables.merge", { from: "A1", to: "B2", join: "paragraphs" });
  expect(merged.xml).toContain(nested.slice('<w:tbl>'.length));
  const split = await edit(merged.bytes, "tables.split", { cell: "A1", rows: 2, cols: 2, distribute: "anchor" });
  expect(split.xml).toContain(nested.slice('<w:tbl>'.length));
  const horizontal = await edit(square, "tables.merge", { from: "A1", to: "B1", join: "paragraphs" });
  expect((await edit(horizontal.bytes, "tables.merge", { from: "A1", to: "B2", join: "paragraphs" })).details.cells).toHaveLength(1);
});

it.each([1, 2, 3])("deletes row %s through a vertical span retaining its owner content", async index => {
  const source = table(row(cell("Kept", '<w:vMerge w:val="restart"/>'), cell("First")), row(cell("", '<w:vMerge/>'), cell("Middle")), row(cell("", '<w:vMerge/>'), cell("Last")));
  const result = await edit(source, "tables.rows.remove", { index, join: "paragraphs" });
  expect(result.details).toMatchObject({ rows: 2, columns: 2 });
  expect(result.details.cells[0]).toMatchObject({ rowSpan: 2, text: "Kept" });
});

it.each([
  { from: "A1", to: "B2" }, { from: "B2", to: "A1", join: "paragraphs" },
  { from: "A1", to: "C2", join: "paragraphs" }, { from: "A1", to: "B2", join: "reject" }
])("rejects invalid merge rectangles and content policies: %j", async options => {
  await expect(edit(square, "tables.merge", options)).rejects.toThrow();
});

it("rejects partial overlaps, unsupported subdivisions and nonempty continuation loss", async () => {
  const merged = await edit(square, "tables.merge", { from: "A1", to: "B1", join: "paragraphs" });
  await expect(edit(merged.bytes, "tables.merge", { from: "B1", to: "B2", join: "paragraphs" })).rejects.toThrow();
  await expect(edit(merged.bytes, "tables.split", { cell: "A1", rows: 2, cols: 2, distribute: "anchor" })).rejects.toThrow();
  const source = table(row(cell("Owner", '<w:vMerge w:val="restart"/>'), cell("One")), row(cell("Hidden", '<w:vMerge/>'), cell("Two")));
  const removed = await edit(source, "tables.rows.remove", { index: 2, join: "paragraphs" });
  expect(removed.details.cells[0]!.text).toBe("Owner\nHidden");
});

it.each(['<w:vMerge/>', '<w:gridSpan w:val="3"/>', '<w:gridSpan w:val="2"/><w:gridSpan w:val="1"/>'])("rejects malformed merge markers before editing: %s", async props => {
  await expect(edit(table(row(cell("Bad", props), cell("Other"))), "tables.merge", { from: "A1", to: "B1", join: "paragraphs" })).rejects.toThrow();
});

it("routes direct merge flags through the same SDK with a structured dry-run result", async () => {
  const bytes = await textFixture(square), volume = Volume.fromJSON({ "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["tables", "merge", "-", "--table", "1", "--from", "A1", "--to", "B2", "--join", "paragraphs", "--dry-run", "--json"].map(s => new TextEncoder().encode(s)),
    cwd: "/", signal: textContext.signal, filesystem: { async readFile() { throw new Error("Unexpected file read"); } },
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: { async write(chunk) { volume.appendFileSync("/out", chunk); } }, stderr: { async write(chunk) { volume.appendFileSync("/err", chunk); } }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(volume.readFileSync("/out", "utf8") as string)).toMatchObject({ operation: "tables.merge", ok: true, affected: 1 });
});

it("advertises merge policies and the bounded edit capability", () => {
  const discover = (args: string[]) => getDocxDiscovery(parseDocxArguments(args.map(s => new TextEncoder().encode(s))))!;
  expect(discover(["schema", "tables", "merge"]).data).toMatchObject({ operations: [{ support: "edit" }] });
  expect(discover(["schema", "tables", "split"]).data).toMatchObject({ operations: [{ support: "edit" }] });
  expect(discover(["tables", "merge", "--help"]).human).toContain("row order");
  expect(discover(["tables", "merge", "--help"]).human).not.toContain("not implemented");
  expect(discover(["tables", "merge", "--help"]).human).not.toContain("--cell ");
  expect(discover(["tables", "merge", "--help"]).human).not.toContain("--all ");
  expect(discover(["tables", "split", "--help"]).human).not.toContain("--all ");
  expect(discover(["schema", "tables", "merge"]).data).toMatchObject({ operations: [{ featureIds: ["F20"], result: { oneOf: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ affected: { type: "integer", minimum: 0 } }) })]) } }] });
  expect(discover(["tables", "split", "--help"]).human).toContain("grid slots");
  expect(discover(["capabilities"]).data).toHaveProperty("features", expect.arrayContaining([expect.objectContaining({ id: "F20", level: "edit" })]));
});

it("rejects complex field movement across a partially selected rectangle", async () => {
  const source = square.replace(paragraph("North"), '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>').replace(paragraph("West"), '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  await expect(edit(source, "tables.merge", { from: "A1", to: "A2", join: "paragraphs" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects a covered option without an actual set effect", async () => {
  await expect(edit(square, "tables.set", { cell: "A1", covered: "owner" })).rejects.toThrow();
});

it("rejects duplicate span markers when reading a cell or inspecting a table", async () => {
  const bytes = await textFixture(table(row(cell("Invalid", '<w:gridSpan w:val="2"/><w:gridSpan w:val="1"/>'))));
  const document = await openDocumentLocations(bytes, textContext);
  expect(() => document.cell(document.at("table", 1).token, "B1")).toThrow();
  await expect(inspectDocumentTable(bytes, { table: 1 }, textContext)).rejects.toThrow();
});

it("preserves namespace-bound rich blocks, comments and empty formatted paragraphs", async () => {
  const block = '<w:p xmlns:e="urn:harbor"><w:r><w:rPr><w:b/></w:rPr><w:t>Rich</w:t></w:r><!--kept--></w:p><w:p><w:pPr><w:keepNext/></w:pPr></w:p>';
  const result = await edit(square.replace(paragraph("East"), block), "tables.merge", { from: "A1", to: "B1", join: "paragraphs" });
  expect(result.xml).toContain('xmlns:e="urn:harbor"');
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
  expect(result.xml).toContain('<!--kept-->');
  expect(result.xml).toContain('<w:pPr><w:keepNext/></w:pPr>');
});

it("merges a nested table independently and retains its outer neighbors", async () => {
  const source = table(row(cell("Host"), cell("Outside"))).replace(paragraph("Host"), square + '<w:p/>');
  const result = await edit(source, "tables.merge", { table: 2, from: "A1", to: "B2", join: "paragraphs" });
  expect(result.details.cells).toHaveLength(1);
  expect(result.xml).toContain(cell("Outside"));
});

it("preserves the strict dialect while merging and splitting a vertical span", async () => {
  const source = await textFixture(square, {}, true);
  const merged = await edit(source, "tables.merge", { from: "A1", to: "A2", join: "paragraphs" });
  expect(merged.details.cells[0]).toMatchObject({ rowSpan: 2, columnSpan: 1, text: "North\nSouth" });
  const split = await edit(merged.bytes, "tables.split", { cell: "A1", rows: 2, cols: 1, distribute: "paragraphs" });
  expect(split.details.cells.map(c => c.text)).toEqual(["North", "East", "South", "West"]);
  expect(split.xml).not.toContain('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
});

it("splits into equal rectangular subspans without changing the stored grid", async () => {
  const merged = await edit(square, "tables.merge", { from: "A1", to: "B2", join: "paragraphs" });
  const split = await edit(merged.bytes, "tables.split", { cell: "A1", rows: 1, cols: 2, distribute: "anchor" });
  expect(split.details).toMatchObject({ rows: 2, columns: 2, cells: [
    { rowSpan: 2, columnSpan: 1, text: "North\nEast\nSouth\nWest" }, { rowSpan: 2, columnSpan: 1, text: "" }
  ] });
  const horizontal = await edit(merged.bytes, "tables.split", { cell: "A1", rows: 2, cols: 1, distribute: "anchor" });
  expect(horizontal.details.cells.map(c => [c.rowSpan, c.columnSpan])).toEqual([[1, 2], [1, 2]]);
});

it("combines defined cell widths when the table grid has no stored widths", async () => {
  const source = square.split('<w:gridCol w:w="1000"/>').join('<w:gridCol/>').split('<w:tcPr>').join('<w:tcPr><w:tcW w:w="1000" w:type="dxa"/>');
  const merged = await edit(source, "tables.merge", { from: "A1", to: "B1", join: "paragraphs" });
  expect(merged.xml).toContain('m:w="2000"');
});
