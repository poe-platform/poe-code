import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentParagraphs, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const parameterized of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
for (const [label, content, flags] of [
  ["ignored MustUnderstand", '<f:opaque mc:MustUnderstand="f"><f:record/></f:opaque>', 'mc:Ignorable="f"'],
  ["unselected MustUnderstand", '<mc:AlternateContent><mc:Choice Requires="f" mc:MustUnderstand="f"><f:record/></mc:Choice><mc:Fallback/></mc:AlternateContent>', ""],
  ["empty understood choice", '<mc:AlternateContent><mc:Choice Requires="xml"/><mc:Fallback><f:record mc:MustUnderstand="f"/></mc:Fallback></mc:AlternateContent>', ""],
  ["empty fallback", '<mc:AlternateContent><mc:Choice Requires="f"/><mc:Fallback/></mc:AlternateContent>', ""],
  ["processed carrier", '<f:carrier><entry>Retained 海</entry></f:carrier>', 'mc:Ignorable="f" mc:ProcessContent="f:carrier"']
] as const)
it(`${route} retains generic XML ${label} parameterized=${parameterized}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const payload = `<?xml version="1.0"?><!--before--><audit xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" ${flags}>${content}</audit><?keep after?>`;
  let declarations = new TextDecoder().decode(parts.get("[Content_Types].xml"));
  if (kind === "dotx") declarations = declarations.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  parts.set("[Content_Types].xml", encode(declarations.replace("</Types>", `<Override PartName="/records/audit.data" ContentType="application/xml${parameterized ? "; charset=utf-8" : ""}"/></Types>`)));
  parts.set("records/audit.data", encode(payload));
  parts.set("word/_rels/document.xml.rels", encode(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")).replace("</Relationships>", '<Relationship Id="audit" Type="urn:original:audit" Target="../records/audit.data"/></Relationships>')));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {const model = await Document(input, textContext); model.paragraphs[0]!.text = "Changed coast"; await model.save(sink);}
  else if (route === "sdk") {expect((await inspectDocument(input, textContext)).kind).toBe(kind); await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});}
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const read = await shell.exec("docx inspect /input --json"); expect(read.exitCode, read.stderr).toBe(0);
    const edit = await shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output"); expect(edit.exitCode, edit.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Changed coast"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
