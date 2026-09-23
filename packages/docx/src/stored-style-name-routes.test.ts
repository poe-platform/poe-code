import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentParagraphs, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const requested of ["Heading 2", "heading 2"]) for (const carrier of ["direct", "choice"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} inserts stored heading style by ${requested} with ${carrier}; ${kind} strict=${strict}`, async () => {
  const style = '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>';
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${carrier === "direct" ? style : `<mc:AlternateContent><mc:Choice Requires="w">${style}</mc:Choice><mc:Fallback/></mc:AlternateContent>`}</w:styles>`}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {const doc = await Document(input, textContext); doc.add_paragraph("Added coast", requested); await doc.save(sink);}
  else if (route === "sdk") await editDocumentParagraphs(input, {operation: "paragraphs.add", options: {text: "Added coast", style: requested, output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(`docx paragraphs add /input --text 'Added coast' --style '${requested}' --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  type Node = ReturnType<typeof xmlStructure>;
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  expect(flatten(xmlStructure(saved.get("word/document.xml")!)).filter(n => n.name === `{${ns}}pStyle`).map(n => n.attributes[`{${ns}}val`])).toEqual(["Heading2"]);
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["Original coast", "Added coast"]);
});
