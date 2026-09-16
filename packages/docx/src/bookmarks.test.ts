import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

const start = (id = "3", name = "Coast") => `<w:bookmarkStart w:id="${id}" w:name="${name}"/>`;
const end = (id = "3") => `<w:bookmarkEnd w:id="${id}"/>`;
const rangeBody = () => `<w:p>${start()}<w:r><w:rPr><w:b/></w:rPr><w:t>Coast</w:t></w:r>${run(" trail")}${end()}</w:p>`;
async function edit(input: Uint8Array, operation: "bookmarks.add" | "bookmarks.set" | "bookmarks.remove", options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentBookmarks(input, { operation, options: { output: "-", ...options } } as docx.BookmarkEditRequest,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const archive = await docx.readDocumentArchive(bytes, textContext);
  return { data, bytes, xml: new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes) };
}
async function selected(input: Uint8Array, from: number, to: number) {
  const document = await docx.openDocumentLocations(input, textContext);
  return document.range(document.at("paragraph", 1).token, from, to).token;
}

it.each([false, true])("creates a scalar range across styled runs inside a table (%s)", async strict => {
  const body = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A🌊Coast</w:t></w:r>${run(" trail")}</w:p>`;
  const input = await textFixture(table([body]), {}, strict);
  const result = await edit(input, "bookmarks.add", { select: await selected(input, 1, 9), name: "Coast_2" });
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toContain("A🌊Coast trail");
  const listed = await docx.inspectDocumentBookmarks(result.bytes, {}, textContext);
  expect(listed.issues).toEqual([]);
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]).toMatchObject({ name: "Coast_2", id: "0", issues: [], location: { kind: "bookmark", positions: { table: 1 } } });
  expect(listed.items[0]!.end).not.toBeNull();
  expect(result.data.changes[0]!.kind).toBe("insert");
  expect(result.xml).toContain("b/>");
});

it("renames multi-run and table ranges, updating only supported references", async () => {
  const refs = `<w:p><w:hyperlink w:anchor="Coast">${run("Jump")}</w:hyperlink><w:fldSimple w:instr=" REF Coast \\h ">${run("Cached")}</w:fldSimple><w:fldSimple w:instr=" PAGE ">${run("7")}</w:fldSimple><!--retain--></w:p>`;
  const input = await textFixture(table([rangeBody()]) + refs);
  await expect(edit(input, "bookmarks.set", { bookmark: 1, name: "Bay", references: "reject" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const result = await edit(input, "bookmarks.set", { bookmark: 1, name: "Bay", references: "update" });
  expect(result.xml).toContain('w:anchor="Bay"');
  expect(result.xml).toContain('w:instr=" REF Bay \\h "');
  expect(result.xml).toContain('<w:fldSimple w:instr=" PAGE ">' + run("7") + '</w:fldSimple><!--retain-->');
  expect((await docx.inspectDocumentBookmarks(result.bytes, {}, textContext)).items[0]!.name).toBe("Bay");
});

it("removes only markers and requires reference policy before publishing", async () => {
  const input = await textFixture(rangeBody());
  const result = await edit(input, "bookmarks.remove", { bookmark: 1, references: "reject" });
  expect(result.xml).not.toContain("bookmark");
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
  expect((await docx.extractDocumentText(result.bytes, textContext)).text).toBe("Coast trail");
  expect((await docx.inspectDocumentBookmarks(result.bytes, {}, textContext)).items).toEqual([]);
});

it.each([
  [start() + run("Unclosed"), "missing-end"],
  [end() + run("End only"), "missing-start"],
  [start() + start("3", "Bay") + end() + end(), "duplicate-id"],
  [start() + end() + start("4") + end("4"), "duplicate-name"],
  [start() + start("4", "Bay") + end() + end("4"), "crossing"],
  [start() + start("4", "Bay") + end("4") + end(), "overlap"],
  [end() + start(), "end-before-start"],
  [start("-1") + end("-1"), "invalid-id"]
])("reports broken bookmark structure (%s)", async (content, issue) => {
  const input = await textFixture(`<w:p>${content}</w:p>`);
  expect((await docx.inspectDocumentBookmarks(input, {}, textContext)).issues.join(" ")).toContain(issue);
  await expect(edit(input, "bookmarks.remove", { bookmark: 1, references: "reject" })).rejects.toBeDefined();
});

it("rejects duplicate names and stale ranges without publication", async () => {
  const input = await textFixture(rangeBody() + paragraph("New place"));
  await expect(edit(input, "bookmarks.set", { bookmark: 1, name: "Bad name", references: "update" })).rejects.toBeDefined();
  const token = (await docx.inspectDocumentBookmarks(input, {}, textContext)).items[0]!.location.token;
  const changed = await edit(input, "bookmarks.set", { bookmark: 1, name: "Bay", references: "update" });
  await expect(edit(changed.bytes, "bookmarks.remove", { select: token, references: "reject" })).rejects.toMatchObject({ code: "stale-selection" });
  const document = await docx.openDocumentLocations(input, textContext);
  const select = document.range(document.at("paragraph", 2).token, 0, 3).token;
  await expect(edit(input, "bookmarks.add", { select, name: "Coast" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("preserves annotation markers and rejects ranges through controlled or field content", async () => {
  const input = await textFixture(`<w:p><!--keep--><w:commentRangeStart w:id="8"/>${run("Coast")}${run(" walk")}<w:commentRangeEnd w:id="8"/></w:p>`, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="8" w:author="Editor">${paragraph("Retain note")}</w:comment></w:comments>` } });
  const result = await edit(input, "bookmarks.add", { select: await selected(input, 0, 5), name: "Coast" });
  expect(result.xml).toContain("<!--keep-->");
  expect(result.xml).toContain('<w:commentRangeStart w:id="8"/>');
  expect(result.xml).toContain('<w:commentRangeEnd w:id="8"/>');
  const field = await textFixture(`<w:p><w:fldSimple w:instr=" PAGE ">${run("7")}</w:fldSimple>${run(" coast")}</w:p>`);
  await expect(selected(field, 0, 2)).rejects.toMatchObject({ code: "missing-selection" });
});

it("detects illegal marker boundaries and document-wide name collisions", async () => {
  const malformed = await textFixture(`<w:p><w:r>${start()}<w:t>Coast</w:t>${end()}</w:r></w:p>`);
  expect((await docx.inspectDocumentBookmarks(malformed, {}, textContext)).issues.join(" ")).toContain("illegal-boundary");
  const input = await textFixture(rangeBody(), { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${rangeBody()}</w:hdr>` } });
  expect((await docx.inspectDocumentBookmarks(input, {}, textContext)).issues.join(" ")).toContain("duplicate-name");
});

it("allocates unused IDs and rejects new overlaps without publishing", async () => {
  const input = await textFixture(`<w:p>${start("0")}${run("Coast")}${end("0")}${run(" trail")}</w:p>`);
  await expect(edit(input, "bookmarks.add", { select: await selected(input, 1, 8), name: "Crossing" })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(edit(input, "bookmarks.add", { select: await selected(input, 1, 3), name: "Nested" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const result = await edit(input, "bookmarks.add", { select: await selected(input, 5, 11), name: "Trail" });
  expect((await docx.inspectDocumentBookmarks(result.bytes, {}, textContext)).items.map(i => [i.name, i.id])).toEqual([["Coast", "0"], ["Trail", "1"]]);
});

it("renames and removes a legal range between paragraphs in one table cell", async () => {
  const body = table([`<w:p>${start()}${run("Northern")}</w:p><w:p>${run(" shore")}${end()}</w:p>`]);
  const input = await textFixture(body);
  const renamed = await edit(input, "bookmarks.set", { table: 1, cell: "A1", bookmark: 1, name: "Northern_Shore", references: "reject" });
  expect((await docx.inspectDocumentBookmarks(renamed.bytes, {}, textContext)).items[0]!.name).toBe("Northern_Shore");
  const removed = await edit(renamed.bytes, "bookmarks.remove", { bookmark: 1, references: "reject" });
  expect(removed.xml).toContain('<w:p>' + run("Northern") + '</w:p><w:p>' + run(" shore") + '</w:p>');
});

it("unwraps supported references explicitly and retains unrelated fields and annotations", async () => {
  const refs = `<w:p><w:hyperlink w:anchor="Coast">${run("Jump")}</w:hyperlink><w:fldSimple w:instr=" PAGEREF Coast \\h ">${run("12")}<!--cached--></w:fldSimple><w:fldSimple w:instr=" PAGE ">${run("2")}</w:fldSimple></w:p>`;
  const input = await textFixture(rangeBody() + refs);
  await expect(edit(input, "bookmarks.remove", { bookmark: 1, references: "reject" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const result = await edit(input, "bookmarks.remove", { bookmark: 1, references: "remove" });
  expect(result.xml).not.toContain("Coast \\h");
  expect(result.xml).toContain(run("Jump") + run("12") + '<!--cached--><w:fldSimple w:instr=" PAGE ">');
});

it("updates split complex instructions without recalculating cached results", async () => {
  const refs = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE</w:instrText></w:r><w:r><w:instrText xml:space="preserve">REF Co</w:instrText></w:r><w:r><w:instrText xml:space="preserve">ast \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("14")}<!--preserve result--><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  const input = await textFixture(rangeBody() + refs);
  const result = await edit(input, "bookmarks.set", { bookmark: 1, name: "Bay", references: "update" });
  expect(result.xml).toContain('>REF Bay</w:instrText>');
  expect(result.xml).toContain('> \\h </w:instrText>');
  expect(result.xml).toContain(run("14") + "<!--preserve result-->");
  await expect(edit(input, "bookmarks.remove", { bookmark: 1, references: "remove" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("does not publish no-op dry runs or unsafe reference edits", async () => {
  const volume = Volume.fromJSON({ "/out": "untouched" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  const input = await textFixture(rangeBody());
  const result = await docx.editDocumentBookmarks(input, { operation: "bookmarks.set", options: { bookmark: 1, name: "Coast", references: "reject", dryRun: true } }, context);
  expect(result).toMatchObject({ changed: false, changes: [], output: null, dryRun: true });
  const unsafe = await textFixture(rangeBody() + `<w:p><w:fldSimple w:instr=" NOTEREF Coast ">${run("Stored")}</w:fldSimple></w:p>`);
  await expect(docx.editDocumentBookmarks(unsafe, { operation: "bookmarks.set", options: { bookmark: 1, name: "Bay", references: "update", output: "-" } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(volume.readFileSync("/out", "utf8")).toBe("untouched");
});

it("detects bookmark markers inside complex field instructions", async () => {
  const input = await textFixture(`<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>${start()}<w:r><w:instrText> PAGE </w:instrText></w:r>${end()}<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("4")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  expect((await docx.inspectDocumentBookmarks(input, {}, textContext)).issues.join(" ")).toContain("illegal-boundary");
  await expect(edit(input, "bookmarks.remove", { bookmark: 1, references: "reject" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("creates conventional hidden bookmark names with the same grammar as internal targets", async () => {
  const input = await textFixture(paragraph("Coastal survey"));
  const result = await edit(input, "bookmarks.add", { select: await selected(input, 0, 7), name: "_Coast_1" });
  expect((await docx.inspectDocumentBookmarks(result.bytes, {}, textContext)).items[0]!.name).toBe("_Coast_1");
});
