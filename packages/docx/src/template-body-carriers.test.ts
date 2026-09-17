import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocument, createDocumentArchive, createDocxInspectionCommandEngine, editDocumentParagraphs, writeArchive, writeDocumentArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const site of ["body", "section", "geometry", "shared-section"] as const)
for (const inactiveContent of (carrier === "choice" || carrier === "fallback" ? [false, true] : [false]))
for (const action of ["copy", "paragraph", "table"] as const)
for (const route of (action === "copy" ? ["model", "archive-sdk", "sdk", "shell"] as const : ["model", "archive-sdk", "sdk", "shell", "block-sdk", "block-shell"] as const))
it(`${route} template ${action} retains ${site} carrier ${carrier}; ${kind} strict=${strict}${inactiveContent ? "; inactive-content=true" : ""}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const inactive = (value: string) => inactiveContent ? value.replaceAll("Original coast", "Unselected coast").replaceAll('w:w="10000"', 'w:w="12000"') : "<!--inactive-->";
  const wrap = (value: string) => carrier === "direct" ? value
    : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${value}</mc:Choice><mc:Fallback>${inactive(value)}</mc:Fallback></mc:AlternateContent>`
    : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="x">${inactiveContent ? inactive(value) : "<x:unused/>"}</mc:Choice><mc:Fallback>${value}</mc:Fallback></mc:AlternateContent>`
    : `<x:carrier>${value}</x:carrier>`;
  const at = (position: typeof site, value: string) => position === site ? wrap(value) : value;
  const section = `<w:sectPr>${at("geometry", '<w:pgSz w:w="10000" w:h="14000"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/>')}<w:cols w:num="1"/></w:sectPr>`;
  const paragraph = '<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>';
  const main = `<w:document xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:template:body" mc:Ignorable="x" mc:ProcessContent="x:carrier">${at("body", `<w:body><!--before--><?audit keep?>${site === "shared-section" ? wrap(paragraph + section) : paragraph + at("section", section)}</w:body>`)}</w:document>`;
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": main
  }).map(([name, xml]) => [name, encode(xml)]));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const blocks = action === "copy" ? [] : action === "paragraph" ? [{kind: "paragraph" as const, text: "Added coast"}] : [{kind: "table" as const, rows: [[{blocks: []}, {blocks: []}]]}];
  const options = {template: input, content: {version: 1 as const, blocks}};
  if (route === "model") {
    const doc = await Document(undefined, {...textContext, template: input});
    const originalParagraph = doc.paragraphs[0]!, originalSection = doc.sections[0]!;
    if (action === "paragraph") doc.add_paragraph("Added coast");
    if (action === "table") doc.add_table(1, 2);
    expect(originalParagraph.text).toBe("Original coast"); expect(originalSection.page_width?.emu).toBe(6350000);
    await doc.save(sink);
  } else if (route === "archive-sdk") await writeDocumentArchive(await createDocumentArchive(options, textContext), sink, {order: "input", compression: "store"}, textContext);
  else if (route === "sdk") await createDocument(options, {output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else if (route === "block-sdk") await editDocumentParagraphs(input, action === "paragraph" ? {operation: "paragraphs.add", options: {text: "Added coast", output: "-"}} : {operation: "tables.add", options: {rows: 1, cols: 2, output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const quote = (word: string) => "'" + word.split("'").join("'\\''") + "'";
    const command = route === "block-shell" ? "docx " + (action === "paragraph" ? "paragraphs add /input --text 'Added coast'" : "tables add /input --rows 1 --cols 2") + " --output - > /output" : "docx create --template /input --content-json " + quote(JSON.stringify(options.content)) + " --output - > /output";
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec(command);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].sort()).toEqual([...parts.keys()].sort());
  for (const [name, bytes] of parts) if (action === "copy" || name !== "reports/body.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("reports/body.xml"));
  expect(xml).toContain(section); expect(xml).toContain(paragraph); expect(xml).toContain("<!--before--><?audit keep?>");
  if (action === "paragraph") expect(xml.indexOf("Added coast")).toBeLessThan(xml.indexOf(section));
  if (action === "table") {
    type Node = ReturnType<typeof xmlStructure>;
    const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
    const widths = flatten(xmlStructure(saved.get("reports/body.xml")!)).filter(n => n.name === `{${w}}gridCol`).map(n => n.attributes[`{${w}}w`]);
    expect(widths).toEqual(["4000", "4000"]);
    expect(xml.indexOf("gridCol")).toBeLessThan(xml.indexOf(section));
  }
  const reopened = await Document(output, textContext);
  expect(reopened.paragraphs.map(p => p.text)).toEqual(action === "paragraph" ? ["Original coast", "Added coast"] : ["Original coast"]);
  expect(reopened.tables.length).toBe(action === "table" ? 1 : 0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
