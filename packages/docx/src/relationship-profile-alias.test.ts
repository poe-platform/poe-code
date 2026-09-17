import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentArchiveEditor, readDocumentArchive, writeArchive, type CompatibilityContent } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const name of ["word/_rels/document.xml.rels", "word/_RELS/document.xml.RELS", "word/%5Frels/docu%6Dent.xml.rels"] as const)
it(`handles native profile member spelling ${name}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const parts = readPackage(await textFixture('<w:p/>', {}, strict)), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  parts.delete("word/_rels/document.xml.rels");
  parts.set(name, encode(`<pr:Relationships xmlns:pr="http://schemas.openxmlformats.org/package/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="${w}"><mc:AlternateContent><mc:Choice Requires="w"><pr:Relationship Id="inactive" Type="urn:original:stored" Target="/absent.xml"/></mc:Choice><mc:Fallback><pr:Relationship Id="active" Type="urn:original:active" Target="https://example.invalid/coast" TargetMode="External"/></mc:Fallback></mc:AlternateContent></pr:Relationships>`));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (name.includes("%")) {
    await expect(readDocumentArchive(input, textContext)).rejects.toMatchObject({code: "invalid-package"});
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); return;
  }
  const archive = await readDocumentArchive(input, textContext);
  expect(archive.package.relationships("/word/document.xml").map(row => row.rId)).toEqual(["active"]);
  const xml = new DocumentArchiveEditor(archive).xml("/word/_rels/document.xml.rels"), ids: string[] = [];
  const visit = (content: readonly CompatibilityContent[]) => {for (const node of content) if ("source" in node) {if (node.source.localName === "Relationship") ids.push(node.attributes.find(attribute => attribute.localName === "Id")!.value); visit(node.content);}};
  visit(xml.compatibility.content);
  expect(ids).toEqual(["active"]); expect(xml.serialize()).toEqual(parts.get(name));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
