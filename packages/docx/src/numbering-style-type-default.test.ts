import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLists, validateDocument, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const explicit of [false, true]) for (const reference of ["named", "base", "default"] as const)
for (const carrier of ["direct", "choice", "process"] as const) for (const action of ["restart", "continue"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} inherits ${explicit ? "explicit" : "omitted"} paragraph style type through ${reference}/${carrier}; ${kind} strict=${strict}`, async () => {
  const type = explicit ? ' w:type="paragraph"' : "", ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const inherited = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
  const styles = `<w:style${type} w:styleId="Base"${reference === "default" ? ' w:default="1"' : ""}><w:name w:val="Coast list"/><w:pPr>${inherited}</w:pPr></w:style>` + (reference === "base" ? `<w:style${type} w:styleId="Derived"><w:name w:val="Coast derived"/><w:basedOn w:val="Base"/></w:style>` : "");
  const wrapped = carrier === "direct" ? styles : carrier === "process" ? `<f:bridge>${styles}</f:bridge>` : `<mc:AlternateContent><mc:Choice Requires="w">${styles}</mc:Choice><mc:Fallback><w:style w:type="character" w:styleId="Base"/></mc:Fallback></mc:AlternateContent>`;
  const body = `<w:p><w:pPr>${reference === "default" ? "" : `<w:pStyle w:val="${reference === "base" ? "Derived" : "Base"}"/>`}<!--retain props--></w:pPr><w:r><w:t>Selected coast</w:t></w:r><!--retain paragraph--></w:p>`;
  const parts = readPackage(await textFixture(body, {
    styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:numbering-style" mc:Ignorable="f" mc:ProcessContent="f:bridge">${wrapped}<!--retain styles--></w:styles>`},
    numbering: {kind: "numbering", xml: `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><!--retain numbering--></w:numbering>`}
  }, strict));
  parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  expect((await Document(input, textContext)).paragraphs[0]!.text).toBe("Selected coast");
  if (route === "sdk") await editDocumentLists(input, action === "restart" ? {operation: "lists.set", options: {paragraph: 1, restart: true, start: 5, output: "-"}} : {operation: "lists.add", options: {paragraph: 1, kind: "decimal", text: "Continued dunes", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx lists ${action === "restart" ? "set /input --paragraph 1 --restart true --start 5" : "add /input --paragraph 1 --kind decimal --text 'Continued dunes'"} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml" && (action === "continue" || name !== "word/numbering.xml")) expect(saved.get(name), name).toEqual(bytes);
  type Node = ReturnType<typeof xmlStructure>;
  const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : flatten(child))];
  const main = flatten(xmlStructure(saved.get("word/document.xml")!));
  expect(main.filter(n => n.name === `{${ns}}numId`).map(n => n.attributes[`{${ns}}val`])).toEqual([action === "restart" ? "2" : "1"]);
  if (action === "restart") {
    const definitions = flatten(xmlStructure(saved.get("word/numbering.xml")!));
    expect(definitions.filter(n => n.name === `{${ns}}num`).map(n => n.attributes[`{${ns}}numId`])).toEqual(["1", "2"]);
    expect(definitions.filter(n => n.name === `{${ns}}startOverride`).map(n => n.attributes[`{${ns}}val`])).toEqual(["5"]);
    expect(new TextDecoder().decode(saved.get("word/numbering.xml")!)).toContain(new TextDecoder().decode(parts.get("word/numbering.xml")!).split("</w:numbering>")[0]!);
  }
  expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(action === "restart" ? ["Selected coast"] : ["Selected coast", "Continued dunes"]);
  expect((await validateDocument(output, textContext)).valid).toBe(true);
  expect(new TextDecoder().decode(saved.get("word/document.xml")!)).toContain("<!--retain paragraph-->");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
