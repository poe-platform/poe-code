import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentParagraphs, inspectDocument, writeArchive, type InspectionData } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["fontTable", "obfuscatedFont", "fontdata", "theme"] as const) for (const parameter of ["", ";audit=coast"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} resolves ${role} with ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr><w:t>Coast</w:t></w:r></w:p>', {
    fontTable: {kind: "fontTable", xml: `<w:fonts xmlns:w="${w}" xmlns:r="${r}"><w:font w:name="Original Coast"><w:embedRegular r:id="fontData" w:fontKey="{00112233-4455-6677-8899-AABBCCDDEEFF}" w:subsetted="1"/></w:font></w:fonts>`}
  }, strict));
  const rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r, drawing = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main";
  const fontType = role === "fontdata" ? "application/x-fontdata" : "application/vnd.openxmlformats-officedocument.obfuscatedFont", themeType = "application/vnd.openxmlformats-officedocument.theme+xml", tableType = "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml";
  const type = role === "fontTable" ? tableType : role === "theme" ? themeType : fontType, name = role === "fontTable" ? "word/fontTable.xml" : role === "theme" ? "word/theme.xml" : "word/fonts/coast.bin";
  parts.set("word/theme.xml", encode(`<a:theme xmlns:a="${drawing}" name="Original Coast"><a:themeElements><a:fontScheme name="Original Coast"><a:majorFont><a:latin typeface="Original Coast"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`));
  parts.set("word/fonts/coast.bin", new Uint8Array([8, 3, 5, 7, 11]));
  parts.set("word/_rels/fontTable.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="fontData" Type="${rel}/font" Target="fonts/coast.bin"/></Relationships>`));
  parts.set("word/_rels/document.xml.rels", encode(decode(parts.get("word/_rels/document.xml.rels")!).replace("</Relationships>", `<Relationship Id="theme" Type="${rel}/theme" Target="theme.xml"/></Relationships>`)));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", `<Override PartName="/word/fonts/coast.bin" ContentType="${fontType}"/><Override PartName="/word/theme.xml" ContentType="${themeType}"/></Types>`).replace(`ContentType="${type}"`, `ContentType="${type + parameter}"`).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  let data: InspectionData;
  if (route === "sdk") {
    data = await inspectDocument(input, textContext);
    await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const read = await shell.exec("docx inspect /input --json"); expect(read.exitCode, read.stderr).toBe(0); data = JSON.parse(read.stdout).data;
    const result = await shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  expect(data.parts.find(part => part.name === "/" + name)!.contentType).toBe(type + parameter);
  expect(data.fontResources.fontTables[0]!.fonts[0]!.embedded[0]).toMatchObject({target: "/word/fonts/coast.bin", status: "resolved"});
  expect(data.fontResources.references).toEqual([expect.objectContaining({part: "/word/document.xml", attribute: "asciiTheme", value: "majorHAnsi", resource: "/word/theme.xml", status: "resolved"})]);
  expect(data.fontResources.diagnostics).toEqual([]);
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [part, bytes] of parts) if (part !== "word/document.xml") expect(saved.get(part), part).toEqual(bytes);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Changed coast");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
