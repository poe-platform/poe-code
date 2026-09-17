import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, editDocumentControlRepeats, createDocxInspectionCommandEngine, readArchive, writeArchive } from "./index.js";
import { textFixture, textContext, w, r } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function fixture(strict: boolean, variant: "none" | "inert" | "case" | "duplicate") {
  const content = '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Retained range</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
  const archive = await readArchive(await textFixture(content, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="3" w:author="Reviewer"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict), textContext);
  const native = `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}/comments`, type = variant === "inert" ? "urn:original:inert/comments" : variant === "case" ? "HTTP" + native.slice(4) : native;
  const members = archive.members.map(part => {
    if (part.name !== "word/_rels/document.xml.rels" || variant === "none") return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, `<Relationship xmlns="${xml.root.namespace}" Id="additional" Type="${type}" Target="comments.xml"/>`);
    return { ...part, bytes: xml.serialize() };
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
function nodes(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] { return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))]; }
for (const strict of [false, true]) for (const variant of ["none", "inert", "case", "duplicate"] as const) for (const route of ["sdk", "cli"] as const) it(`clones with ${variant} comment relationship through ${route}; strict=${strict}`, async () => {
  const input = await fixture(strict, variant), original = input.slice(), before = readPackage(input), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }, rejected = variant === "duplicate";
  if (route === "sdk") {
    const work = editDocumentControlRepeats(input, { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, { ...publication, stdout });
    if (rejected) await expect(work).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect((await work).changed).toBe(true);
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["controls", "repeat", "/input", "--control", "1", "--data-json", '[{"values":[]},{"values":[]}]', "--output", "-"].map(encode), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    if (rejected) { expect(result.exitCode).not.toBe(0); expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit"); }
    else expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  expect(input).toEqual(original); expect(volume.readFileSync("/input")).toEqual(Buffer.from(original));
  if (rejected) { expect(volume.readFileSync("/out").length).toBe(0); return; }
  const after = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)), namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w, name = (local: string) => `{${namespace}}${local}`;
  const main = nodes(xmlStructure(after.get("word/document.xml")!)), comments = nodes(xmlStructure(after.get("word/comments.xml")!)).filter(node => node.name === name("comment"));
  const refs = main.filter(node => node.name === name("commentReference")).map(node => node.attributes[name("id")]);
  expect(refs).toHaveLength(2); expect(new Set(refs).size).toBe(2); expect(refs).not.toContain("3");
  for (const marker of ["commentRangeStart", "commentRangeEnd"]) expect(main.filter(node => node.name === name(marker)).map(node => node.attributes[name("id")])).toEqual(refs);
  expect(main.filter(node => node.name === name("t")).flatMap(node => node.children)).toEqual(["Retained range", "Retained range"]);
  for (const id of refs) {
    const body = comments.filter(node => node.attributes[name("id")] === id); expect(body).toHaveLength(1);
    expect(body[0]!.attributes[name("author")]).toBe("Reviewer");
    expect(nodes(body[0]!).filter(node => node.name === name("t")).flatMap(node => node.children)).toEqual(["Review note"]);
  }
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [part, bytes] of before) if (!["word/document.xml", "word/comments.xml"].includes(part)) expect(after.get(part), part).toEqual(bytes);
});
