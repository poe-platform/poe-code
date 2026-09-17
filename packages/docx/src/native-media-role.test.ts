import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, ParagraphStyle, createDocxInspectionCommandEngine, editDocumentParagraphs, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "styles", "header", "settings"] as const)
for (const parameter of ["", ";original-audit=coast", '; original-audit="coast; dunes"'] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains native ${role} role with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:pPr><w:pStyle w:val="Coast"/></w:pPr><w:r><w:t>Original coast</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', {
    styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:styleId="Coast" w:type="paragraph"><w:name w:val="Coast"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`},
    header: {kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Header coast</w:t></w:r></w:p></w:hdr>`},
    settings: {kind: "settings", xml: `<w:settings xmlns:w="${w}"/>`}
  }, strict));
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role === "main" ? (kind === "dotx" ? "template" : "document") + ".main" : role}+xml`;
  const types = decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace(`ContentType="${type}"`, `ContentType="${type + parameter.replaceAll('"', '&quot;')}"`);
  parts.set("[Content_Types].xml", encode(types));
  const name = role === "main" ? "word/document.xml" : `word/${role}.xml`;
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {
    const doc = await Document(input, textContext);
    expect(doc.paragraphs[0]!.style?.name).toBe("Coast"); expect((doc.styles.at("Coast") as ParagraphStyle).font.bold).toBe(true);
    expect(doc.sections.at(0).header.paragraphs.map(p => p.text)).toEqual(["Header coast"]);
    expect(doc.part.package.parts.find(part => part.partname.toString() === "/" + name)!.content_type).toBe(type + parameter);
    doc.paragraphs[0]!.text = "Changed coast"; await doc.save(sink);
  } else if (route === "sdk") {
    const data = await inspectDocument(input, textContext); expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional");
    expect(data.parts.find(part => part.name === "/" + name)?.contentType).toBe(type + parameter);
    await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const inspected = await shell.exec("docx inspect /input --json"); expect(inspected.exitCode, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout).data.parts.find((part: {name: string}) => part.name === "/" + name).contentType).toBe(type + parameter);
    const result = await shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [part, bytes] of parts) if (part !== "word/document.xml") expect(saved.get(part), part).toEqual(bytes);
  const doc = await Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Changed coast"); expect((doc.styles.at("Coast") as ParagraphStyle).font.bold).toBe(true); expect(doc.sections.at(0).header.paragraphs[0]!.text).toBe("Header coast");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
