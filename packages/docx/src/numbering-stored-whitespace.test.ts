import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const elements = (node: Node): Node[] => node.children.flatMap(c => typeof c === "string" ? [] : [c, ...elements(c)]);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"])
for (const axis of ["default", "integers"] as const) for (const route of ["sdk", "cli"] as const)
it(`restarts one list through legal XML whitespace in ${axis}; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const lexical = (n: number) => axis === "integers" ? ` &#x9;${n}&#xD;&#xA; ` : String(n);
  const style = `<w:style w:type="paragraph" w:styleId="Atlas" w:default="${axis === "default" ? ' &#x9;true&#xA; ' : '1'}"><w:name w:val="Atlas"/><w:pPr><w:numPr><w:ilvl w:val="${lexical(0)}"/><w:numId w:val="${lexical(1)}"/></w:numPr></w:pPr></w:style>`;
  const active = carrier === "direct" ? style : carrier === "process" ? `<f:pass>${style}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? style : '<f:opaque/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? style : '<f:opaque/>'}</mc:Fallback></mc:AlternateContent>`;
  const originalDefinition = `<w:abstractNum w:abstractNumId="${lexical(0)}"><w:lvl w:ilvl="${lexical(0)}"><w:start w:val="${lexical(1)}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="${lexical(1)}"><w:abstractNumId w:val="${lexical(0)}"/></w:num>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>First 日本 עברית é 🌊</w:t></w:r></w:p><w:p><w:r><w:t>Other instance stays</w:t></w:r></w:p><!--retain--><?policy keep?>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:number-whitespace" mc:Ignorable="f" mc:ProcessContent="f:pass">${active}</w:styles>` }, numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}">${originalDefinition}<!--number-retain--></w:numbering>` } }, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") await api.editDocumentLists(input, { operation: "lists.set", options: { paragraph: 1, restart: true, start: 5, output: "-" } }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const r = await shell.exec("docx lists set /input --paragraph 1 --restart true --start 5 --output /out --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(0); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && name !== "word/numbering.xml") expect(saved.get(name), name).toEqual(bytes);
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, attrs = (n: Node, key: string) => n.attributes[`{${namespace}}${key}`];
  const numberNodes = elements(xmlStructure(saved.get("word/numbering.xml")!));
  const nums = numberNodes.filter(n => n.name === `{${namespace}}num`); expect(nums).toHaveLength(2); expect(nums.map(n => Number(attrs(n, "numId")))).toEqual([1, 2]);
  const fresh = elements(nums[1]!); expect(Number(fresh.find(n => n.name === `{${namespace}}abstractNumId`)?.attributes[`{${namespace}}val`])).toBe(0); expect(fresh.find(n => n.name === `{${namespace}}startOverride`)?.attributes[`{${namespace}}val`]).toBe("5");
  const documentNodes = elements(xmlStructure(saved.get("word/document.xml")!)); expect(documentNodes.filter(n => n.name === `{${namespace}}numId`).map(n => attrs(n, "val"))).toEqual(["2"]);
  const doc = await api.Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext); expect(doc.paragraphs.map(p => p.text)).toEqual(["First 日本 עברית é 🌊", "Other instance stays"]);
  const beforeXml = new TextDecoder().decode(parts.get("word/numbering.xml")), afterXml = new TextDecoder().decode(saved.get("word/numbering.xml")); const start = beforeXml!.indexOf('<w:abstractNum '), end = beforeXml!.indexOf('<!--number-retain-->'); expect(afterXml).toContain(beforeXml!.slice(start, end)); expect(afterXml).toContain('<!--number-retain-->');
});
