import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { readArchive } from "./archive.js";
import { writeArchive } from "./archive-write.js";
import { textContext, textFixture, r, w } from "../tests/fixtures/text.js";

async function inventoryFixture() {
  const source = await readArchive(await textFixture('<w:p/>'), textContext), encode = (value: string) => new TextEncoder().encode(value);
  const files = {
    "payload/catalog.xml": '<v:catalog xmlns:v="urn:original:catalog"><v:entry>Inert</v:entry></v:catalog>',
    "payload/properties.xml": '<d:datastoreItem xmlns:d="http://schemas.openxmlformats.org/officeDocument/2006/customXml" d:itemID="1111"><d:schemaRefs><d:schemaRef d:uri="https://schema.example.test/inert"/></d:schemaRefs></d:datastoreItem>',
    "payload/orphan.xml": '<d:datastoreItem xmlns:d="http://schemas.openxmlformats.org/officeDocument/2006/customXml" d:itemID="2222"/>',
    "payload/extra.xml": '<extra xmlns="urn:original:unknown">Retained</extra>',
    "payload/_rels/catalog.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="props" Type="${r}/customXmlProps" Target="properties.xml"/><Relationship Id="extra" Type="urn:original:ancillary" Target="extra.xml"/><Relationship Id="external" Type="urn:original:resource" Target="https://resource.example.test/inert" TargetMode="External"/></Relationships>`,
    "payload/_rels/extra.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="cycle" Type="urn:original:ancillary" Target="catalog.xml"/></Relationships>',
    "resources/blocks.xml": `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Opening"/><w:guid w:val="block-1"/><w:category><w:name w:val="Reports"/><w:gallery w:val="docParts"/></w:category><w:types><w:type w:val="normal"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors></w:docPartPr><w:docPartBody><w:p><w:r><w:t>Stored content</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
    "resources/_rels/blocks.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="extra" Type="urn:original:ancillary" Target="../payload/extra.xml"/></Relationships>',
  };
  const types = '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/payload/properties.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/payload/orphan.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override PartName="/resources/blocks.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>';
  const members = source.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', types+'</Types>')) } : member.name === "word/_rels/document.xml.rels" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', `<Relationship Id="data" Type="${r}/customXml" Target="../payload/catalog.xml"/><Relationship Id="blocks" Type="${r}/glossaryDocument" Target="../resources/blocks.xml"/></Relationships>`)) } : member);
  for (const [name, xml] of Object.entries(files)) members.push({ name, bytes: encode(xml), directory: false, modified: new Date("2025-01-01") });
  const fs = Volume.fromJSON({ "/archive": "" }); await writeArchive({ ...source, members }, { async write(bytes) { fs.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(fs.readFileSync("/archive") as Buffer);
}
it("inventories declared custom items/properties, inert schemas and cyclic ancillary resources", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"); const data = await inspectDocumentPackageResources(await inventoryFixture(), "custom-xml.list", {}, textContext);
  expect(data.items.map(item => item.name)).toEqual(["/payload/catalog.xml", "/payload/orphan.xml"]);
  const item = data.items[0]!; expect(item).toMatchObject({ kind: "custom-xml", support: "preserve", properties: [], details: { kind: "custom-xml", root: { namespace: "urn:original:catalog", localName: "catalog" }, storeItemId: "1111", propertiesParts: ["/payload/properties.xml"], schemaReferences: ["https://schema.example.test/inert"] } });
  expect(item.details.parts.map(part => part.name)).toEqual(["/payload/catalog.xml", "/payload/extra.xml", "/payload/properties.xml"]);
  expect(item.references.find(edge => edge.id === "external")).toMatchObject({ external: true, target: "https://resource.example.test/inert" }); expect("text" in item).toBe(false);
});
it("inventories direct native building-block metadata and preserves ancillary part references", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"); const data = await inspectDocumentPackageResources(await inventoryFixture(), "glossary.list", {}, textContext);
  expect(data.items).toHaveLength(1); expect(data.items[0]).toMatchObject({ kind: "glossary", support: "preserve", details: { kind: "glossary", buildingBlocks: [{ path: [0, 0], name: "Opening", guid: "block-1", category: "Reports", gallery: "docParts", types: ["normal"], behaviors: ["content"] }] } });
});

it("admits serialized inventory size before creating its JSON output", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"); const input = await inventoryFixture(), original = JSON.stringify; let serialized = false;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => { if (value?.data?.items) serialized = true; return original(value, ...args); });
  try { await expect(inspectDocumentPackageResources(input, "custom-xml.list", { limit: [{ name: "serializedOutput", value: 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(serialized).toBe(false); } finally { spy.mockRestore(); }
});
it("owns invocation bytes before awaited admission and keeps location digests consistent", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"), input = await inventoryFixture(), expected = [...new Uint8Array(await crypto.subtle.digest("SHA-256", input))].map(byte => byte.toString(16).padStart(2,"0")).join("");
  const pending = inspectDocumentPackageResources(input, "custom-xml.list", {}, textContext); input.fill(0); const data = await pending;
  expect(data.items[0]!.location.value.sourceSha256).toBe(expected);
});
it("inventories orphan glossary parts and unknown native metadata without importing content", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"), archive = await readArchive(await inventoryFixture(), textContext), encode = (value: string) => new TextEncoder().encode(value);
  const members = [...archive.members.map(member => member.name !== "[Content_Types].xml" ? member : { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Override PartName="/orphan/blocks.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/></Types>')) }), { name: "orphan/blocks.xml", bytes: encode(`<w:glossaryDocument xmlns:w="${w}" xmlns:x="urn:original:unknown"><w:docParts><x:docPart x:state="opaque"/><w:docPart><w:docPartPr><w:name w:val="A"/><w:name w:val="B"/></w:docPartPr><w:docPartBody><w:p><w:r><w:t>Never imported</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`), directory: false, modified: new Date("2025-01-01") }];
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const data = await inspectDocumentPackageResources(new Uint8Array(fs.readFileSync("/input") as Buffer), "glossary.list", {}, textContext);
  expect(data.items.map(item => item.name)).toEqual(["/orphan/blocks.xml", "/resources/blocks.xml"]); expect(data.items[0]!.details).toMatchObject({ kind: "glossary", buildingBlocks: [{ path: [0,1], name: null, guid: null }] }); expect(JSON.stringify(data)).not.toContain("Never imported");
});
it("enforces the exact global record ceiling without accepting body selectors", async () => {
  const { inspectDocumentPackageResources } = await import("./ancillary-resources.js"), input = await inventoryFixture();
  await expect(inspectDocumentPackageResources(input, "custom-xml.list", { limit: [{ name: "matches", value: 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(inspectDocumentPackageResources(input, "custom-xml.list", { paragraph: 1 } as Parameters<typeof inspectDocumentPackageResources>[2], textContext)).rejects.toMatchObject({ code: "usage" });
});
