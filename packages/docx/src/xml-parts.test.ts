import { expect, it } from "vitest";
import { Volume } from "memfs";
import { getDocumentXml, replaceDocumentXmlPart, readArchive, writeArchive, DocumentBudget, parseDocumentXml } from "./index.js";
import { textContext as context, textFixture, paragraph, w, r } from "../tests/fixtures/text.js";

const encode = (text: string) => new TextEncoder().encode(text);
const document = (body: string) => encode(`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:e="urn:coastal:extension"><w:body>${body}</w:body></w:document>`);
async function fixture(xml = document(paragraph("Original coast"))) {
  const source = await readArchive(await textFixture(paragraph("Original coast")), context);
  const files = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ ...source, members: source.members.map(member => member.name === "word/document.xml" ? { ...member, bytes: xml } : member) },
    { async write(bytes) { files.appendFileSync("/archive", bytes); } }, { order: "name", compression: "store" }, context);
  return new Uint8Array(files.readFileSync("/archive") as Buffer);
}
const publication = { ...context, encoding: { order: "name", compression: "store" } as const };

it("reads an explicit XML part as exact bytes or lossless base64 metadata", async () => {
  const xml = document(`<w:p><w:r><w:t xml:space="preserve">  Coast &#13; &amp; dunes  </w:t></w:r></w:p><!--kept--><?survey coastal?>`);
  const input = await fixture(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml", raw: true })).toEqual(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml" })).toMatchObject({ part: "/word/document.xml", encoding: "base64", content: Buffer.from(xml).toString("base64"), pretty: false, bytes: xml.length, sha256: expect.any(String) });
  for (const part of ["document.xml", "/word/*.xml", "/word/../word/document.xml"]) {
    await expect(getDocumentXml(input, context, { part })).rejects.toBeDefined();
  }
  await expect(getDocumentXml(input, context, { part: "/absent.xml" })).rejects.toMatchObject({ code: "missing-selection" });
});

it("preserves UTF-16 BOM bytes and displays UTF-8 without losing mixed-content whitespace", async () => {
  const text = `<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t xml:space="preserve">  Coast <w:tab/> dunes  </w:t></w:r></w:p></w:body></w:document>`;
  const xml = new Uint8Array(Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, "utf16le")]));
  const input = await fixture(xml);
  expect(await getDocumentXml(input, context, { part: "/word/document.xml", raw: true })).toEqual(xml);
  const pretty = await getDocumentXml(input, context, { part: "/word/document.xml", pretty: true });
  expect(pretty).toMatchObject({ encoding: "utf-8", pretty: true, bytes: xml.length });
  if (pretty instanceof Uint8Array) throw new Error("Expected display data");
  expect(pretty.content).toContain("\n");
  expect(pretty.content).toContain('  Coast <w:tab/> dunes  ');
  expect(parseDocumentXml(encode(pretty.content)).encoding).toBe("UTF-8");
});

it("replaces one XML part and preserves every unrelated uncompressed byte", async () => {
  const input = await fixture();
  const replacement = document(paragraph("Revised coast"));
  const files = Volume.fromJSON({ "/output": "" });
  const result = await replaceDocumentXmlPart(input, replacement, { part: "/word/document.xml", output: "-" }, {
    ...publication, stdout: { async write(bytes) { files.appendFileSync("/output", bytes); } }
  });
  const bytes = new Uint8Array(files.readFileSync("/output") as Buffer);
  expect(result).toMatchObject({ changed: true, dryRun: false, changes: [{ kind: "replace", before: { kind: "part" }, after: { kind: "part" } }], output: { path: "-", bytes: bytes.length, sha256: expect.any(String) } });
  const before = await readArchive(input, context);
  const after = await readArchive(bytes, context);
  for (const member of before.members) expect(after.members.find(m => m.name === member.name)!.bytes).toEqual(member.name === "word/document.xml" ? replacement : member.bytes);
});

it.each([
  encode('<w:p/>'), encode('<a/><b/>'), encode('<a>unterminated'),
  encode('<!DOCTYPE a [<!ENTITY x "oops">]><a>&x;</a>'), Uint8Array.of(255),
  encode('<?xml version="1.0" encoding="latin1"?><a/>'),
  document(`<w:p><w:hyperlink r:id="missing"><w:r><w:t>Coast</w:t></w:r></w:hyperlink></w:p>`),
  encode(`<w:document xmlns:w="urn:wrong"><w:body/></w:document>`)
])("rejects invalid replacement before any publication %#", async replacement => {
  const files = Volume.fromJSON({ "/output": "untouched" });
  await expect(replaceDocumentXmlPart(await fixture(), replacement, { part: "/word/document.xml", output: "-" }, {
    ...publication, stdout: { async write(bytes) { files.writeFileSync("/output", bytes); } }
  })).rejects.toBeDefined();
  expect(files.toJSON()).toEqual({ "/output": "untouched" });
});

it("preserves unknown namespace content and rejects changed or removed opaque content", async () => {
  const opaque = '<e:record e:code="7">  preserved <e:leaf/> tail </e:record>';
  const input = await fixture(document(paragraph("Original coast") + opaque));
  expect(await replaceDocumentXmlPart(input, document(paragraph("Revised coast") + opaque), { part: "/word/document.xml", dryRun: true }, publication)).toMatchObject({ changed: true, dryRun: true, output: null });
  for (const body of [paragraph("Revised coast"), paragraph("Revised coast") + '<e:record e:code="8">changed</e:record>']) {
    await expect(replaceDocumentXmlPart(input, document(body), { part: "/word/document.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
  }
});

it("refuses protection removal and dangling package relationships", async () => {
  const protectedInput = await fixture(document('<w:documentProtection w:enforcement="1"/>' + paragraph("Locked coast")));
  await expect(replaceDocumentXmlPart(protectedInput, document(paragraph("Revised coast")), { part: "/word/document.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
  const rels = encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${r}/officeDocument" Target="missing.xml"/></Relationships>`);
  await expect(replaceDocumentXmlPart(await fixture(), rels, { part: "/_rels/.rels", dryRun: true }, publication)).rejects.toBeDefined();
});

it("bounds raw and pretty output and reports byte-identical no-op replacement", async () => {
  const input = await fixture();
  for (const options of [{ raw: true }, { pretty: true }]) {
    await expect(getDocumentXml(input, { ...context, budget: new DocumentBudget({ serializedOutput: 16 }) }, { part: "/word/document.xml", ...options })).rejects.toMatchObject({ code: "limit-exceeded" });
  }
  expect(await replaceDocumentXmlPart(input, document(paragraph("Original coast")), { part: "/word/document.xml", dryRun: true }, publication)).toMatchObject({ changed: false, changes: [], output: null });
});

it("rejects document-kind conversion through content-type replacement", async () => {
  const input = await fixture();
  const archive = await readArchive(input, context);
  const types = new TextDecoder().decode(archive.members.find(member => member.name === "[Content_Types].xml")!.bytes);
  const replacement = encode(types.split("document.main+xml").join("template.main+xml"));
  await expect(replaceDocumentXmlPart(input, replacement, { part: "/[Content_Types].xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("accounts for inserted XML nodes before publishing a replacement", async () => {
  await expect(replaceDocumentXmlPart(await fixture(), document(paragraph("Revised coast")), { part: "/word/document.xml", dryRun: true },
    { ...publication, budget: new DocumentBudget({ insertedNodes: 0 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("snapshots XML display options before asynchronous admission", async () => {
  const input = await fixture();
  const options = { part: "/word/document.xml", raw: true };
  const pending = getDocumentXml(input, context, options);
  options.raw = false;
  expect(await pending).toBeInstanceOf(Uint8Array);
});

it("applies explicit allow-empty to a missing part without masking invalid XML", async () => {
  const input = await fixture();
  await expect(replaceDocumentXmlPart(input, document(paragraph("Revised coast")), { part: "/absent.xml", dryRun: true }, publication)).rejects.toMatchObject({ code: "missing-selection" });
  expect(await replaceDocumentXmlPart(input, document(paragraph("Revised coast")), { part: "/absent.xml", allowEmpty: true, dryRun: true }, publication)).toMatchObject({ changed: false, changes: [], output: null, dryRun: true });
  await expect(replaceDocumentXmlPart(input, encode("<broken>"), { part: "/absent.xml", allowEmpty: true, dryRun: true }, publication)).rejects.toMatchObject({ code: "invalid-xml" });
});
