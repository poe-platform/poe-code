import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, XmlPartView, createDocxInspectionCommandEngine, editDocumentParagraphs, getDocumentXml, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const form of ["must-understand", "choice"] as const) for (const bound of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} keeps the document profile for inert XML using a Relationships root, ${form}, bound=${bound}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>', {}, strict));
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const content = form === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w"><w:p/></mc:Choice></mc:AlternateContent>' : '<w:p/>';
  parts.set("audit/data.xml", encode(`<pr:Relationships xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="${w}"${form === "must-understand" ? ' mc:MustUnderstand="w"' : ''}>${content}</pr:Relationships>`));
  if (bound) parts.set("_rels/.rels", encode(decode(parts.get("_rels/.rels")!).replace("</Relationships>", '<Relationship Id="data" Type="urn:original:inert-data" Target="audit/data.xml"/></Relationships>')));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/audit/data.xml" ContentType="application/xml"/></Types>').replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "model") {
    const doc = await Document(input, textContext), part = doc.part.package.parts.find(part => part.partname.toString() === "/audit/data.xml")!;
    if (bound) {
      expect(part).toBeInstanceOf(XmlPartView); expect((part as XmlPartView).element.tag.localName).toBe("Relationships");
      const root = (part as XmlPartView).element, paragraph = form === "choice" ? root.children[0]!.children[0]!.children[0]! : root.children[0]!;
      root.set_attribute({namespaceURI: "", localName: "audit"}, null);
      if (form === "choice") expect(() => paragraph.set_attribute({namespaceURI: "", localName: "audit"}, null)).toThrowError(expect.objectContaining({code: "unsupported-edit"}));
      else paragraph.set_attribute({namespaceURI: "", localName: "audit"}, null);
    } else expect(part).toBeUndefined();
    doc.paragraphs[0]!.text = "Changed coast"; await doc.save(sink);
  }
  else if (route === "sdk") {
    expect((await inspectDocument(input, textContext)).parts.map(part => part.name)).toContain("/audit/data.xml");
    expect(await getDocumentXml(input, textContext, {part: "/audit/data.xml", raw: true})).toEqual(parts.get("audit/data.xml"));
    await editDocumentParagraphs(input, {operation: "paragraphs.set", options: {paragraph: 1, text: "Changed coast", output: "-"}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const inspected = await shell.exec("docx inspect /input --json"); expect(inspected.exitCode, inspected.stderr).toBe(0);
    const raw = await shell.exec("docx xml get /input --part /audit/data.xml --raw > /raw.xml"); expect(raw.exitCode, raw.stderr).toBe(0); expect(await fs.readFile("/raw.xml")).toEqual(parts.get("audit/data.xml"));
    const result = await shell.exec("docx paragraphs set /input --paragraph 1 --text 'Changed coast' --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Changed coast");
  for (const [part, bytes] of parts) if (part !== "word/document.xml") expect(saved.get(part), part).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
