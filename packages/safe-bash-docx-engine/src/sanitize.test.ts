import { expect, it } from "vitest";
import { Volume } from "memfs";
import { sanitizeDocument } from "./sanitize.js";
import { readDocumentArchive } from "./admission.js";
import { writeArchive } from "./archive-write.js";
import { paragraph, run, r, w, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
import { publication } from "../tests/fixtures/object-publication.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { InputTypeError } from "./archive.js";
const encoding = { order: "input", compression: "store" } as const;
it("rejects non-byte SDK input without coercion", async () => {
  await expect(sanitizeDocument("archive" as unknown as Uint8Array, { remove: ["comments"], dryRun: true }, { ...textContext, encoding })).rejects.toBeInstanceOf(InputTypeError);
});
async function fixture(extra = "", object = false, shared = false, boundary = "", override = false, invalidMetadata = false, sidecar = false) {
  const prefix = boundary === "field" ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>EMBED Item</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' : boundary === "permission" ? '<w:permStart w:id="2" w:edGrp="everyone"/>' : "";
  const suffix = boundary === "field" ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : boundary === "permission" ? '<w:permEnd w:id="2"/>' : "";
  const body = `<w:p>${run("Harbor")}${prefix}${object ? '<w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office"><o:OLEObject r:id="payload"/></w:object></w:r>' : ""}${suffix}<w:hyperlink r:id="outside">${run("Map")}</w:hyperlink><w:hyperlink w:anchor="local">${run("Local")}</w:hyperlink></w:p>${extra}`;
  const archive = await readDocumentArchive(await textFixture(body), textContext);
  const additions = {
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="outside" Type="${r}/hyperlink" Target="https://example.invalid/map" TargetMode="External"/>${object ? `<Relationship Id="payload" Type="${r}/oleObject" Target="embeddings/item.bin"/>` : ""}${shared ? `<Relationship Id="retained" Type="${r}/customXml" Target="embeddings/item.bin"/>` : ""}</Relationships>`,
    "docProps/core.xml": `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Survey team</dc:creator>${invalidMetadata ? '<cp:revision>invalid-counter</cp:revision>' : ""}</cp:coreProperties>`
  };
  const members = archive.members.filter(member => !(member.name in additions)).map(member => {
    if (!["[Content_Types].xml", "_rels/.rels"].includes(member.name)) return member;
    const editor = new DocumentXmlEditor(member.bytes);
    editor.insertChildren(editor.root, member.name === "[Content_Types].xml" ? (override ? '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/embeddings/item.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' : '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>') + '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>');
    return { ...member, bytes: editor.serialize() };
  });
  for (const [name, xml] of Object.entries(additions)) members.push({ name, bytes: new TextEncoder().encode(xml), directory: false, modified: new Date("2025-01-01Z") });
  if (object) members.push({ name: "word/embeddings/item.bin", bytes: new Uint8Array([8, 3, 5]), directory: false, modified: new Date("2025-01-01Z") });
  if (sidecar) members.push({ name: "word/embeddings/_rels/item.bin.rels", bytes: new TextEncoder().encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'), directory: false, modified: new Date("2025-01-01Z") });
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, encoding, textContext);
  return new Uint8Array(volume.readFileSync("/input") as Uint8Array);
}
it("enumerates fixed-order effects and retains local links and unrelated text", async () => {
  const input = await fixture("", true), original = new Uint8Array(input), volume = Volume.fromJSON({ "/output": "" });
  const data = await sanitizeDocument(input, { remove: ["objects", "links", "properties"], output: "-" }, { ...textContext, encoding, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  expect(data.actions.map(action => [action.category, action.affected])).toEqual([["properties", 1], ["links", 1], ["objects", 1]]);
  expect(data.actions[0]!.records).toEqual(["core:author"]);
  expect(data.retained).toEqual(["comments", "revisions"]);
  expect(data.gaps.length).toBeGreaterThan(0);
  expect(data.removedParts).toContain("/word/embeddings/item.bin");
  const parts = readPackage(new Uint8Array(volume.readFileSync("/output") as Uint8Array)); assertPackageLinks(parts);
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));
  expect(xml).toContain('w:anchor="local"'); expect(xml).toContain("Map"); expect(xml).toContain("Harbor"); expect(xml).not.toContain("OLEObject");
  expect(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels"))).not.toContain("outside");
  expect(input).toEqual(original);
});
it("cleans the owned empty relationship part of a removed embedded leaf", async () => {
  const input = await fixture("", true, false, "", true, false, true), env = publication(input);
  const data = await sanitizeDocument(input, { remove: ["objects"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.removedParts).toEqual(["/word/embeddings/item.bin", "/word/embeddings/_rels/item.bin.rels"]);
  assertPackageLinks(readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array)));
});
it("removes only supported metadata and reports invalid retained values", async () => {
  const input = await fixture("", false, false, "", false, true), env = publication(input);
  const data = await sanitizeDocument(input, { remove: ["properties"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.actions[0]!.records).toEqual(["core:author"]); expect(data.gaps).toContain("Cached, invalid, opaque or ambiguously owned properties are retained.");
  const parts = readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array));
  const xml = new TextDecoder().decode(parts.get("docProps/core.xml")); expect(xml).toContain("invalid-counter"); expect(xml).not.toContain("Survey team");
});
it.each(["accept", "reject"] as const)("applies the exact supported revision policy: %s", async revisionPolicy => {
  const input = await textFixture('<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer"><w:r><w:rPr><w:b/></w:rPr><w:t>New</w:t></w:r></w:ins></w:p>'), env = publication(input);
  const data = await sanitizeDocument(input, { remove: ["revisions"], revisionPolicy, output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.actions[0]!.affected).toBe(2); expect(data.actions[0]!.records).toHaveLength(2);
  const parts = readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array)); assertPackageLinks(parts);
  const xml = new TextDecoder().decode(parts.get("word/document.xml")); expect(xml).toContain(revisionPolicy === "accept" ? "New" : "Old"); expect(xml).not.toContain(revisionPolicy === "accept" ? "Old" : "New"); expect(xml).not.toContain("w:ins"); expect(xml).not.toContain("w:del"); if (revisionPolicy === "accept") expect(xml).toContain("w:b");
});
it("removes the last embedded target and its explicit content type together", async () => {
  const input = await fixture("", true, false, "", true), env = publication(input);
  const data = await sanitizeDocument(input, { remove: ["objects"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.removedParts).toContain("/word/embeddings/item.bin");
  const parts = readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array)); assertPackageLinks(parts);
  expect(new TextDecoder().decode(parts.get("[Content_Types].xml"))).not.toContain("/word/embeddings/item.bin");
});
it.each(["field", "permission"])("refuses embedded removal within protected boundaries: %s", async boundary => {
  const input = await fixture("", true, false, boundary), env = publication(input);
  await expect(sanitizeDocument(input, { remove: ["objects"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(env.volume.readdirSync("/out")).toEqual([]);
});
it("rolls back mixed actions on opaque revisions and protected controls", async () => {
  for (const extra of [`<w:moveFrom w:id="9">${paragraph("Old")}</w:moveFrom>`, `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${paragraph("Guarded")}</w:sdtContent></w:sdt>`]) {
    const input = await fixture(extra), env = publication(input); env.volume.writeFileSync("/out/result.docx", "existing");
    await expect(sanitizeDocument(input, { remove: ["properties", "revisions"], revisionPolicy: "accept", output: "/out/result.docx", force: true }, { ...textContext, encoding, filesystem: env.fs })).rejects.toBeInstanceOf(Error);
    expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input)); expect(env.volume.readFileSync("/out/result.docx", "utf8")).toBe("existing"); expect(env.volume.readdirSync("/out")).toEqual(["result.docx"]);
  }
});
it("decides supported revisions with explicit policy and never publishes dry runs", async () => {
  const input = await textFixture(`<w:p><w:ins w:id="4" w:author="Editor">${run("New")}</w:ins></w:p>`);
  const result = await sanitizeDocument(input, { remove: ["revisions"], revisionPolicy: "reject", dryRun: true }, { ...textContext, encoding, stdout: { async write() { throw new Error("unexpected sink"); } } });
  expect(result.actions[0]).toMatchObject({ category: "revisions", affected: 1 }); expect(result.output).toBeNull();
});
it("validates empty selection and combinations before mutation", async () => {
  const input = await textFixture(paragraph("Plain"));
  await expect(sanitizeDocument(input, { remove: ["comments"], dryRun: true }, { ...textContext, encoding })).rejects.toMatchObject({ code: "missing-selection" });
  await expect(sanitizeDocument(input, { remove: ["comments"], allowEmpty: true, dryRun: true }, { ...textContext, encoding })).resolves.toMatchObject({ changed: false });
  await expect(sanitizeDocument(input, { remove: ["links"], revisionPolicy: "accept", dryRun: true }, { ...textContext, encoding })).rejects.toMatchObject({ code: "usage" });
});
it("retains embedded targets that still have another incoming binding", async () => {
  const input = await fixture("", true, true), env = publication(input);
  const data = await sanitizeDocument(input, { remove: ["objects"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.removedParts).not.toContain("/word/embeddings/item.bin");
  expect(data.removedRelationships).toEqual([{ owner: "/word/document.xml", id: "payload" }]);
  const parts = readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array)); assertPackageLinks(parts);
  expect(parts.get("word/embeddings/item.bin")).toEqual(new Uint8Array([8, 3, 5]));
});
it("removes classic comment identities and all owned markers preserving labels", async () => {
  const input = await textFixture(`<w:p><w:commentRangeStart w:id="7"/>${run("Selected")}<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r></w:p>`, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Reviewer"><w:p>${run("Check")}</w:p></w:comment></w:comments>` } });
  const env = publication(input), data = await sanitizeDocument(input, { remove: ["comments"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs });
  expect(data.actions[0]).toMatchObject({ category: "comments", affected: 1 });
  expect(data.actions[0]!.records).toEqual(["7"]);
  const parts = readPackage(new Uint8Array(env.volume.readFileSync("/out/result.docx") as Uint8Array)); assertPackageLinks(parts);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).not.toContain("commentRange");
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).not.toContain("commentReference");
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("Selected");
  expect(new TextDecoder().decode(parts.get("word/comments.xml"))).not.toContain("Check");
});
it("rejects asynchronous effect admission before publication", async () => {
  const input = await fixture(), env = publication(input);
  await expect(sanitizeDocument(input, { remove: ["properties"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs, admitSanitization: async () => {} })).rejects.toMatchObject({ code: "usage" });
  expect(env.volume.readdirSync("/out")).toEqual([]);
});
it("preserves original and destination on final mixed publication failure", async () => {
  const input = await fixture("", true), env = publication(input); env.volume.writeFileSync("/out/result.docx", "existing");
  await expect(sanitizeDocument(input, { remove: ["properties", "links", "objects"], output: "/out/result.docx", force: true }, { ...textContext, encoding, filesystem: { ...env.fs, publishStagedFile: async () => { throw new Error("Original refusal"); } } })).rejects.toMatchObject({ code: "sink-failure" });
  expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input)); expect(env.volume.readFileSync("/out/result.docx", "utf8")).toBe("existing"); expect(env.volume.readdirSync("/out")).toEqual(["result.docx"]);
});
it("refuses compound object carriers after earlier staged actions without publication", async () => {
  const input = await fixture(`<w:p><w:r><w:object><w:t>Opaque payload</w:t></w:object></w:r></w:p>`, true), env = publication(input);
  await expect(sanitizeDocument(input, { remove: ["properties", "links", "objects"], output: "/out/result.docx" }, { ...textContext, encoding, filesystem: env.fs })).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(env.volume.readFileSync("/input.docx")).toEqual(Buffer.from(input)); expect(env.volume.readdirSync("/out")).toEqual([]);
});
