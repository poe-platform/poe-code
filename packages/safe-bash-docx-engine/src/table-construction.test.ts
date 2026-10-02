import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const children = (node: Node, tag?: string): Node[] => node.children.filter((n): n is Node => typeof n !== "string" && (!tag || n.name.endsWith("}" + tag)));
const child = (node: Node, tag: string) => children(node, tag)[0]!;
const attr = (node: Node, name: string) => Object.entries(node.attributes).find(([key]) => key.endsWith("}" + name))?.[1];
const length = (value: number) => ({ value, unit: "pt" as const });
async function add(body: string, options: Record<string, unknown> = {}) {
  const input = await textFixture(body);
  const volume = Volume.fromJSON({ "/out": "" });
  const result = await docx.editDocumentTables(input, { operation: "tables.add", options: { rows: 2, cols: 2, output: "-", ...options } } as docx.TableConstructionRequest, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const parts = readPackage(bytes);
  return { result, bytes, xml: new TextDecoder().decode(parts.get("word/document.xml")), body: child(child(xmlStructure(parts.get("word/document.xml")!), "document"), "body") };
}

it.each([true, false])("constructs an independently checked grid with autofit %s and empty cells", async autofit => {
  const section = '<w:sectPr><!--retain geometry--><w:pgSz w:w="8000" w:h="12000"/><w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000"/><w:docGrid w:linePitch="360"/></w:sectPr>';
  const out = await add(paragraph("Coastal observations") + section, { autofit, columnWidths: [length(100), length(200)], repeatHeader: true, allowRowSplit: false, rowHeight: length(12), heightRule: { enum: "WD_ROW_HEIGHT_RULE", name: "EXACTLY" }, cellMargin: length(2), borders: { insideV: { style: "single", width: length(1), color: "123abc" } }, shading: { fill: "aabbcc", pattern: "clear" } });
  expect(out.xml).toContain(section);
  expect(children(out.body).map(n => n.name.split("}")[1])).toEqual(["p", "tbl", "sectPr"]);
  const table = child(out.body, "tbl"), props = child(table, "tblPr");
  expect(attr(child(props, "tblLayout"), "type")).toBe(autofit ? "autofit" : "fixed");
  expect(attr(child(props, "tblW"), "w")).toBe("6000");
  expect(children(child(table, "tblGrid")).map(n => attr(n, "w"))).toEqual(["2000", "4000"]);
  expect(attr(child(props, "shd"), "fill")).toBe("AABBCC");
  expect(attr(child(child(props, "tblBorders"), "insideV"), "sz")).toBe("8");
  expect(children(child(props, "tblCellMar")).map(n => attr(n, "w"))).toEqual(["40", "40", "40", "40"]);
  for (const [index, row] of children(table, "tr").entries()) {
    const rowProps = child(row, "trPr");
    expect(children(rowProps, "tblHeader")).toHaveLength(index === 0 ? 1 : 0);
    expect(attr(child(rowProps, "cantSplit"), "val")).toBe("1");
    expect(attr(child(rowProps, "trHeight"), "val")).toBe("240");
    expect(attr(child(rowProps, "trHeight"), "hRule")).toBe("exact");
    expect(children(row, "tc").map(cell => attr(child(child(cell, "tcPr"), "tcW"), "w"))).toEqual(["2000", "4000"]);
    for (const cell of children(row, "tc")) expect(children(cell, "p")).toHaveLength(1);
  }
  expect(out.result.changes[0]?.after.kind).toBe("table");
});

it("inserts nested typed blocks at a Unicode caret and retains section data on the suffix", async () => {
  const section = '<w:sectPr><w:pgSz w:w="9000" w:h="12000"/><w:pgMar w:left="1000" w:right="1000"/></w:sectPr>';
  const body = '<w:p><w:pPr><w:keepNext/>' + section + '</w:pPr>' + run("海🌊 shore") + '</w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const select = document.range(document.at("paragraph", 1).token, 2, 2).token;
  const out = await add(body, { rows: 1, cols: 1, select, content: { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [{ kind: "paragraph", level: 1, text: "測定 é" }, { kind: "table", rows: [[{ blocks: [] }]] }] }]] }] } });
  expect(children(out.body).map(n => n.name.split("}")[1])).toEqual(["p", "tbl", "p"]);
  const cell = child(child(child(out.body, "tbl"), "tr"), "tc");
  expect(children(cell).map(n => n.name.split("}")[1])).toEqual(["tcPr", "p", "tbl", "p"]);
  expect(out.xml.split(section)).toHaveLength(2);
  expect(children(child(children(out.body, "p")[0]!, "pPr"), "sectPr")).toHaveLength(0);
  expect(child(child(children(out.body, "p")[1]!, "pPr"), "sectPr")).toBeDefined();
  expect((await docx.extractDocumentText(out.bytes, textContext)).text).toContain("測定 é");
  expect((await docx.inspectDocumentStyles(out.bytes, {}, textContext)).styles.some(s => s.name === "Heading 1")).toBe(true);
});

it("charges aggregate cells across nested and sibling tables during structured creation", async () => {
  const table = { kind: "table", rows: [[{ blocks: [] }]] } as const;
  await expect(docx.createDocumentArchive({ content: { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [table] }]] }, table] } }, { ...textContext, budget: new docx.DocumentBudget({ tableCells: 2 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it.each([
  { style: "" }, { columnWidths: [length(100)] }, { columnWidths: [length(100), length(100)], width: length(300) },
  { headerRows: 3 }, { rowHeight: length(-1) }, { heightRule: { enum: "WD_ROW_HEIGHT_RULE", name: "EXACTLY" } },
  { content: { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [] }]] }] } },
  { content: { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [] }, { blocks: [{ kind: "paragraph", text: "bad\u0001" }] }], [{ blocks: [] }, { blocks: [] }]] }] } }
])("rejects the complete invalid request before publishing: %j", async options => {
  const volume = Volume.fromJSON({ "/out": "unchanged" });
  const input = await textFixture(paragraph("Keep"));
  await expect(docx.editDocumentTables(input, { operation: "tables.add", options: { rows: 2, cols: 2, output: "-", ...options } } as docx.TableConstructionRequest, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  })).rejects.toMatchObject({ code: "usage" });
  expect(volume.readFileSync("/out", "utf8")).toBe("unchanged");
});


it("publishes table schemas and limits help to applicable insertion options", () => {
  const args = (words: string[]) => docx.parseDocxArguments(words.map(w => new TextEncoder().encode(w)));
  const options = args(["tables", "add", "document", "--rows", "1", "--cols", "2", "--column-widths-json", '[{"value":1,"unit":"in"},{"value":2,"unit":"in"}]', "--dry-run"]).options;
  expect(options.columnWidths).toEqual([{ value: 1, unit: "in" }, { value: 2, unit: "in" }]);
  expect(docx.getDocxDiscovery(args(["schema", "tables", "add"]))?.data).toMatchObject({ operations: [{ support: "edit" }] });
  const help = docx.getDocxDiscovery(args(["tables", "add", "--help"]))!.human;
  expect(help).toContain("--column-widths-json");
  expect(help).not.toContain("--image ");
  expect(help).not.toContain("--all ");
  const schema = docx.docxValueSchema("OriginalDocumentContentV1");
  expect(schema.$defs?.Block?.oneOf?.[1]?.properties?.rowOptions).toBeDefined();
  expect(schema.$defs?.CellInput?.properties?.margins).toBeDefined();
});


it.each(["strict", "transitional"] as const)("creates formatted nested content in %s using independent XML assertions", async dialect => {
  const border = { style: "double", width: length(1.5), color: "112233" } as const;
  const nested: docx.DocxTableInput = { kind: "table", autofit: false, columnWidths: [length(40), length(60)], rows: [[{ blocks: [] }, { blocks: [{ kind: "paragraph", runs: [{ text: "שלום 海 é 🌊", bold: false }] }] }]] };
  const table: docx.DocxTableInput = { kind: "table", width: length(200), cellMargin: length(4), headerRows: 2, rowOptions: [{ allowRowSplit: true, heightRule: { enum: "WD_ROW_HEIGHT_RULE", name: "AUTO" } }, { height: length(10), heightRule: { enum: "WD_ROW_HEIGHT_RULE", name: "AT_LEAST" } }, { height: length(14) }],
    borders: { top: border, left: border, bottom: border, right: border, insideH: border, insideV: border },
    rows: [[{ blocks: [], margins: { left: length(0) }, borders: { bottom: border }, shading: { fill: "abcdef", color: "010203", pattern: "pct25" } }], [{ blocks: [{ kind: "paragraph", text: "Header two" }] }], [{ blocks: [nested] }]] };
  const archive = await docx.createDocumentArchive({ dialect, content: { version: 1, blocks: [table] } }, textContext);
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.writeDocumentArchive(archive, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, { order: "input", compression: "store" }, textContext);
  const body = child(child(xmlStructure(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)).get("word/document.xml")!), "document"), "body");
  const tree = child(body, "tbl"), rows = children(tree, "tr");
  expect(rows.map(row => children(child(row, "trPr"), "tblHeader").length)).toEqual([1, 1, 0]);
  expect(rows.map(row => attr(child(child(row, "trPr"), "trHeight"), "hRule"))).toEqual(["auto", "atLeast", "atLeast"]);
  expect(attr(child(child(rows[0]!, "trPr"), "cantSplit"), "val")).toBe("0");
  const props = child(child(rows[0]!, "tc"), "tcPr");
  expect(attr(child(child(props, "tcMar"), dialect === "strict" ? "start" : "left"), "w")).toBe("0");
  expect(attr(child(props, "shd"), "val")).toBe("pct25");
  expect(children(child(child(tree, "tblPr"), "tblBorders")).map(n => n.name.split("}")[1])).toEqual(["top", dialect === "strict" ? "start" : "left", "bottom", dialect === "strict" ? "end" : "right", "insideH", "insideV"]);
  const inner = child(child(rows[2]!, "tc"), "tbl");
  expect(children(child(inner, "tblGrid")).map(n => attr(n, "w"))).toEqual(["800", "1200"]);
  expect(children(child(rows[2]!, "tc")).at(-1)?.name.endsWith("}p")).toBe(true);
});

it.each([
  { rows: [[{ blocks: [] }], [{ blocks: [] }]], rowOptions: [{ repeatHeader: false }, { repeatHeader: true }] },
  { rows: [[{ blocks: [] }]], rowOptions: [] },
  { rows: [[{ blocks: [] }]], repeatHeader: true, headerRows: 1 },
  { rows: [[{ blocks: [] }]], cellMargin: length(500) },
  { rows: [[{ blocks: [] }]], borders: { top: { style: "single", width: length(13), color: "abcdef" } } },
  { rows: [[{ blocks: [] }]], columnWidths: [length(0)] },
  { rows: [[{ blocks: [] }]], autofit: null }
])("rejects invalid typed table formatting before archive creation: %j", async options => {
  await expect(docx.createDocumentArchive({ content: { version: 1, blocks: [{ kind: "table", ...options }] } } as Parameters<typeof docx.createDocumentArchive>[0], textContext)).rejects.toMatchObject({ code: "usage" });
});

it("uses the next section width only when inserting after a section boundary", async () => {
  const first = '<w:sectPr><w:pgSz w:w="8000" w:h="12000"/><w:pgMar w:left="1000" w:right="1000"/></w:sectPr>';
  const last = '<w:sectPr><w:pgSz w:w="10000" w:h="12000"/><w:pgMar w:left="1000" w:right="1000"/></w:sectPr>';
  const body = '<w:p><w:pPr>' + first + '</w:pPr>' + run("Boundary") + '</w:p>' + paragraph("Next") + last;
  for (const before of [true, false]) {
    const out = await add(body, { paragraph: 1, before, rows: 1, cols: 1 });
    expect(attr(child(child(child(out.body, "tbl"), "tblPr"), "tblW"), "w")).toBe(before ? "6000" : "8000");
    expect(out.xml).toContain(first); expect(out.xml).toContain(last);
  }
});


it("enforces the aggregate inserted-cell limit at its exact boundary before output", async () => {
  const input = await textFixture(paragraph("Keep source"));
  const content = { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [{ kind: "table", rows: [[{ blocks: [] }]] }] }]] }] } as const;
  for (const limit of [1, 2]) {
    const volume = Volume.fromJSON({ "/out": "" });
    const operation = docx.editDocumentTables(input, { operation: "tables.add", options: { rows: 1, cols: 1, content, output: "-", limit: [{ name: "tableCells", value: limit }] } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
    });
    if (limit === 1) { await expect(operation).rejects.toMatchObject({ code: "limit-exceeded" }); expect(volume.readFileSync("/out")).toHaveLength(0); }
    else { expect((await operation).changes).toHaveLength(1); expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)).has("word/document.xml")).toBe(true); }
  }
});

it("does not materialize nested heading styles for an explicitly allowed empty selection", async () => {
  const input = await textFixture(paragraph("No headers"));
  const volume = Volume.fromJSON({ "/out": "" });
  const result = await docx.editDocumentTables(input, { operation: "tables.add", options: { rows: 1, cols: 1, scope: "headers", allowEmpty: true, output: "-", content: { version: 1, blocks: [{ kind: "table", rows: [[{ blocks: [{ kind: "paragraph", level: 1, text: "Uninserted" }] }]] }] } } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  expect(result).toMatchObject({ changed: false, changes: [] });
  expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
});
