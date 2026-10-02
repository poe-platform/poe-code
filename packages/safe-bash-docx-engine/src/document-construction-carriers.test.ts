import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const action of ["table-default", "table-width", "image-default", "image-width", "image-height", "image-both"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} constructs ${action} through ${carrier}; ${kind} strict=${strict}`, async () => {
  const table = action.startsWith("table"), raster = rasterPng();
  const dimensions = action === "image-default" ? [12700, 12700] : action === "image-width" ? [914400, 914400] : action === "image-height" ? [1828800, 1828800] : [914400, 1828800];
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraph = '<w:p><w:r><w:t>Sounding ledger</w:t></w:r></w:p>', section = '<w:sectPr><w:pgSz w:w="14400" w:h="19000"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr>';
  const body = `<w:body><!--retained--><?sound keep?>${paragraph}${section}</w:body>`;
  const inactive = '<w:body><w:p><w:r><w:t>Inactive ledger</w:t></w:r></w:p></w:body>';
  const active = carrier === "nested" ? `<f:pass>${body}</f:pass>` : body;
  const content = carrier === "direct" ? body : carrier === "process" ? `<f:pass>${body}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "fallback" ? "f" : "w"}">${carrier === "fallback" ? inactive : active}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const xml = `<w:document xmlns:w="${word}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:sounding:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${content}</w:document>`;
  const parts = readPackage(await textFixture("<w:p/>", {}, strict));
  const bytes = enc(xml);
  parts.set("word/document.xml", bytes);
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(chunk: Uint8Array) { memory.appendFileSync("/output", chunk); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(chunk) { memory.appendFileSync("/input", chunk); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const args = table ? { rows: 2, cols: 2, ...(action === "table-width" ? { width: { value: 6, unit: "in" } } : {}) } : { input: { kind: "bytes", base64: Buffer.from(raster).toString("base64") }, ...(["image-width", "image-both"].includes(action) ? { width: { value: 1, unit: "in" } } : {}), ...(["image-height", "image-both"].includes(action) ? { height: { value: 2, unit: "in" } } : {}) };
  const operations = [{ operation: `model.document.Document.${table ? "add_table" : "add_picture"}.call`, receiver: ref("document"), arguments: args, resultHandle: "added" },
    ...(table ? [{ operation: "model.table.Table.rows.get", receiver: ref("added"), arguments: {}, resultHandle: "rows" }, { operation: "model.table._Rows.__len__.get", receiver: ref("rows"), arguments: {} }] : ["width", "height"].map(member => ({ operation: `model.shape.InlineShape.${member}.get`, receiver: ref("added"), arguments: {} })))];
  const expected = table ? [2] : dimensions.map(value => ({ value, unit: "emu" }));
  if (route === "model") {
    const doc = await api.Document(input, context);
    if (table) { const added = action === "table-default" ? doc.add_table(2, 2) : doc.add_table(2, 2, api.Inches(6)); expect(added.rows.length).toBe(2); expect(added.columns.length).toBe(2); }
    else { const pending = doc.add_picture(raster, ["image-width", "image-both"].includes(action) ? api.Inches(1) : undefined, ["image-height", "image-both"].includes(action) ? api.Inches(2) : undefined); expect(pending).toBeInstanceOf(Promise); const added = await pending; expect([added.width.emu, added.height.emu]).toEqual(dimensions); }
    await doc.save(sink);
  }
  else if (route === "sdk") { const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink }); expect(result.results.slice(table ? -1 : -2).map(row => row.data)).toEqual(expected); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.slice(table ? -1 : -2).map((row: { data: unknown }) => row.data)).toEqual(expected); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), stored = saved.get("word/document.xml")!;
  const decoded = new TextDecoder().decode(stored);
  expect(decoded).toContain(paragraph); expect(decoded).toContain(section); expect(decoded).toContain("<!--retained--><?sound keep?>");
  if (["choice", "fallback", "nested"].includes(carrier)) expect(decoded).toContain(inactive);
  const tree = xmlStructure(enc(decoded)), nodes = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const all = nodes(tree), reopened = await api.Document(output, context);
  if (table) {
    expect(all.filter(node => node.name === `{${word}}gridCol`).map(node => node.attributes[`{${word}}w`])).toEqual(action === "table-default" ? ["5760", "5760"] : ["4320", "4320"]);
    expect(reopened.tables.length).toBe(1); expect(reopened.tables[0]!.rows.length).toBe(2); expect(reopened.tables[0]!.columns.length).toBe(2); expect(reopened.paragraphs.map(p => p.text)).toEqual(["Sounding ledger"]);
  } else {
    expect(reopened.inline_shapes.length).toBe(1); expect([reopened.inline_shapes[0]!.width.emu, reopened.inline_shapes[0]!.height.emu]).toEqual(dimensions); expect(reopened.paragraphs.map(p => p.text)).toEqual(["Sounding ledger", ""]);
    const media = [...saved].filter(([name]) => name.startsWith("word/media/")); expect(media).toHaveLength(1); expect(media[0]![1]).toEqual(raster);
    const edges = await api.inspectDocument(output, context); expect(edges.kind).toBe(kind); expect(edges.dialect).toBe(strict ? "strict" : "transitional");
  }
  expect(reopened.sections.length).toBe(1); expect(reopened.sections[0]!.page_width?.twips).toBe(14400);
  for (const [name, bytes] of parts) if (!["word/document.xml", "[Content_Types].xml", "word/_rels/document.xml.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const beforeEdges = parts.get("word/_rels/document.xml.rels"), afterEdges = saved.get("word/_rels/document.xml.rels");
  if (beforeEdges) for (const edge of nodes(xmlStructure(beforeEdges)).filter(node => node.name.endsWith("}Relationship"))) expect(nodes(xmlStructure(afterEdges!)).filter(node => node.name.endsWith("}Relationship")).map(node => node.attributes)).toContainEqual(edge.attributes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
