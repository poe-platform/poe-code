import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext as fixtureContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";


const textContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };

async function transcodeFixture(input: Uint8Array, codec: "utf8" | "utf16le" | "utf16be"): Promise<Uint8Array> {
  const archive = await api.readArchive(input, textContext), memory = Volume.fromJSON({ "/encoded": "" });
  const members = archive.members.map(member => {
    if (codec === "utf8") return member;
    const bytes = Buffer.from("\ufeff" + new TextDecoder().decode(member.bytes), "utf16le");
    if (codec === "utf16be") bytes.swap16();
    return { ...member, bytes: new Uint8Array(bytes) };
  });
  await api.writeArchive({ ...archive, members }, { async write(bytes: Uint8Array) { memory.appendFileSync("/encoded", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/encoded") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const operation of ["custom-xml.list", "glossary.list", "properties.list", "fonts.list"] as const)
for (const route of ["sdk", "cli", "sdk-batch", "cli-batch"] as const)
it(`exact closed ancillary resource details; strict=${strict}; kind=${kind}; codec=${codec}; operation=${operation}; route=${route}`, async () => {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const cp = strict ? "http://purl.oclc.org/ooxml/officeDocument/customProperties" : "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
  const vt = strict ? "http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes" : "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
  const initial = await transcodeFixture(await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', {
    glossary: { kind: "document.glossary", xml: `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Opening海🌊"/><w:guid w:val="block-1"/><w:category><w:name w:val="Reports"/><w:gallery w:val="docParts"/></w:category><w:types><w:type w:val="normal"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors></w:docPartPr><w:docPartBody><w:p><w:r><w:t>Inert glossary payload</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>` },
    fonts: { kind: "fontTable", xml: `<w:fonts xmlns:w="${w}"/>` }
  }, strict, { kind }), codec);
  const parts = readPackage(initial), enc = (value: string) => new TextEncoder().encode(value);
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/payload/item.xml" ContentType="application/xml"/><Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/payload/properties.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/><Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>');
  parts.set("[Content_Types].xml", types.serialize());
  const bodyEdges = new api.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!);
  bodyEdges.insertChildren(bodyEdges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="data" Type="${r}/customXml" Target="../payload/item.xml"/>`);
  parts.set("word/_rels/document.xml.rels", bodyEdges.serialize());
  const rootEdges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
  rootEdges.insertChildren(rootEdges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="metadata" Type="${r}/custom-properties" Target="metadata/custom.xml"/>`);
  parts.set("_rels/.rels", rootEdges.serialize());
  parts.set("payload/item.xml", enc('<catalog xmlns="urn:original:catalog"><entry>Inert custom payload</entry></catalog>'));
  parts.set("payload/properties.xml", enc(`<d:datastoreItem xmlns:d="${ds}" d:itemID="{11111111-2222-3333-4444-555555555555}"><d:schemaRefs><d:schemaRef d:uri="https://schema.example.invalid/inert"/></d:schemaRefs></d:datastoreItem>`));
  parts.set("payload/_rels/item.xml.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="props" Type="${r}/customXmlProps" Target="properties.xml"/></Relationships>`));
  parts.set("metadata/custom.xml", enc(`<Properties xmlns="${cp}" xmlns:v="${vt}"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Coast"><v:lpwstr>海🌊</v:lpwstr></property></Properties>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), batch = { version: 1 as const, operations: [{ operation, arguments: {} }] };
  let data: unknown;
  if (route === "sdk") data = operation === "properties.list" ? await api.inspectDocumentProperties(input, {}, context) : operation === "fonts.list" ? await api.inspectDocumentFonts(input, {}, context) : await api.inspectDocumentPackageResources(input, operation, {}, context);
  else if (route === "sdk-batch") data = (await api.executeDocumentBatch(input, batch, {}, context)).results[0]!.data;
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec((route === "cli" ? `docx ${operation.split(".").join(" ")} /input` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`) + " --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const items = (data as { items: { details: unknown; location: compiledTypes.Location; references: unknown[] }[] }).items;
  expect(items).toHaveLength(1);
  const inventory = async (names: string[]) => Promise.all(names.map(async name => ({ name: "/" + name, contentType: name === "payload/item.xml" ? "application/xml" : name === "payload/properties.xml" ? "application/vnd.openxmlformats-officedocument.customXmlProperties+xml" : name === "word/glossary.xml" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml", bytes: parts.get(name)!.length, sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(parts.get(name)!)))].map(byte => byte.toString(16).padStart(2, "0")).join("") })));
  if (operation === "custom-xml.list") expect(items[0]!.details).toEqual({ kind: "custom-xml", parts: await inventory(["payload/item.xml", "payload/properties.xml"]), root: { namespace: "urn:original:catalog", localName: "catalog" }, storeItemId: "{11111111-2222-3333-4444-555555555555}", propertiesParts: ["/payload/properties.xml"], namespaces: [{ prefix: "", uri: "urn:original:catalog" }, { prefix: "xml", uri: "http://www.w3.org/XML/1998/namespace" }], schemaReferences: ["https://schema.example.invalid/inert"] });
  else if (operation === "glossary.list") expect(items[0]!.details).toEqual({ kind: "glossary", parts: await inventory(["word/glossary.xml"]), buildingBlocks: [{ path: [0, 0], name: "Opening海🌊", guid: "block-1", category: "Reports", gallery: "docParts", types: ["normal"], behaviors: ["content"] }] });
  else if (operation === "properties.list") expect(items[0]!.details).toEqual({ kind: "property", group: "custom", storedType: { namespace: vt, localName: "lpwstr" }, id: "2" });
  else expect(items[0]!.details).toEqual({ kind: "fonts", parts: await inventory(["word/fonts.xml"]) });
  expect((await api.openDocumentLocations(input, context, "inventory")).resolve(items[0]!.location.token).token).toBe(items[0]!.location.token);
  expect(JSON.stringify(data)).not.toContain("Inert custom payload"); expect(JSON.stringify(data)).not.toContain("Inert glossary payload");
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.statSync("/output").size).toBe(0);
});
