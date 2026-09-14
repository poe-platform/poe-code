import { expect, it } from "vitest";
import { Volume } from "memfs";
import { editDocumentTables, type TableEditRequest } from "./table-edit.js";
import { getDocumentXml, openDocumentLocations, parseDocumentXml } from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
const cell = (value: string) => `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:shd w:fill="F0F0F0"/></w:tcPr>${paragraph(value)}</w:tc>`;
const row = (a: string, b: string, header = false) => `<w:tr><w:trPr>${header ? '<w:tblHeader/>' : ''}<w:cantSplit/></w:trPr>${cell(a)}${cell(b)}</w:tr>`;
const table = (rows = row("A", "B", true) + row("C", "D")) => `<w:tbl><w:tblPr><!--keep--><w:tblW w:w="2000" w:type="dxa"/><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>${rows}</w:tbl>`;
async function edit(body: string, operation: TableEditRequest["operation"], options: Record<string, unknown>) {
  const input = await textFixture(body);
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await editDocumentTables(input, { operation, options: { table: 1, output: "-", ...options } } as TableEditRequest, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const xml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { data, xml, bytes, table: parseDocumentXml(new TextEncoder().encode(xml)).root.children[0]!.children[0]! };
}
it("replaces selected cell value exactly while preserving neighboring lexical cells and bookmarks", async () => {
  const marked = '<w:bookmarkStart w:id="8" w:name="Dock"/><w:r><w:t>Old</w:t></w:r><w:bookmarkEnd w:id="8"/>';
  const source = table().replace('<w:r><w:t>A</w:t></w:r>', marked);
  const result = await edit(source, "tables.set", { cell: "A1", text: "  =7+2\t海\nZ  " });
  expect(result.xml).toContain(cell("B"));
  expect(result.xml).toContain(row("C", "D"));
  expect(result.xml).toContain('<w:bookmarkStart w:id="8" w:name="Dock"/>');
  expect(result.xml).toContain('<w:bookmarkEnd w:id="8"/>');
  expect(result.xml).toContain('xml:space="preserve">  =7+2');
  expect(result.data.changes[0]!.kind).toBe("replace");
});
it("inserts blank rows and columns at explicit one-based positions retaining original cells", async () => {
  const rows = await edit(table(), "tables.rows.add", { index: 2 });
  expect(rows.table.children.filter(n => n.localName === "tr")).toHaveLength(3);
  expect(rows.xml).toContain(row("A", "B", true));
  expect(rows.xml).toContain(row("C", "D"));
  const columns = await edit(table(), "tables.columns.add", { index: 1, width: { value: 25, unit: "pt" } });
  expect(columns.table.children.find(n => n.localName === "tblGrid")!.children).toHaveLength(3);
  expect(columns.xml).toContain(cell("A"));
  expect(columns.xml).toContain(cell("D"));
  const locations = await openDocumentLocations(columns.bytes, textContext);
  expect(locations.cell(locations.at("table", 1).token, "B1").kind).toBe("cell");
});
it("removes only the selected row or column", async () => {
  const removed = await edit(table(), "tables.rows.remove", { index: 1 });
  expect(removed.xml).toContain(row("C", "D"));
  expect(removed.xml).not.toContain(cell("A"));
  expect(removed.data.changes[0]!.kind).toBe("delete");
  const columns = await edit(table(), "tables.columns.remove", { index: 2 });
  expect(columns.xml).toContain(cell("A"));
  expect(columns.xml).not.toContain(cell("B"));
});
it("formats selected rows and cells without changing text or table borders", async () => {
  const result = await edit(table(), "tables.set", { cell: "A2", allowRowSplit: true, width: { value: 45, unit: "pt" }, cellMargin: { value: 1, unit: "pt" } });
  expect(result.xml).toContain(row("A", "B", true));
  expect(result.xml).toContain(paragraph("C"));
  expect(result.xml).toContain('<w:tblBorders><w:top w:val="single"/></w:tblBorders>');
  expect(result.data.changes[0]!.kind).toBe("format");
});
it.each([
  ["tables.rows.add", { index: 4 }], ["tables.columns.remove", { index: 3 }],
  ["tables.set", { cell: "A3", text: "bad" }], ["tables.set", { cell: "A1", repeatHeader: false }]
] as const)("rejects invalid indices and nonconsecutive headers before publication: %s", async (operation, options) => {
  const input = await textFixture(table(row("A", "B", true) + row("C", "D", true)));
  let published = false;
  await expect(editDocumentTables(input, { operation, options: { table: 1, output: "-", ...options } } as TableEditRequest, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { published = true; } } })).rejects.toThrow();
  expect(published).toBe(false);
});
it.each(['<w:fldSimple w:instr="DATE"><w:r><w:t>today</w:t></w:r></w:fldSimple>', table(row("inner", "value"))])("rejects destructive replacement of fields or nested tables", async content => {
  await expect(edit(table().replace(paragraph("A"), paragraph("") + content + '<w:p/>'), "tables.set", { cell: "A1", text: "new" })).rejects.toThrow();
});
it("preserves fields and nested tables during formatting", async () => {
  const content = '<w:fldSimple w:instr="DATE"><w:r><w:t>today</w:t></w:r></w:fldSimple>';
  const nested = table(row("inner", "value"));
  const result = await edit(table().replace(paragraph("A"), `<w:p>${content}</w:p>` + nested + '<w:p/>'), "tables.set", { cell: "A1", width: { value: 50, unit: "pt" } });
  expect(result.xml).toContain(content);
  expect(result.xml).toContain(nested);
});
it("assigns multiline text to a multi-paragraph cell without extra old paragraphs", async () => {
  const result = await edit(table().replace(paragraph("A"), paragraph("old one") + paragraph("old two")), "tables.set", { cell: "A1", text: "north\nsouth" });
  const paragraphs = result.table.children.find(n => n.localName === "tr")!.children.find(n => n.localName === "tc")!.children.filter(n => n.localName === "p");
  expect(paragraphs).toHaveLength(1);
  expect(result.xml).not.toContain('old two');
});
it("rejects deleting cross-cell bookmarks and merged structural edits", async () => {
  const marked = table().replace(paragraph("A"), '<w:p><w:bookmarkStart w:id="9" w:name="Across"/></w:p>').replace(paragraph("B"), '<w:p><w:bookmarkEnd w:id="9"/></w:p>');
  await expect(edit(marked, "tables.columns.remove", { index: 1 })).rejects.toThrow("range markers");
  const merged = table(row("A", "B")).replace(cell("A") + cell("B"), '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' + paragraph("joined") + '</w:tc>');
  await expect(edit(merged, "tables.rows.add", {})).rejects.toThrow("unmerged");
  const result = await edit(merged, "tables.set", { cell: "B1", text: "anchor" });
  expect(result.xml).toContain('<w:gridSpan w:val="2"/>');
  expect(result.xml).toContain('>anchor<');
});
it("preserves the exact selected cell value after a formatting-only edit", async () => {
  const value = '  001 =8+4 海 &amp; trail  ';
  const result = await edit(table(row(value, "other")), "tables.set", { cell: "A1", cellMargin: { value: 2, unit: "pt" } });
  expect(result.xml).toContain(paragraph(value));
});
it("derives an omitted column width from explicit container geometry", async () => {
  const source = table() + '<w:sectPr><w:pgSz w:w="10000" w:h="15000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>';
  const result = await edit(source, "tables.columns.add", {});
  const columns = result.table.children.find(n => n.localName === "tblGrid")!.children;
  expect(columns.at(-1)!.attributes.find(a => a.localName === "w")!.value).toBe("3000");
  expect(result.xml).toContain(cell("A"));
});
it("retains colliding extension namespace attributes during property updates", async () => {
  const result = await edit(table().replace('<w:tblW w:w="2000" w:type="dxa"/>', '<w:tblW xmlns:te="http://schemas.openxmlformats.org/officeDocument/2006/relationships" te:stamp="retained" w:w="2000" w:type="dxa"/>'), "tables.set", { width: { value: 120, unit: "pt" } });
  const property = result.table.children.find(n => n.localName === "tblPr")!.children.find(n => n.localName === "tblW")!;
  expect(property.attributes.find(a => a.namespace === "http://schemas.openxmlformats.org/officeDocument/2006/relationships" && a.localName === "stamp")?.value).toBe("retained");
});
it("returns the selected cell after adding missing row properties", async () => {
  const result = await edit(table('<w:tr>' + cell("A") + cell("B") + '</w:tr>'), "tables.set", { cell: "B1", repeatHeader: true });
  const locations = await openDocumentLocations(result.bytes, textContext);
  expect(result.data.changes[0]!.after.value.path).toEqual(locations.cell(locations.at("table", 1).token, "B1").value.path);
});
it("rejects structural edits when rows contain wrapped cells", async () => {
  const source = table('<w:tr>' + cell("A") + cell("B") + '<w:sdt><w:sdtContent>' + cell("extra") + '</w:sdtContent></w:sdt></w:tr>');
  await expect(edit(source, "tables.columns.add", { width: { value: 20, unit: "pt" } })).rejects.toThrow("rectangular");
});
it("reports unchanged when a selected direct width already matches", async () => {
  const result = await edit(table(), "tables.set", { cell: "A1", width: { value: 50, unit: "pt" } });
  expect(result.data.changed).toBe(false);
});
it("edits a nested table selected by its document ordinal", async () => {
  const inner = table(row("inside", "neighbor"));
  const source = table().replace(paragraph("A"), inner + '<w:p/>');
  const result = await edit(source, "tables.set", { table: 2, cell: "A1", text: "changed" });
  expect(result.xml).toContain(cell("neighbor"));
  expect(result.xml).toContain(cell("B"));
  expect(result.xml).toContain('>changed<');
  expect(result.xml).not.toContain('>inside<');
});
it("sets false flags and clears nullable table properties without changing values", async () => {
  const source = table().replace('<!--keep-->', '<w:bidiVisual/><w:jc w:val="center"/>');
  const result = await edit(source, "tables.set", { direction: null, alignment: null, autofit: false, repeatHeader: false, allowRowSplit: false, cellMargin: { value: 0, unit: "pt" } });
  const props = result.table.children.find(n => n.localName === "tblPr")!;
  expect(props.children.some(n => ["bidiVisual", "jc"].includes(n.localName))).toBe(false);
  expect(props.children.find(n => n.localName === "tblLayout")!.attributes.find(a => a.localName === "type")?.value).toBe("fixed");
  expect(props.children.find(n => n.localName === "tblCellMar")!.children.every(n => n.attributes.some(a => a.localName === "w" && a.value === "0"))).toBe(true);
  expect(result.xml).toContain(cell("A"));
  expect(result.xml).toContain(cell("D"));
});
it("edits header table cells without modifying body table values", async () => {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const input = await textFixture(table() + '<w:sectPr><w:headerReference w:type="default" r:id="header1"/></w:sectPr>', { header1: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${table(row("heading", "other"))}</w:hdr>` } });
  const volume = Volume.fromJSON({ "/out": "" });
  await editDocumentTables(input, { operation: "tables.set", options: { scope: "headers", table: 1, cell: "A1", text: "updated", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const headerXml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/header1.xml", raw: true }) as Uint8Array);
  const bodyXml = new TextDecoder().decode(await getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  expect(headerXml).toContain('>updated<');
  expect(headerXml).toContain(cell("other"));
  expect(bodyXml).toContain(table());
});
it.each(["tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove"] as const)("reports missing-selection for an absent positive structural index: %s", async operation => {
  const input = await textFixture(table());
  await expect(editDocumentTables(input, { operation, options: { table: 1, index: 4, dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "missing-selection" });
});
it("rejects cell value replacement inside a complex field spanning adjacent cells", async () => {
  const source = table(row("start", "cached") + row("end", "outside")).replace(paragraph("start"), '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> MERGEFIELD Harbor </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>').replace(paragraph("end"), '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  const input = await textFixture(source);
  await expect(editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "B1", text: "new", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
  const result = await edit(source, "tables.set", { cell: "B1", width: { value: 60, unit: "pt" } });
  expect(result.xml).toContain(paragraph("cached"));
});
it("rejects cell value replacement inside a complex field beginning before its table", async () => {
  const source = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> MERGEFIELD Dock </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p>' + table() + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const input = await textFixture(source);
  await expect(editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: "new", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});
