import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, table, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { technicalBitmap } from "../tests/fixtures/documents.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const boundary = (refs = "") => `<w:p><w:pPr><w:sectPr>${refs}</w:sectPr></w:pPr></w:p>`;
const ref = '<w:headerReference w:type="default" r:id="coast"/>';
const field = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
async function shared(strict = false) {
  return textFixture(boundary(ref) + boundary() + boundary(ref) + '<w:sectPr/>', {
    coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><!--keep-->${paragraph("Coast report")}${table([paragraph("Tide")])}${field}</w:hdr>` }
  }, strict);
}
async function edit(input: Uint8Array, options: docx.StoryEditRequest["options"], operation: docx.StoryEditRequest["operation"] = "headers.set") {
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await docx.editDocumentStories(input, { operation, options: { output: "-", ...options } } as docx.StoryEditRequest, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  return { data, bytes, archive: await docx.readArchive(bytes, textContext), sections: (await docx.inspectDocumentSections(bytes, {}, textContext)).items };
}

it("reads absent variants without creating stories or invoking file authority", async () => {
  const input = await textFixture(paragraph("Harbor"));
  const before = input.slice();
  for (const kind of ["headers", "footers"] as const) {
    const data = await docx.inspectDocumentStories(input, { operation: `${kind}.list`, options: {} }, textContext);
    expect(data.items).toHaveLength(3);
    expect(data.items.map(i => i.variant)).toEqual(["default", "first", "even"]);
    for (const item of data.items) expect(item).toMatchObject({ part: null, text: "", linked: true, owners: [], location: { kind: "section" } });
  }
  expect(input).toEqual(before);
});

it.each([false, true])("clones inherited content and isolates one section while retaining fields and tables (%s)", async strict => {
  const input = await shared(strict);
  const result = await edit(input, { section: 2, linkToPrevious: false });
  expect(result.sections.map(s => s.headers.default.part)).toEqual(["/word/coast.xml", "/word/header1.xml", "/word/coast.xml", "/word/coast.xml"]);
  const original = result.archive.members.find(m => m.name === "word/coast.xml")!.bytes;
  expect(result.archive.members.find(m => m.name === "word/header1.xml")!.bytes).toEqual(original);
  expect(result.data.affectedSections).toEqual([2]);
  const info = await docx.inspectDocumentStories(result.bytes, { operation: "headers.get", options: { section: 2 } }, textContext);
  expect(info.items[0]).toMatchObject({ text: "Coast report\nTide\n7", linked: false, owners: [2] });
});

it("pins the next inherited binding so a local edit does not alter later sections", async () => {
  const input = await textFixture(boundary(ref) + boundary() + '<w:sectPr/>', { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast")}</w:hdr>` } });
  const result = await edit(input, { section: 2, linkToPrevious: false, text: "Harbor" });
  expect(result.sections.map(s => s.headers.default.part)).toEqual(["/word/coast.xml", "/word/header1.xml", "/word/coast.xml"]);
  expect(result.sections[2]!.headers.default.linkedToPrevious).toBe(false);
});

it("requires explicit shared or local intent on linked and multiply referenced stories", async () => {
  const input = await shared();
  for (const section of [1, 2, 3, 4]) await expect(edit(input, { section, text: "Harbor" })).rejects.toMatchObject({ code: "ambiguous-selection" });
});

it("reports every shared owner including other variants and out-of-scope sections", async () => {
  const input = await textFixture(boundary(ref) + boundary() + `<w:sectPr>${ref}<w:headerReference w:type="first" r:id="coast"/></w:sectPr>`, { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast")}</w:hdr>` } });
  const result = await edit(input, { section: 2, shared: true, text: "Harbor" });
  expect(result.data.affectedSections).toEqual([1, 2, 3]);
  expect(new TextDecoder().decode(result.archive.members.find(m => m.name === "word/coast.xml")!.bytes)).toContain("Harbor");
});

it.each(["headers", "footers"] as const)("creates all %s variants and deletes an initial definition without removing later owners", async kind => {
  for (const variant of ["default", "first", "even"] as const) {
    const created = await edit(await textFixture(boundary() + '<w:sectPr/>'), { section: 1, variant, linkToPrevious: false, text: "Tide" }, `${kind}.set`);
    expect(created.sections[0]![kind][variant].part).not.toBeNull();
    expect(created.sections[1]![kind][variant].part).not.toBe(created.sections[0]![kind][variant].part);
    const removed = await edit(created.bytes, { section: 1, variant }, `${kind}.remove`);
    expect(removed.sections[0]![kind][variant].part).toBeNull();
    const deletedPart = created.sections[0]![kind][variant].part!.slice(1);
    expect(removed.archive.members.some(m => m.name === deletedPart)).toBe(false);
  }
});

it("copies story-relative image and external relationships while retaining media used elsewhere", async () => {
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const picture = `<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${r}" r:embed="pixel"/></w:drawing></w:r></w:p>`;
  const bytes = await textFixture(boundary(ref) + picture + '<w:sectPr/>', { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast")}${picture}</w:hdr>` } });
  const archive = await docx.readArchive(bytes, textContext);
  const rels = `<Relationship Id="pixel" Type="${r}/image" Target="media/pixel.bmp"/>`;
  const members = archive.members.map(m => {
    if (m.name === "[Content_Types].xml") {
      const xml = new docx.DocumentXmlEditor(m.bytes);
      xml.insertChildren(xml.root, '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bmp" ContentType="image/bmp"/>');
      return { ...m, bytes: xml.serialize() };
    }
    if (m.name === "word/_rels/document.xml.rels") {
      const xml = new docx.DocumentXmlEditor(m.bytes);
      xml.insertChildren(xml.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="pixel" Type="${r}/image" Target="media/pixel.bmp"/>`);
      return { ...m, bytes: xml.serialize() };
    }
    return m;
  });
  const outgoing = new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="link" Type="${r}/hyperlink" Target="https://example.invalid/tide" TargetMode="External"/></Relationships>`);
  members.push({ name: "word/_rels/coast.xml.rels", bytes: outgoing, directory: false, modified: new Date(0) }, { name: "word/media/pixel.bmp", bytes: technicalBitmap(), directory: false, modified: new Date(0) });
  const volume = Volume.fromJSON({ "/in": "" });
  await docx.writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/in", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/in") as Buffer);
  const local = await edit(input, { section: 2, linkToPrevious: false });
  const parts = readPackage(local.bytes);
  assertPackageLinks(parts);
  expect(parts.get("word/_rels/header1.xml.rels")).toEqual(outgoing);
  expect(parts.get("word/media/pixel.bmp")).toEqual(technicalBitmap());
  const locations = await docx.openDocumentLocations(local.bytes, textContext);
  const image = locations.at("image", 1, { scope: "headers", section: 2 });
  expect(locations.references(image.token).map(r => r.section)).toEqual([2]);
  expect(locations.sharedImages(image.token)).toHaveLength(3);
  const removed = await edit(local.bytes, { section: 2 }, "headers.remove");
  const after = readPackage(removed.bytes);
  assertPackageLinks(after);
  expect(after.has("word/_rels/header1.xml.rels")).toBe(false);
  expect(after.get("word/media/pixel.bmp")).toEqual(technicalBitmap());
  expect(after.get("word/_rels/coast.xml.rels")).toEqual(outgoing);
});

it("keeps no-op linkage unchanged and enforces invocation limits before publication", async () => {
  const input = await textFixture(boundary() + '<w:sectPr/>');
  const result = await edit(input, { section: 2, linkToPrevious: true });
  expect(result.data).toMatchObject({ changed: false, changes: [], affectedSections: [] });
  expect(result.archive.members.map(m => m.name)).toEqual((await docx.readArchive(input, textContext)).members.map(m => m.name));
  await expect(docx.inspectDocumentStories(input, { operation: "headers.list", options: { limit: [{ name: "matches", value: 1 }] } }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(edit(input, { section: 1, linkToPrevious: false, limit: [{ name: "serializedOutput", value: 10 }] })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("rejects a story token whose variant does not identify that story", async () => {
  const input = await shared();
  const local = await edit(input, { section: 2, linkToPrevious: false });
  const story = (await docx.openDocumentLocations(local.bytes, textContext)).at("story", 1, { scope: "headers", section: 2 });
  await expect(docx.inspectDocumentStories(local.bytes, { operation: "headers.get", options: { select: story.token, variant: "first" } }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
});

it("does not count a same-text assignment as a changed story", async () => {
  const input = await textFixture(paragraph("Body") + `<w:sectPr>${ref}</w:sectPr>`, { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast")}</w:hdr>` } });
  const result = await edit(input, { section: 1, text: "Coast" });
  expect(result.data.changed).toBe(false);
  expect(result.archive.members.find(m => m.name === "word/coast.xml")!.bytes).toEqual((await docx.readArchive(input, textContext)).members.find(m => m.name === "word/coast.xml")!.bytes);
});

it("keeps shared-edit result locations on implicit final section owners", async () => {
  const input = await textFixture(boundary(ref) + paragraph("Body"), { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast")}</w:hdr>` } });
  const result = await edit(input, { section: 1, shared: true, text: "Harbor" });
  expect(result.data.changes.map(c => c.after.value.path)).toEqual(result.sections.map(s => s.location.value.path));
});

it("preserves paragraph annotations during story text assignment and rejects cross-paragraph marker loss", async () => {
  const start = '<w:bookmarkStart w:id="4" w:name="TideMark"/>', end = '<w:bookmarkEnd w:id="4"/>';
  const content = `<w:p><!--retain--><w:pPr><w:keepNext/></w:pPr>${start}<w:r><w:t>Coast</w:t></w:r>${end}</w:p>`;
  const input = await textFixture(`<w:sectPr>${ref}</w:sectPr>`, { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${content}</w:hdr>` } });
  const result = await edit(input, { section: 1, text: "Harbor" });
  const xml = new TextDecoder().decode(result.archive.members.find(m => m.name === "word/coast.xml")!.bytes);
  for (const value of [start, end, '<!--retain-->', '<w:keepNext/>']) expect(xml).toContain(value);
  const crossing = await textFixture(`<w:sectPr>${ref}</w:sectPr>`, { coast: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p>${start}</w:p><w:p>${end}</w:p></w:hdr>` } });
  await expect(edit(crossing, { section: 1, text: "Harbor" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("relinks a local definition and removes only its unreferenced part", async () => {
  const local = await edit(await shared(), { section: 2, linkToPrevious: false });
  const result = await edit(local.bytes, { section: 2, linkToPrevious: true });
  expect(result.sections[1]!.headers.default).toMatchObject({ linkedToPrevious: true, part: "/word/coast.xml" });
  expect(result.archive.members.some(m => m.name === "word/header1.xml")).toBe(false);
  expect(result.archive.members.some(m => m.name === "word/coast.xml")).toBe(true);
});

it("rejects conflicting intent, initial linking, stale tokens and field-destructive text before publication", async () => {
  const input = await shared();
  const source = input.slice();
  const volume = Volume.fromJSON({ "/out": "unchanged" });
  for (const [options, code] of [
    [{ section: 1, linkToPrevious: true }, "usage"],
    [{ section: 2, linkToPrevious: true, text: "X" }, "usage"],
    [{ section: 2, linkToPrevious: false, shared: true }, "usage"],
    [{ section: 2, linkToPrevious: false, text: "X" }, "unsupported-edit"]
  ] as const) {
    await expect(docx.editDocumentStories(input, { operation: "headers.set", options: { output: "-", ...options } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code });
  }
  expect(input).toEqual(source);
  expect(volume.readFileSync("/out", "utf8")).toBe("unchanged");
  const token = (await docx.inspectDocumentSections(input, {}, textContext)).items[1]!.location.token;
  await expect(edit(await textFixture(paragraph("Other")), { select: token, linkToPrevious: false })).rejects.toMatchObject({ code: "stale-selection" });
});

it("reuses scoped paragraph and text operations after localizing a rich story", async () => {
  const local = await edit(await shared(), { section: 2, linkToPrevious: false });
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.replaceDocumentText(local.bytes, { scope: "headers", section: 2, find: "Tide", with: "Current", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await docx.inspectDocumentStories(bytes, { operation: "headers.get", options: { section: 2 } }, textContext)).items[0]!.text).toBe("Coast report\nCurrent\n7");
  expect((await docx.inspectDocumentStories(bytes, { operation: "headers.get", options: { section: 1 } }, textContext)).items[0]!.text).toBe("Coast report\nTide\n7");
});
