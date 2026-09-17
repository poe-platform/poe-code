import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { createDocxInspectionCommandEngine, DocumentXmlEditor, inspectDocument, readArchive, writeArchive, type InspectionData } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const variants = ["canonical", "font", "rels", "all"] as const;
async function fixture(strict: boolean, variant: typeof variants[number]) {
  const fontKey = "{00112233-4455-6677-8899-AABBCCDDEEFF}";
  const base = await textFixture('<w:p><w:r><w:rPr><w:rFonts w:ascii="Original Sans"/></w:rPr><w:t>Original text</w:t></w:r></w:p>', {
    fontTable: { kind: "fontTable", xml: `<w:fonts xmlns:w="${w}" xmlns:r="${r}"><w:font w:name="Original Sans"><w:embedRegular r:id="fontData" w:fontKey="${fontKey}" w:subsetted="1"/></w:font></w:fonts>` }
  }, strict);
  const archive = await readArchive(base, textContext), types = archive.members.find(member => member.name === "[Content_Types].xml")!, xml = new DocumentXmlEditor(types.bytes);
  for (const node of xml.root.children) {
    const part = node.attributes.find(attribute => attribute.localName === "PartName")?.value;
    const extension = node.attributes.find(attribute => attribute.localName === "Extension")?.value;
    if (variant === "all" || variant === "font" && part === "/word/fontTable.xml" || variant === "rels" && extension === "rels") {
      xml.setAttribute(node, "ContentType", node.attributes.find(attribute => attribute.localName === "ContentType")!.value.toUpperCase());
    }
  }
  const binaryType = "application/vnd.openxmlformats-officedocument.obfuscatedFont";
  const expanded = new DocumentXmlEditor(xml.serialize());
  expanded.insertChildren(expanded.root, `<Override xmlns="${expanded.root.namespace}" PartName="/word/fonts/original.odttf" ContentType="${variant === "all" ? binaryType.toUpperCase() : binaryType}"/>`);
  const relationshipNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const members = [...archive.members.map(member => member === types ? { ...member, bytes: expanded.serialize() } : member),
    { name: "word/_rels/fontTable.xml.rels", bytes: new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="fontData" Type="${relationshipNamespace}/font" Target="fonts/original.odttf"/></Relationships>`), directory: false, modified: new Date("2025-01-02T03:04:06Z") },
    { name: "word/fonts/original.odttf", bytes: new Uint8Array([3, 1, 4, 1, 5, 9]), directory: false, modified: new Date("2025-01-02T03:04:06Z") }];
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

for (const strict of [false, true]) for (const variant of variants) for (const route of ["sdk", "cli"] as const) it(
  `inspects exact font and relationship roles via ${route}; MIME=${variant}; strict=${strict}`, async () => {
    const input = await fixture(strict, variant), original = input.slice(), parts = readPackage(input);
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    let data: InspectionData;
    if (route === "sdk") data = await inspectDocument(input, textContext);
    else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["inspect", "/input", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
        stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope).toMatchObject({ ok: true, operation: "inspect", affected: 0, errors: [] });
      data = envelope.data;
    }
    expect(data.kind).toBe("docx");
    expect(data.dialect).toBe(strict ? "strict" : "transitional");
    expect(data.fonts).toEqual({ references: ["Original Sans"], themeReferences: [], embedded: ["/word/fonts/original.odttf"], installed: null });
    expect(data.fontResources.fontTables).toEqual([{ part: "/word/fontTable.xml", fonts: [{ name: "Original Sans", alternateName: null, charset: null, family: null, pitch: null, embedded: [{ kind: "embedRegular", id: "fontData", fontKey: "{00112233-4455-6677-8899-AABBCCDDEEFF}", subsetted: "1", target: "/word/fonts/original.odttf", status: "resolved" }] }] }]);
    expect(data.fontResources.diagnostics).toEqual([]);
    expect(data.signed).toBe(false);
    expect(data.signatures.verified).toBeNull();
    const relationshipNamespace = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
    expect(data.relationships).toEqual([
      { owner: "/", id: "document", type: relationshipNamespace + "/officeDocument", target: "word/document.xml", external: false },
      { owner: "/word/document.xml", id: "fontTable", type: relationshipNamespace + "/fontTable", target: "fontTable.xml", external: false },
      { owner: "/word/fontTable.xml", id: "fontData", type: relationshipNamespace + "/font", target: "fonts/original.odttf", external: false }
    ]);
    const fontType = "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml", relType = "application/vnd.openxmlformats-package.relationships+xml";
    expect(data.parts.find(part => part.name === "/word/fontTable.xml")!.contentType).toBe(variant === "font" || variant === "all" ? fontType.toUpperCase() : fontType);
    expect(data.parts.find(part => part.name === "/word/_rels/fontTable.xml.rels")!.contentType).toBe(variant === "rels" || variant === "all" ? relType.toUpperCase() : relType);
    expect(data.parts.map(part => part.name)).toEqual([...parts.keys()].map(name => "/" + name).sort());
    for (const part of data.parts) {
      expect(part.bytes).toBe(parts.get(part.name.slice(1))!.length);
      expect(part.sha256).toBe(createHash("sha256").update(parts.get(part.name.slice(1))!).digest("hex"));
    }
    expect(input).toEqual(original);
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(original));
  }
);
