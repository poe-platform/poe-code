import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, editDocumentControlRepeats, readArchive, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
const roles = [
  { kind: "commentsExtended", root: "commentsEx", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", relationship: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended" },
  { kind: "commentsIds", root: "commentsIds", namespace: "http://schemas.microsoft.com/office/word/2016/wordml/cid", relationship: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" },
  { kind: "commentsExtensible", root: "commentsExtensible", namespace: "http://schemas.microsoft.com/office/word/2018/wordml/cex", relationship: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" },
  { kind: "people", root: "people", namespace: "http://schemas.microsoft.com/office/word/2012/wordml", relationship: "http://schemas.microsoft.com/office/2011/relationships/people" }
];
async function fixture(strict: boolean, role: typeof roles[number], native: boolean, uppercase: boolean, oldLookalike = false) {
  const repeat = '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Retained range</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
  const archive = await readArchive(await textFixture(repeat, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="3" w:author="Reviewer"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict), textContext);
  const type = oldLookalike ? "application/vnd.ms-word.commentsExtended+xml" : native ? `application/vnd.openxmlformats-officedocument.wordprocessingml.${role.kind}+xml` : `application/x.audit-${role.kind}+xml`;
  const members = archive.members.map(part => {
    if (part.name !== "[Content_Types].xml" && !(native && part.name === "word/_rels/document.xml.rels")) return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, part.name === "[Content_Types].xml" ? `<Override xmlns="${xml.root.namespace}" PartName="/audit/metadata.xml" ContentType="${uppercase ? type.toUpperCase() : type}"/>` : `<Relationship xmlns="${xml.root.namespace}" Id="metadata" Type="${role.relationship}" Target="../audit/metadata.xml"/>`);
    return { ...part, bytes: xml.serialize() };
  });
  members.push({ name: "audit/metadata.xml", bytes: encode(native ? `<v:${role.root} xmlns:v="${role.namespace}"/>` : '<a:records xmlns:a="urn:original:audit"><a:entry>Retain exactly</a:entry></a:records>'), directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
function nodes(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] {
  return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
}
async function exercise(input: Uint8Array, strict: boolean, route: "sdk" | "cli", native: boolean) {
  const original = input.slice(), before = readPackage(input), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") {
    const work = editDocumentControlRepeats(input, { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, { ...publication, stdout });
    if (native) await expect(work).rejects.toMatchObject({ code: "unsupported-edit", message: "Modern comments cannot be cloned." });
    else expect((await work).changed).toBe(true);
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "repeat", "/input", "--control", "1", "--data-json", '[{"values":[]},{"values":[]}]', "--output", "-"].map(encode), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    if (native) { expect(result.exitCode).not.toBe(0); expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit"); }
    else expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  expect(input).toEqual(original); expect(volume.readFileSync("/input")).toEqual(Buffer.from(original));
  if (native) { expect(volume.readFileSync("/out").length).toBe(0); return; }
  const after = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)), namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, name = (local: string) => `{${namespace}}${local}`;
  const main = nodes(xmlStructure(after.get("word/document.xml")!)), comments = nodes(xmlStructure(after.get("word/comments.xml")!)).filter(node => node.name === name("comment"));
  const refs = main.filter(node => node.name === name("commentReference")).map(node => node.attributes[name("id")]);
  expect(refs).toHaveLength(2); expect(new Set(refs).size).toBe(2); expect(refs).not.toContain("3");
  for (const local of ["commentRangeStart", "commentRangeEnd"]) expect(main.filter(node => node.name === name(local)).map(node => node.attributes[name("id")])).toEqual(refs);
  expect(main.filter(node => node.name === name("t")).flatMap(node => node.children)).toEqual(["Retained range", "Retained range"]);
  for (const id of refs) {
    const bodies = comments.filter(node => node.attributes[name("id")] === id); expect(bodies).toHaveLength(1);
    expect(bodies[0]!.attributes[name("author")]).toBe("Reviewer");
    expect(nodes(bodies[0]!).filter(node => node.name === name("t")).flatMap(node => node.children)).toEqual(["Review note"]);
  }
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [part, bytes] of before) if (!["word/document.xml", "word/comments.xml"].includes(part)) expect(after.get(part), part).toEqual(bytes);
}
for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) {
  for (const role of roles) for (const native of [false, true]) it(`${native ? "refuses native" : "clones beside inert"} ${role.kind}; strict=${strict}; uppercase=${uppercase}; ${route}`, async () => {
    await exercise(await fixture(strict, role, native, uppercase), strict, route, native);
  });
  it(`clones beside the historical non-native comment MIME; strict=${strict}; uppercase=${uppercase}; ${route}`, async () => {
    await exercise(await fixture(strict, roles[0]!, false, uppercase, true), strict, route, false);
  });
}
