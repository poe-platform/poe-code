import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";

for (const strict of [false, true]) for (const mode of ["outside", "inactive", "foreign", "unchanged"] as const)
for (const history of ["tblPrChange", "trPrChange", "cellMerge"] as const)
for (const action of (mode === "unchanged" ? ["level"] as const : ["add", "level", "restart"] as const))
for (const route of ["sdk", "cli"] as const)
it(`${route} retains legitimate list ${action} with ${mode} native ${history} strict=${strict}`, async () => {
  const snapshot = history === "tblPrChange" ? "<w:tblPr/>" : history === "trPrChange" ? "<w:trPr/>" : "";
  const marker = `<w:${history} w:id="7" w:author="Original reviewer"${history === "cellMerge" ? ' w:vMerge="rest" w:vMergeOrig="cont"' : ""}>${snapshot}</w:${history}>`;
  const inert = mode === "foreign" ? `<f:${history} w:id="7" w:author="Original reviewer">${snapshot}</f:${history}>` : mode === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback>${marker}</mc:Fallback></mc:AlternateContent>` : marker;
  const item = (text: string) => `<w:p><w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:rPr><w:i/><w:rtl/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const table = `<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:list-control" mc:Ignorable="f"><w:tblPr>${history === "tblPrChange" ? inert : ""}</w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:trPr>${history === "trPrChange" ? inert : ""}</w:trPr><w:tc><w:tcPr>${history === "cellMerge" ? inert : ""}</w:tcPr>${item("Cell retained 日本 עברית é 🌊")}</w:tc></w:tr></w:tbl>`;
  const input = await textFixture(table + item("Outside retained"), { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="2">${[0, 1].map(level => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${level + 1}."/></w:lvl>`).join("")}</w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>` } }, strict);
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const locations = await api.openDocumentLocations(input, textContext), outside = locations.list("paragraph", { scope: "body" }).at(-1)!;
  const selection = mode === "outside" ? { select: outside.token } : { table: 1, cell: "A1", paragraph: 1 };
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const request = action === "add" ? { operation: "lists.add" as const, options: { ...selection, kind: "decimal" as const, text: "New item", start: 5, output: "-" } } : { operation: "lists.set" as const, options: { ...selection, ...(action === "restart" ? { restart: true, start: 5 } : { level: mode === "unchanged" ? 0 : 1 }), output: "-" } };
  if (route === "sdk") {
    const result = await api.editDocumentLists(input, request, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
    expect(result.changed).toBe(mode !== "unchanged");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const flags = action === "add" ? "--kind decimal --text 'New item' --start 5" : action === "restart" ? "--restart true --start 5" : `--level ${mode === "unchanged" ? 0 : 1}`;
      const selector = mode === "outside" ? `--select '${outside.token}'` : "--table 1 --cell A1 --paragraph 1";
      const result = await shell.exec(`docx ${request.operation.split(".").join(" ")} /input ${selector} ${flags} --output - > /out`);
      expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output), original = readPackage(input); assertPackageLinks(saved);
  expect([...saved.keys()]).toEqual([...original.keys()]);
  for (const [part, bytes] of original) if (mode === "unchanged" || part !== "word/document.xml" && (action === "level" || part !== "word/numbering.xml")) expect(saved.get(part), part).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/document.xml")); expect(xml).toContain(strict ? inert.split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main") : inert);
  if (mode === "outside") expect(xml).toContain(table);
  const d = await api.Document(output, textContext); expect(d.tables[0]!.cell(0, 0).paragraphs[0]!.text).toBe("Cell retained 日本 עברית é 🌊"); expect(d.tables[0]!.cell(0, 0).paragraphs[0]!.runs[0]!.italic).toBe(true); expect(d.tables[0]!.cell(0, 0).paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  type Node = ReturnType<typeof xmlStructure>;
  const observed: Node[] = [], pending = [xmlStructure(saved.get("word/document.xml")!)];
  while (pending.length) { const node = pending.pop()!; observed.push(node); for (const child of node.children) if (typeof child !== "string") pending.push(child); }
  const paragraphs = observed.filter(node => node.name === `{${ns}}p`);
  expect(paragraphs).toHaveLength(action === "add" ? 3 : 2);
  const selectedText = action === "add" ? "New item" : mode === "outside" ? "Outside retained" : "Cell retained 日本 עברית é 🌊";
  const selected = paragraphs.find(node => {
    const runs = node.children.filter((child): child is Node => typeof child !== "string" && child.name === `{${ns}}r`);
    return runs.flatMap(run => run.children.filter((child): child is Node => typeof child !== "string" && child.name === `{${ns}}t`).flatMap(text => text.children.filter((child): child is string => typeof child === "string"))).join("") === selectedText;
  })!;
  const properties = selected.children.find((child): child is Node => typeof child !== "string" && child.name === `{${ns}}pPr`)!;
  const binding = properties.children.find((child): child is Node => typeof child !== "string" && child.name === `{${ns}}numPr`)!;
  const value = (name: string) => binding.children.find((child): child is Node => typeof child !== "string" && child.name === `{${ns}}${name}`)!.attributes[`{${ns}}val`];
  expect(value("ilvl")).toBe(action === "level" && mode !== "unchanged" ? "1" : "0");
  if (action === "level") expect(value("numId")).toBe("3"); else expect(value("numId")).not.toBe("3");
  expect((await api.validateDocument(output, textContext)).valid).toBe(true); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
