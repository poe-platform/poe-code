import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocument, createDocumentArchive, createDocxInspectionCommandEngine, editDocumentParagraphs, writeArchive, writeDocumentArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const quote = (word: string) => "'" + word.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored-before", "extension-before"] as const)
for (const site of ["style", "name", "properties", "outline"] as const)
for (const route of ["model", "archive-sdk", "sdk", "shell", "paragraph-sdk", "paragraph-shell"] as const)
it(`${route} reuses ${site} style carrier ${carrier}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const wrap = (value: string) => carrier === "direct" ? value
    : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${value}</mc:Choice><mc:Fallback><!--inactive--></mc:Fallback></mc:AlternateContent>`
    : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="x"><x:unselected/></mc:Choice><mc:Fallback>${value}</mc:Fallback></mc:AlternateContent>`
    : carrier === "process" ? `<x:carrier>${value}</x:carrier>`
    : carrier === "ignored-before" ? `<x:ignored>${value}</x:ignored>${value}`
    : `<a:ext uri="inert">${value}</a:ext>${value}`;
  const at = (position: typeof site, value: string) => position === site ? wrap(value) : value;
  const coast = `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Coast">${at("name", '<w:name w:val="Coastal Style"/>')}</w:style>`;
  const heading = `<w:style w:type="paragraph" w:customStyle="0" w:styleId="Heading2">${at("name", '<w:name w:val="Heading 2"/>')}${at("properties", `<w:pPr>${at("outline", '<w:outlineLvl w:val="1"/>')}</w:pPr>`)}</w:style>`;
  const sourceStyles = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:template:carrier" xmlns:a="${a}" mc:Ignorable="x" mc:ProcessContent="x:carrier"><!--style audit--><?retained source?>${at("style", coast + heading)}</w:styles>`;
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/><Override PartName="/reports/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": `<w:document xmlns:w="${w}"><w:body><!--preserve--><w:p><w:r><w:t>Original coast</w:t></w:r></w:p></w:body></w:document>`,
    "reports/_rels/body.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="style" Type="${r}/styles" Target="styles.xml"/></Relationships>`,
    "reports/styles.xml": sourceStyles
  }).map(([name, xml]) => [name, encode(xml)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const options = {template: input, content: {version: 1 as const, blocks: [{kind: "paragraph" as const, text: "Named coast", style: "Coastal Style"}, {kind: "paragraph" as const, text: "Heading coast", level: 2}]}};
  const context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: sink};
  if (route === "model") {
    const doc = await Document(undefined, {...textContext, template: input});
    doc.add_paragraph("Named coast", "Coastal Style"); doc.add_heading("Heading coast", 2); await doc.save(sink);
  } else if (route === "archive-sdk") await writeDocumentArchive(await createDocumentArchive(options, textContext), sink, context.encoding, textContext);
  else if (route === "sdk") await createDocument(options, {output: "-"}, context);
  else if (route === "paragraph-sdk") {
    await editDocumentParagraphs(input, {operation: "paragraphs.add", options: {text: "Named coast", style: "Coastal Style", output: "-"}}, context);
    const intermediate = new Uint8Array(memory.readFileSync("/output") as Buffer); memory.writeFileSync("/output", "");
    await editDocumentParagraphs(intermediate, {operation: "paragraphs.add", options: {text: "Heading coast", level: 2, output: "-"}}, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const commands = route === "shell" ? ["docx create --template /input --content-json " + quote(JSON.stringify(options.content)) + " --output - > /output"]
      : ["docx paragraphs add /input --text 'Named coast' --style 'Coastal Style' --output - > /middle", "docx paragraphs add /middle --text 'Heading coast' --level 2 --output - > /output"];
    for (const command of commands) { const result = await shell.exec(command); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); }
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(original);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (name !== "reports/body.xml") expect(saved.get(name), name).toEqual(bytes);
  const flatten = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const styles = flatten(xmlStructure(saved.get("reports/body.xml")!)).filter(node => node.name === `{${w}}pStyle`);
  expect(styles.map(node => node.attributes[`{${w}}val`])).toEqual(["Coast", "Heading2"]);
  const doc = await Document(output, textContext);
  expect(doc.paragraphs.map(p => p.text)).toEqual(["Original coast", "Named coast", "Heading coast"]);
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
