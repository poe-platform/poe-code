import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive, type DocxXmlNode } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const defaultNamespace of [false, true]) for (const codec of ["utf8", "utf8-bom", "utf16le", "utf16be"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const nested of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains explicit empty element namespaces under a default namespace; nested=${nested} default=${defaultNamespace} ${codec} ${carrier} ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const original = `<w:p${defaultNamespace ? ` xmlns="${w}"` : ""}><!--retained--><w:r><w:t>Shore</w:t></w:r><?audit keep?></w:p>`;
  const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const inactive = "<w:p><w:r><w:t>Inactive</w:t></w:r></w:p>";
  const body = carrier === "direct" ? original : carrier === "process"
    ? `<f:pass xmlns:f="urn:original:future" xmlns:mc="${mc}" mc:Ignorable="f" mc:ProcessContent="f:pass">${original}</f:pass>`
    : `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? original : inactive}</mc:Choice><mc:Fallback>${carrier === "choice" ? inactive : original}</mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture(body, {}, strict));
  const source = new TextDecoder().decode(parts.get("word/document.xml"));
  parts.set("word/document.xml", codec === "utf8" ? encode(source) : codec === "utf8-bom" ? encode("\ufeff" + source)
    : new Uint8Array(codec === "utf16le" ? Buffer.from("\ufeff" + source, "utf16le") : Buffer.from("\ufeff" + source, "utf16le").swap16()));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const empty: DocxXmlNode = { kind: "element", name: { namespaceURI: "", localName: "audit" }, attributes: [{ name: { namespaceURI: "", localName: "label" }, value: "Owned" }], children: [{ kind: "text", text: "Stored" }] };
  const node: DocxXmlNode = nested ? { kind: "element", name: { namespaceURI: w, localName: "customXml" }, children: [empty] } : empty;
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.element.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "element" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("element"), arguments: { index: 1, node }, resultHandle: "inserted" }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await Document(input, textContext);
    const inserted = document.paragraphs[0]!.element.insert(1, node);
    expect((nested ? inserted.children[0]! : inserted).tag).toEqual({ namespaceURI: "", localName: "audit" });
    await document.save(sink);
  } else if (route === "sdk") {
    await executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx batch /input --ops-file /ops --output - > /output");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(await fs.readFile("/input")).toEqual(input);
    memory.writeFileSync("/output", await fs.readFile("/output"));
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  const reopened = await Document(output, textContext), inserted = reopened.paragraphs[0]!.element.children[1]!;
  const audit = nested ? inserted.children[0]! : inserted;
  expect(audit.tag).toEqual({ namespaceURI: "", localName: "audit" });
  expect(audit.text).toBe("Stored");
  expect([...audit.attributes]).toEqual([[{ namespaceURI: "", localName: "label" }, "Owned"]]);
  if (nested) expect(inserted.tag).toEqual({ namespaceURI: w, localName: "customXml" });
  const xml = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf-8").decode(saved.get("word/document.xml"));
  expect(xml).toContain("<!--retained--><w:r><w:t>Shore</w:t></w:r><?audit keep?>");
  if (carrier === "choice" || carrier === "fallback") expect(xml).toContain(inactive);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
