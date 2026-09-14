import { expect, it } from "vitest";
import { Volume } from "memfs";
import { DocumentArchiveEditor, validateDocumentArchive, writeDocumentArchive, type DocumentArchive } from "./index.js";
import { readPackage, assertPackageLinks, assertWordReferences } from "../tests/assertions.js";


const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encode = (s: string) => new TextEncoder().encode(s);
function document(body: string, extra: Record<string, string> = {}): DocumentArchive {
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rMain" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": ""
  };
  const members = Object.entries(parts).map(([name, xml]) => ({ name, bytes: encode(xml), directory: false, modified: new Date("1980-01-01T00:00:00Z") }));
  const main = members.find(m => m.name === "word/document.xml")!;
  main.bytes = encode(`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`);
  for (const [name, xml] of Object.entries(extra)) {
    const member = members.find(m => m.name === name);
    if (member) member.bytes = encode(xml);
  }
  return { comment: new Uint8Array(), members };
}

it.each([
  ['<w:p><w:pPr><w:pStyle w:val="Absent"/></w:pPr></w:p>', "style-reference"],
  ['<w:p><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:p>', "numbering-reference"],
  ['<w:p><w:r><w:footnoteReference w:id="3"/></w:r></w:p>', "note-reference"],
  ['<w:p><w:r><w:endnoteReference w:id="3"/></w:r></w:p>', "note-reference"],
  ['<w:p><w:r><w:commentReference w:id="3"/></w:r></w:p>', "comment-reference"],
  ['<w:p><w:bookmarkStart w:id="1" w:name="Coast"/></w:p>', "bookmark-range"],
  ['<w:p><w:bookmarkEnd w:id="1"/></w:p>', "bookmark-range"],
  ['<w:p><w:ins w:id="2"/><w:del w:id="2"/></w:p>', "revision-id"],
  ['<w:p><w:ins w:id="bad"/></w:p>', "revision-id"],
  ['<w:p><w:r><wp:docPr id="4"/><wp:docPr id="4"/></w:r></w:p>', "drawing-id"],
  ['<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>', "field-balance"],
  ['<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>', "field-balance"],
  ['<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>', "table-grid"],
  ['<w:p><w:hyperlink r:id="missing"/></w:p>', "relationship-reference"]
])("reports a located %s failure", (body, code) => {
  const report = validateDocumentArchive(document(body));
  expect(report.valid).toBe(false);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ code, part: "/word/document.xml", location: expect.any(String) }));
});

it("accepts balanced fields, crossing bookmarks, omitted grid slots and numbering removal", () => {
  const body = '<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:bookmarkStart w:id="1" w:name="Bay"/><w:bookmarkStart w:id="2" w:name="Pier"/><w:bookmarkEnd w:id="1"/><w:bookmarkEnd w:id="2"/><w:r><w:fldChar w:fldCharType="begin"/><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
    '<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>';
  expect(validateDocumentArchive(document(body))).toMatchObject({ valid: true, profile: "core-v1" });
});

it("distinguishes resource limits, unknown profiles and incomplete schema coverage", () => {
  expect(() => validateDocumentArchive(document('<w:p/>'), { maxNodes: 1 })).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  expect(() => validateDocumentArchive(document('<w:p/>'), { profile: "other" as never })).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(validateDocumentArchive(document('<w:p/>')).checks).toContainEqual({ id: "extension-coverage", status: "unvalidated" });
});

it("rejects invalid staged package edits before a snapshot escapes", () => {
  const editor = new DocumentArchiveEditor(document('<w:p><w:bookmarkStart w:id="1" w:name="Bay"/><w:bookmarkEnd w:id="1"/></w:p>'));
  const xml = editor.xml("word/document.xml");
  const end = xml.root.children[0]!.children[0]!.children[1]!;
  xml.setAttribute(end, { namespace: w, localName: "id" }, "2");
  expect(() => editor.snapshot()).toThrowError(expect.objectContaining({ code: "invalid-package" }));
});

it("independently decodes a valid staged output in memfs", async () => {
  const editor = new DocumentArchiveEditor(document('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>'));
  const xml = editor.xml("word/document.xml");
  xml.setText(xml.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Harbor");
  const fs = Volume.fromJSON({ "/out": "" });
  await writeDocumentArchive(editor.snapshot(), { async write(b) { fs.appendFileSync("/out", b); } }, { order: "name", compression: "store" }, {
    signal: new AbortController().signal,
    limits: { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512 }
  });
  const parts = readPackage(new Uint8Array(fs.readFileSync("/out") as Uint8Array));
  assertPackageLinks(parts);
  assertWordReferences(parts);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("Harbor");
});

function withPart(archive: DocumentArchive, kind: string, body: string, root = kind, contentKind = kind): DocumentArchive {
  const name = `word/${kind}.xml`;
  const members = archive.members.map(m => ({ ...m, bytes: new Uint8Array(m.bytes) }));
  const types = members.find(m => m.name === "[Content_Types].xml")!;
  types.bytes = encode(new TextDecoder().decode(types.bytes).replace('</Types>', `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${contentKind}+xml"/></Types>`));
  const relName = "word/_rels/document.xml.rels";
  let rels = members.find(m => m.name === relName);
  if (!rels) {
    rels = { name: relName, bytes: encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'), directory: false, modified: new Date(0) };
    members.push(rels);
  }
  rels.bytes = encode(new TextDecoder().decode(rels.bytes).replace('</Relationships>', `<Relationship Id="r${kind}" Type="${r}/${kind}" Target="${kind}.xml"/></Relationships>`));
  members.push({ name, bytes: encode(`<w:${root} xmlns:w="${w}">${body}</w:${root}>`), directory: false, modified: new Date(0) });
  return { ...archive, members };
}

it.each([
  ["styles", '<w:style w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:styleId="B"><w:basedOn w:val="A"/></w:style>', "style-cycle"],
  ["numbering", '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="9"/></w:abstractNum>', "numbering-level"],
  ["numbering", '<w:num w:numId="2"/>', "numbering-reference"],
  ["comments", '<w:comment w:id="1"/><w:comment w:id="01"/>', "comment-id"],
  ["footnotes", '<w:footnote w:id="1"/><w:footnote w:id="1"/>', "footnote-id"]
])("checks %s definitions", (kind, body, code) => {
  expect(validateDocumentArchive(withPart(document('<w:p/>'), kind, body)).diagnostics).toContainEqual(expect.objectContaining({ code, part: `/word/${kind}.xml` }));
});

it("locates a related root and content-type disagreement at the offending part", () => {
  const badRoot = validateDocumentArchive(withPart(document('<w:p/>'), "header", "", "styles"));
  expect(badRoot.diagnostics).toContainEqual(expect.objectContaining({ code: "part-root", part: "/word/header.xml" }));
  const badType = validateDocumentArchive(withPart(document('<w:p/>'), "header", "", "styles", "styles"));
  expect(badType.diagnostics).toContainEqual(expect.objectContaining({ code: "relationship-content-type", part: "/word/document.xml" }));
});

it("checks concrete numbering level references and style types", () => {
  const list = withPart(document('<w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="4"/></w:numPr></w:pPr></w:p>'), "numbering", '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"/></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>');
  expect(validateDocumentArchive(list).diagnostics).toContainEqual(expect.objectContaining({ code: "numbering-level" }));
  const style = withPart(document('<w:p><w:pPr><w:pStyle w:val="Emphasis"/></w:pPr></w:p>'), "styles", '<w:style w:type="character" w:styleId="Emphasis"/>');
  expect(validateDocumentArchive(style).diagnostics).toContainEqual(expect.objectContaining({ code: "style-type" }));
});

it("accepts linked annotations and unsigned drawing IDs", () => {
  let archive = document('<w:p><w:r><w:footnoteReference w:id="1"/><w:commentReference w:id="0"/><wp:docPr id="4294967295"/></w:r></w:p>');
  archive = withPart(archive, "footnotes", '<w:footnote w:id="-1" w:type="separator"/><w:footnote w:id="0" w:type="continuationSeparator"/><w:footnote w:id="1"><w:p/></w:footnote>');
  archive = withPart(archive, "comments", '<w:comment w:id="0"><w:p/></w:comment>');
  expect(validateDocumentArchive(archive).valid).toBe(true);
});

it("keeps fields isolated between individual notes", () => {
  const archive = withPart(document('<w:p/>'), "footnotes", '<w:footnote w:id="1"><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:footnote>');
  expect(validateDocumentArchive(archive).diagnostics.filter(d => d.code === "field-balance")).toHaveLength(2);
});

it("checks vertical merge spans without conflating nested grids", () => {
  const cell = (span: number, merge: string) => `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/><w:vMerge w:val="${merge}"/></w:tcPr><w:p/></w:tc>`;
  const table = (last: string) => `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr>${cell(2, "restart")}</w:tr><w:tr>${last}</w:tr></w:tbl>`;
  expect(validateDocumentArchive(document(table(cell(2, "continue")))).valid).toBe(true);
  expect(validateDocumentArchive(document(table(cell(1, "continue") + '<w:tc><w:p/></w:tc>'))).diagnostics).toContainEqual(expect.objectContaining({ code: "table-grid" }));
});

it("does not validate inactive MCE branches or opaque extension content", () => {
  const archive = document('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:coast:extension"><mc:Choice Requires="x"><w:p><w:bookmarkEnd w:id="7"/></w:p></mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent>');
  expect(validateDocumentArchive(archive).valid).toBe(true);
});

it("validates before document publication and leaves the sink untouched", async () => {
  const fs = Volume.fromJSON({ "/out": "prior" });
  await expect(writeDocumentArchive(document('<w:p><w:bookmarkEnd w:id="1"/></w:p>'), { async write(b) { fs.appendFileSync("/out", b); } }, { order: "name", compression: "store" }, {
    signal: new AbortController().signal,
    limits: { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512 }
  })).rejects.toMatchObject({ code: "invalid-package" });
  expect(fs.readFileSync("/out", "utf8")).toBe("prior");
});

it("declares the core math namespace for MCE while retaining partial-schema warnings", () => {
  const archive = document('<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" mc:MustUnderstand="m"><m:oMath/></w:p>');
  expect(validateDocumentArchive(archive).valid).toBe(true);
});

it("reports required metadata parts explicitly", () => {
  const archive = document('<w:p/>');
  for (const name of ["[Content_Types].xml", "_rels/.rels"]) {
    expect(validateDocumentArchive({ ...archive, members: archive.members.filter(m => m.name !== name) }).diagnostics).toContainEqual(expect.objectContaining({ code: "required-part", part: "/" + name }));
  }
});

it("keeps resource ceilings distinct from malformed and unsupported input", () => {
  const archive = document('<w:p/>');
  const bytes = archive.members.reduce((sum, m) => sum + m.bytes.length, 0);
  expect(validateDocumentArchive(archive, { maxParts: 3, maxBytes: bytes }).valid).toBe(true);
  for (const limits of [{ maxParts: 2 }, { maxBytes: bytes - 1 }, { maxDiagnostics: 1 }]) {
    const input = "maxDiagnostics" in limits ? document('<w:p><w:bookmarkEnd w:id="1"/><w:bookmarkEnd w:id="2"/></w:p>') : archive;
    expect(() => validateDocumentArchive(input, limits)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  }
  const unsupported = document('<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:coast:new" mc:MustUnderstand="x"/>');
  expect(() => validateDocumentArchive(unsupported)).toThrowError(expect.objectContaining({ code: "unsupported-profile" }));
  const malformed = document('<w:p>');
  expect(validateDocumentArchive(malformed).diagnostics).toContainEqual(expect.objectContaining({ code: "invalid-xml", part: "/word/document.xml" }));
});

it("rejects numbering-style dependency cycles", () => {
  let archive = withPart(document('<w:p/>'), "styles", '<w:style w:styleId="List" w:type="numbering"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>');
  archive = withPart(archive, "numbering", '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:abstractNum w:abstractNumId="1"><w:numStyleLink w:val="List"/></w:abstractNum>');
  expect(validateDocumentArchive(archive).diagnostics).toContainEqual(expect.objectContaining({ code: "numbering-cycle" }));
});

it("detects hyperlink relationship type disagreement at its referring node", () => {
  const archive = document('<w:p><w:hyperlink r:id="rstyles"/></w:p>');
  expect(validateDocumentArchive(withPart(archive, "styles", '<w:style w:styleId="Normal" w:type="paragraph"/>')).diagnostics).toContainEqual(expect.objectContaining({ code: "relationship-type" }));
});

it("locates malformed relationship targets in their owner metadata", () => {
  const archive = withPart(document('<w:p/>'), "styles", '<w:style w:styleId="Normal" w:type="paragraph"/>');
  const broken = { ...archive, members: archive.members.filter(m => m.name !== "word/styles.xml").map(m => m.name === "[Content_Types].xml" ? { ...m, bytes: encode(new TextDecoder().decode(m.bytes).replace('<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>', '')) } : m) };
  expect(validateDocumentArchive(broken).diagnostics).toContainEqual(expect.objectContaining({ part: "/word/_rels/document.xml.rels", code: "package-structure" }));
});

it.each(["garden", "observatory", "museum", "equipment"] as const)("validates the original %s fixture independently of downloads", async theme => {
  const { createDocumentFixture } = await import("../tests/fixtures/documents.js");
  const fixture = await createDocumentFixture(theme);
  const archive: DocumentArchive = { comment: new Uint8Array(), members: [...readPackage(fixture.bytes)].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date(0) })) };
  expect(validateDocumentArchive(archive)).toMatchObject({ valid: true });
});

it("retains case-insensitive OPC metadata and MIME handling during staged validation", () => {
  const archive = document('<w:p/>');
  const mixed = { ...archive, members: archive.members.map(m => m.name === "[Content_Types].xml" ? { ...m, name: "[CONTENT_TYPES].XML", bytes: encode(new TextDecoder().decode(m.bytes).replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT.MAIN+XML')) } : m) };
  expect(validateDocumentArchive(mixed).valid).toBe(true);
  const bad = { ...mixed, members: mixed.members.map(m => m.name === "word/document.xml" ? { ...m, bytes: encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:bookmarkEnd w:id="7"/></w:p></w:body></w:document>`) } : m) };
  expect(() => new DocumentArchiveEditor(bad).snapshot()).toThrowError(expect.objectContaining({ code: "invalid-package" }));
});

it.each(["moveFrom", "moveTo", "customXmlIns", "customXmlDel", "customXmlMoveFrom", "customXmlMoveTo"])("checks %s range IDs and pairing", kind => {
  expect(validateDocumentArchive(document(`<w:p><w:${kind}RangeStart w:id="1"/><w:${kind}RangeEnd w:id="1"/></w:p>`)).valid).toBe(true);
  expect(validateDocumentArchive(document(`<w:p><w:${kind}RangeStart w:id="1"/><w:${kind}RangeEnd w:id="2"/></w:p>`)).diagnostics).toContainEqual(expect.objectContaining({ code: "revision-id" }));
});

it.each(["cellIns", "cellDel", "cellMerge", "tblPrExChange"])("requires a numeric %s revision ID", name => {
  expect(validateDocumentArchive(document(`<w:p><w:${name}/></w:p>`)).diagnostics).toContainEqual(expect.objectContaining({ code: "revision-id" }));
});

it("leaves glossary definition scopes unvalidated instead of using main-story styles", () => {
  const archive = withPart(document('<w:p/>'), "glossaryDocument", '<w:docParts><w:docPart><w:docPartBody><w:p><w:pPr><w:pStyle w:val="GlossaryLocal"/></w:pPr></w:p></w:docPartBody></w:docPart></w:docParts>', "glossaryDocument", "document.glossary");
  expect(validateDocumentArchive(archive)).toMatchObject({ valid: true, warnings: expect.any(Array) });
});

it("locates a related-part dialect failure before publishing to memfs", async () => {
  const archive = withPart(document('<w:p/>'), "header", '<w:p><s:r xmlns:s="http://purl.oclc.org/ooxml/wordprocessingml/main"/></w:p>', "hdr");
  const fs = Volume.fromJSON({ "/out": "prior" });
  const diagnostic = { code: "package-structure", part: "/word/header.xml", location: "/" };
  expect(validateDocumentArchive(archive).diagnostics).toContainEqual(expect.objectContaining(diagnostic));
  await expect(writeDocumentArchive(archive, { async write(b) { fs.appendFileSync("/out", b); } }, { order: "name", compression: "store" }, {
    signal: new AbortController().signal,
    limits: { maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 65536, maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512 }
  })).rejects.toMatchObject({ code: "invalid-package", diagnostics: [expect.objectContaining(diagnostic)] });
  expect(fs.readFileSync("/out", "utf8")).toBe("prior");
});
