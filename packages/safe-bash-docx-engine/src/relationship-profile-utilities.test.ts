import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, XmlPartView, createDocxInspectionCommandEngine, inspectDocumentCharts, inspectDocumentDiagrams, inspectDocumentEquations, inspectDocumentImages, inspectDocumentObjects, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const operation of ["charts", "diagrams", "equations", "images", "objects", "xml"] as const)
for (const route of operation === "xml" ? ["model", "sdk", "shell"] as const : ["sdk", "shell"] as const)
it(`${route} applies ${operation} with inert Relationships-root XML; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const xml = `<pr:Relationships xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="${w}" mc:MustUnderstand="w"><w:p/></pr:Relationships>`;
  parts.set("audit/data.xml", encode(xml));
  parts.set("_rels/.rels", encode(decode(parts.get("_rels/.rels")!).replace("</Relationships>", '<Relationship Id="data" Type="urn:original:inert-data" Target="audit/data.xml"/></Relationships>')));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/audit/data.xml" ContentType="application/xml"/></Types>').replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), replacement = encode(xml.replace(' mc:MustUnderstand="w"', ' mc:MustUnderstand="w" audit="coast"'));
  if (route === "model") {
    const doc = await Document(input, textContext), part = doc.part.package.parts.find(part => part.partname.toString() === "/audit/data.xml") as XmlPartView;
    part.element.set_attribute({namespaceURI: "", localName: "audit"}, "coast"); await doc.save(sink);
  } else if (route === "sdk") {
    if (operation === "xml") expect((await replaceDocumentXmlPart(input, replacement, {part: "/audit/data.xml", output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink})).changed).toBe(true);
    else {
      const data = operation === "images" ? await inspectDocumentImages(input, {operation: "images.list"}, textContext) : await ({charts: inspectDocumentCharts, diagrams: inspectDocumentDiagrams, equations: inspectDocumentEquations, objects: inspectDocumentObjects}[operation])(input, {}, textContext);
      expect(data.items).toEqual([]);
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(operation === "xml" ? "docx xml set /input --part /audit/data.xml --file /replacement --output - > /output" : `docx ${operation} list /input --json`);
    expect(result.exitCode, result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
    if (operation === "xml") memory.writeFileSync("/output", await fs.readFile("/output"));
    else expect(JSON.parse(result.stdout).data.items).toEqual([]);
  }
  if (operation === "xml") {
    const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    expect(xmlStructure(saved.get("audit/data.xml")!)).toEqual(xmlStructure(replacement));
    for (const [part, bytes] of parts) if (part !== "audit/data.xml") expect(saved.get(part), part).toEqual(bytes);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
