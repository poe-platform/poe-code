import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, readArchive, sanitizeDocument, writeArchive } from "./index.js";
import { textFixture, textContext, r } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function fixture(strict: boolean, otherOwner: boolean, type: string) {
  const archive = await readArchive(await textFixture('<w:p><w:r><w:t>Keep body</w:t></w:r><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office"><o:OLEObject r:id="payload"/></w:object></w:r></w:p>', {}, strict), textContext), rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships", retained = `<Relationship Id="retained" Type="${type}" Target="${otherOwner ? "../word/embeddings/item.bin" : "embeddings/item.bin"}"/>`;
  const files = {
    "word/embeddings/item.bin": { type: "application/vnd.openxmlformats-officedocument.oleObject", bytes: new Uint8Array([17, 39, 91]) },
    ...(otherOwner ? {
      "audit/owner.xml": { type: "application/xml", bytes: encode('<a:record xmlns:a="urn:original:audit"/>') },
      "audit/_rels/owner.xml.rels": { type: "application/vnd.openxmlformats-package.relationships+xml", bytes: encode(`<Relationships xmlns="${relationshipNamespace}">${retained}</Relationships>`) }
    } : {})
  };
  const members = archive.members.map(part => {
    if (part.name === "word/_rels/document.xml.rels") return { ...part, bytes: encode(`<Relationships xmlns="${relationshipNamespace}"><Relationship Id="payload" Type="${rel}/oleObject" Target="embeddings/item.bin"/>${otherOwner ? "" : retained}</Relationships>`) };
    if (part.name !== "[Content_Types].xml") return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, Object.entries(files).map(([name, data]) => `<Override xmlns="${xml.root.namespace}" PartName="/${name}" ContentType="${data.type}"/>`).join(""));
    return { ...part, bytes: xml.serialize() };
  });
  for (const [name, data] of Object.entries(files)) members.push({ name, bytes: data.bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
function nodes(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] { return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))]; }
for (const strict of [false, true]) for (const otherOwner of [false, true]) for (const type of ["urn:original:keep", "urn:original:inert/oleObject", "urn:original:inert/package", "HTTP://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject", "HTTP://schemas.openxmlformats.org/officeDocument/2006/relationships/package"]) for (const route of ["sdk", "cli"] as const) it(`retains incoming ${type}; other owner=${otherOwner}; strict=${strict}; ${route}`, async () => {
  const input = await fixture(strict, otherOwner, type), original = input.slice(), before = readPackage(input), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") {
    const result = sanitizeDocument(input, { remove: ["objects"], output: "-" }, { ...publication, stdout });
    if (strict) await expect(result).rejects.toMatchObject({ code: "invalid-package" });
    else expect((await result).changed).toBe(true);
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["sanitize", "/input", "--remove", "objects", "--output", "-"].map(encode), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    if (strict) { expect(result.exitCode).not.toBe(0); expect(volume.readFileSync("/err", "utf8")).toContain("invalid-package"); }
    else expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  expect(input).toEqual(original); expect(volume.readFileSync("/input")).toEqual(Buffer.from(original));
  if (strict) { expect(volume.readFileSync("/out").length).toBe(0); return; }
  const after = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)), relationshipName = `{http://schemas.openxmlformats.org/package/2006/relationships}Relationship`;
  const edges = nodes(xmlStructure(after.get("word/_rels/document.xml.rels")!)).filter(node => node.name === relationshipName);
  expect.soft(edges.map(edge => edge.attributes)).toEqual(otherOwner ? [] : [{ "{}Id": "retained", "{}Type": type, "{}Target": "embeddings/item.bin" }]);
  expect(after.get("word/embeddings/item.bin")).toEqual(before.get("word/embeddings/item.bin"));
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const body = nodes(xmlStructure(after.get("word/document.xml")!));
  expect(body.some(node => node.name === "{urn:schemas-microsoft-com:office:office}OLEObject")).toBe(false);
  expect(body.filter(node => node.name.endsWith("}t")).flatMap(node => node.children)).toEqual(["Keep body"]);
});
