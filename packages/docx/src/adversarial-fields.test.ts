import { expect, it } from "vitest";
import { Volume } from "memfs";
import { validateDocumentArchive } from "./validation.js";
import { writeDocumentArchive } from "./document-write.js";
import type { DocumentArchive } from "./archive.js";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encode = (value: string) => new TextEncoder().encode(value);
function document(body: string): DocumentArchive {
  return { comment: new Uint8Array(), members: Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rMain" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`
  }).map(([name, value]) => ({ name, bytes: encode(value), directory: false, modified: new Date(0) })) };
}

it.each([
  ["missing simple instruction", '<w:fldSimple><w:r><w:t>Stored</w:t></w:r></w:fldSimple>', "field-instruction"],
  ["foreign instruction attribute", '<w:fldSimple xmlns:x="urn:original:field" x:instr="PAGE"/>', "field-instruction"],
  ["orphan instruction", '<w:r><w:instrText>PAGE</w:instrText></w:r>', "field-instruction"],
  ["instruction in cached result", '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:instrText>REF Cove</w:instrText><w:fldChar w:fldCharType="end"/></w:r>', "field-instruction"],
  ["structured instruction", '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE<w:t>Hidden</w:t></w:instrText><w:fldChar w:fldCharType="end"/></w:r>', "field-instruction"],
  ["end escaping a simple field", '<w:fldSimple w:instr="PAGE"><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Cove</w:instrText></w:r></w:fldSimple><w:r><w:fldChar w:fldCharType="end"/></w:r>', "field-balance"],
  ["end entering a simple field", '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Cove</w:instrText></w:r><w:fldSimple w:instr="PAGE"><w:r><w:fldChar w:fldCharType="end"/></w:r></w:fldSimple>', "field-balance"]
])("rejects %s before any memfs publication", async (_label, body, code) => {
  const archive = document(`<w:p>${body}</w:p>`);
  expect(validateDocumentArchive(archive)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([
    expect.objectContaining({ code, part: "/word/document.xml", location: expect.any(String) })
  ]) });
  const fs = Volume.fromJSON({ "/out": "prior" });
  await expect(writeDocumentArchive(archive, { async write(bytes) { fs.appendFileSync("/out", bytes); } }, { order: "name", compression: "store" }, {
    signal: new AbortController().signal,
    limits: { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512 }
  })).rejects.toMatchObject({ code: "invalid-package" });
  expect(fs.readFileSync("/out", "utf8")).toBe("prior");
});

it("accepts independent nested fields and instructions split across paragraphs", () => {
  const nested = '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>4</w:t><w:fldChar w:fldCharType="end"/></w:r>';
  const archive = document(`<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF </w:instrText></w:r></w:p><w:p><w:r><w:instrText>Cove</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:fldSimple w:instr="PAGE">${nested}</w:fldSimple><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  expect(validateDocumentArchive(archive).valid).toBe(true);
});
