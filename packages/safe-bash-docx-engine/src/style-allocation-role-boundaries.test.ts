import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const route of ["native", "creation"] as const)
for (const location of ["body-no-styles", "unlinked-header", "custom-data"] as const)
it(`reserves declarations and leaves custom data inert; ${location}; ${route}; strict=${strict}`, async () => {
  const paragraph = '<w:p><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>';
  const source = await textFixture(location === "body-no-styles" ? '<w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>' : paragraph,
    location === "body-no-styles" ? {} : {
      styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>` },
      header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:pPr><w:pStyle w:val="Style1"/></w:pPr></w:p></w:hdr>` }
    }, strict);
  const parts = readPackage(source);
  if (location === "unlinked-header" || location === "custom-data") {
    const relationships = new DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
    const header = relationships.root.children.find(node => node.localName === "Relationship" && node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "header"))!;
    parts.set("word/_rels/document.xml.rels", new TextEncoder().encode(relationships.sourceXml(relationships.root, new Map([[header, ""]]))));
    if (location === "custom-data") {
      const types = new DocumentXmlEditor(parts.get("[Content_Types].xml")!);
      const declaration = types.root.children.find(node => node.localName === "Override" && node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/header.xml"))!;
      parts.set("[Content_Types].xml", new TextEncoder().encode(types.sourceXml(types.root, new Map([[declaration, '<Override PartName="/word/header.xml" ContentType="application/xml"/>']]))));
    }
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "native") { const doc = await api.Document(input, textContext); doc.styles.add_style("New coast", api.WD_STYLE_TYPE.PARAGRAPH); await doc.save(sink); }
  else await api.createDocument({ template: input, content: { version: 1, blocks: [], styles: [{ name: "New coast", type: "paragraph" }] } }, { output: "-" }, { ...textContext, stdout: sink, encoding: { order: "input", compression: "store" } });
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), doc = await api.Document(output, textContext);
  expect(doc.styles.at("New coast").style_id).toBe(location === "custom-data" ? "Style1" : "Style2");
  expect(doc.paragraphs[0]!.text).toBe("Retain 日本 עברית é 🌊");
  const saved = readPackage(output);
  expect(saved.get("word/document.xml")).toEqual(parts.get("word/document.xml"));
  if (location !== "body-no-styles") for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
