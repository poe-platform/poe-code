import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, inspectDocument, readArchive, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (xml: string) => new TextEncoder().encode(xml);
const originalXml = '<a:records xmlns:a="urn:original:records"><a:font><a:embedRegular a:note="Original"/></a:font></a:records>';
const replacementXml = '<a:records xmlns:a="urn:original:records"><a:font><a:embedRegular a:note="Updated &amp; retained"/></a:font></a:records>';
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function fixture(strict: boolean, type: string) {
  const archive = await readArchive(await textFixture('<w:p><w:r><w:t>Unrelated body</w:t></w:r></w:p>', {}, strict), textContext), r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const members = archive.members.map(part => {
    if (part.name === "word/_rels/document.xml.rels") return { ...part, bytes: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="${r}/customXml" Target="../audit/memo.xml"/></Relationships>`) };
    if (part.name !== "[Content_Types].xml") return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, `<Override xmlns="${xml.root.namespace}" PartName="/audit/memo.xml" ContentType="${type}"/>`);
    return { ...part, bytes: xml.serialize() };
  });
  members.push({ name: "audit/memo.xml", bytes: encode(originalXml), directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
async function command(input: Uint8Array, args: string[]) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/replacement.xml": Buffer.from(encode(replacementXml)), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
for (const strict of [false, true]) for (const kind of ["application/xml", "application/x.settings+xml", "application/x.fontTable+xml"]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) {
  it(`does not infer native font/settings from ${kind} via ${route}; uppercase=${uppercase}; strict=${strict}`, async () => {
    const type = uppercase ? kind.toUpperCase() : kind, input = await fixture(strict, type), before = input.slice();
    const data = route === "sdk" ? await inspectDocument(input, textContext) : JSON.parse(new TextDecoder().decode(await command(input, ["inspect", "/input", "--json"]))).data;
    expect(data.features).toContainEqual(expect.objectContaining({ id: "F42", detected: false }));
    expect(data.fontResources.fontTables).toEqual([]); expect(data.fonts.references).toEqual([]); expect(data.fonts.embedded).toEqual([]); expect(data.protected).toBe(false);
    expect(data.parts).toContainEqual(expect.objectContaining({ name: "/audit/memo.xml", contentType: type, bytes: encode(originalXml).length }));
    expect(input).toEqual(before);
  });
  it(`publishes unbound inert XML with ${kind} via ${route}; uppercase=${uppercase}; strict=${strict}`, async () => {
    const input = await fixture(strict, uppercase ? kind.toUpperCase() : kind), before = readPackage(input);
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      const result = await replaceDocumentXmlPart(input, encode(replacementXml), { part: "/audit/memo.xml", output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["xml", "set", "/input", "--part", "/audit/memo.xml", "--file", "/replacement.xml", "--output", "-"]);
    const after = readPackage(output);
    expect(after.get("audit/memo.xml")).toEqual(encode(replacementXml));
    expect(xmlStructure(after.get("audit/memo.xml")!)).toEqual(xmlStructure(encode(replacementXml)));
    for (const [name, bytes] of before) if (name !== "audit/memo.xml") expect(after.get(name), name).toEqual(bytes);
    expect(readPackage(input)).toEqual(before);
  });
}
