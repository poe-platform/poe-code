import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { runElementOpen } from "./run-properties.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["plain", "choice", "fallback", "process"] as const)
for (const inherited of [false, true])
for (const span of [false, true]) for (const setWidth of [false, true])
for (const route of ["direct", "utility-batch", "cli"] as const)
it.concurrent(`direct cell text retains active native properties and inactive carriers; strict=${strict}; kind=${kind}; ${carrier}; span=${span}; setWidth=${setWidth}; ${route}${inherited ? "; inherited=true" : ""}`, async () => {
  const props = `<w:tcPr><w:tcW w:w="1440" w:type="dxa"/><w:vAlign w:val="center"/>${span ? '<w:gridSpan w:val="2"/>' : ''}</w:tcPr>`;
  const inactive = '<f:sealed><f:value>Retain é 日本 עברית 🌊</f:value></f:sealed>';
  const selected = carrier === "plain" ? props : carrier === "process" ? `<f:pass>${props}</f:pass>${inactive}` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? props : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? props : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input0 = await textFixture(`<w:tbl xmlns:f="urn:original:cell-direct-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/>${span ? '<w:gridCol w:w="1440"/>' : ''}</w:tblGrid><w:tr><w:tc>${selected}<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Outside é 日本 עברית 🌊</w:t></w:r></w:p>`, {}, strict);
  const parts = readPackage(input0), memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  if (inherited) {
    const xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), table = xml.root.children[0]!.children[0]!;
    const scope = table.attributes.filter(attribute => attribute.namespace === "http://schemas.openxmlformats.org/markup-compatibility/2006");
    const moved = runElementOpen({ ...table, attributes: table.attributes.filter(attribute => !scope.includes(attribute)) }) + xml.sourceXml(table, new Map(), true) + `</${table.name}>`;
    const root = { ...xml.root, namespaces: new Map([...xml.root.namespaces, ...table.namespaces]), attributes: [...xml.root.attributes, ...scope] };
    parts.set("word/document.xml", new TextEncoder().encode(runElementOpen(root) + xml.sourceXml(xml.root, new Map([[table, moved]]), true) + `</${xml.root.name}>`));
  }
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Replacement é 日本 עברית 🌊", width = { value: 2, unit: "in" as const }, options = { table: 1, cell: "A1", text: value, ...(setWidth ? { width } : {}) }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
  if (route === "direct") await api.editDocumentTables(input, { operation: "tables.set", options: { ...options, output: "-" } }, context);
  else if (route === "utility-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "tables.set", arguments: options }] }, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx tables set /input --table 1 --cell A1 --text '${value}' ${setWidth ? '--width 2in ' : ''}--output /output --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), xml = new TextDecoder().decode(saved.get("word/document.xml"));
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  if (carrier !== "plain") expect(xml).toContain(inactive);
  const document = await api.Document(output, textContext), cell = document.tables[0]!.cell(0, 0);
  expect(cell.text).toBe(value); expect(cell.width!.inches).toBe(setWidth ? 2 : 1); expect(cell.vertical_alignment).toBe(api.WD_CELL_VERTICAL_ALIGNMENT.CENTER);
  expect(cell.grid_span).toBe(span ? 2 : 1); expect(cell.paragraphs).toHaveLength(1); expect(cell.paragraphs[0]!.runs).toHaveLength(1); expect(cell.paragraphs[0]!.paragraph_format.keep_with_next).toBe(null); expect(cell.paragraphs[0]!.runs[0]!.bold).toBe(null);
  expect(document.paragraphs[0]!.text).toBe("Outside é 日本 עברית 🌊"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
