import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";

const editContext: docx.PublicationContext = { ...textContext, encoding: { order: "input", compression: "store" } };
const timestamp = "2026-01-02T03:04:05Z";
async function edit(bytes: Uint8Array, action: "add" | "set" | "remove", options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/out": "", "/err": "" });
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["comments", action, "/input.docx", "--output", "-", ...Object.entries(options).flatMap(([k, v]) => ["--" + k, String(v)])].map(s => new TextEncoder().encode(s)),
    cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(b) { volume.appendFileSync("/out", b); } }, stderr: { async write(b) { volume.appendFileSync("/err", b); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8").toString()).toBe(0);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
async function range(bytes: Uint8Array, start: number, end: number, ordinal = 1) {
  const document = await docx.openDocumentLocations(bytes, textContext);
  return document.range(document.at("paragraph", ordinal).token, start, end).token;
}
const read = (bytes: Uint8Array, options = {}) => docx.inspectDocumentComments(bytes, { operation: "comments.list", options }, textContext);
const body = (text = "Review current wording", id = 4) => `<w:comment w:id="${id}" w:author="Mira" w:initials="MR" w:date="${timestamp}">${paragraph(text)}</w:comment>`;
const stories = (xml: string) => ({ comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}">${xml}</w:comments>` } });
const markers = (text: string, id = 4) => `<w:commentRangeStart w:id="${id}"/>${run(text)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
async function xml(bytes: Uint8Array, name = "word/document.xml") {
  return new TextDecoder().decode((await docx.readDocumentArchive(bytes, textContext)).members.find(m => m.name === name)!.bytes);
}

it.each([false, true])("creates multi-run comments in table cells with explicit identity (%s)", async strict => {
  const input = await textFixture(table([`<w:p>${run("Ocean 🌊")}${run(" survey")}</w:p>`]), {}, strict);
  const output = await edit(input, "add", { select: await range(input, 0, 14), author: "Mira", initials: "MR", timestamp, text: "Check\tdepth\nTomorrow" });
  expect((await docx.extractDocumentText(output, textContext)).text).toBe((await docx.extractDocumentText(input, textContext)).text);
  expect((await read(output)).items).toMatchObject([{ comment_id: 0, author: "Mira", initials: "MR", timestamp, text: "Check\tdepth\nTomorrow", issues: [], range: { start: { part: "/word/document.xml" }, end: { part: "/word/document.xml" } } }]);
  expect(await xml(output)).toContain("commentReference");
  expect(await xml(output, "[Content_Types].xml")).toContain("wordprocessingml.comments+xml");
  expect(await xml(output, "word/_rels/document.xml.rels")).toContain("/comments");
});

it("edits and deletes one of multiple comments while preserving unrelated annotations exactly", async () => {
  const other = body("Unselected note", 9);
  const annotations = '<w:bookmarkStart w:id="1" w:name="First"/>' + run("Ocean") + '<w:bookmarkStart w:id="2" w:name="Second"/>' + run(" bay") + '<w:bookmarkEnd w:id="1"/>' + run(" shore") + '<w:bookmarkEnd w:id="2"/><!--retained-->';
  const input = await textFixture(`<w:p>${annotations}</w:p><w:p>${markers("Other", 9)}</w:p>`, stories(other));
  const added = await edit(input, "add", { select: await range(input, 0, 9), author: "", timestamp });
  const items = (await read(added)).items;
  expect(items).toHaveLength(2);
  const changed = await edit(added, "set", { select: items[0]!.location.token, text: "Updated note" });
  expect(await xml(changed)).toBe(await xml(added));
  expect(await xml(changed, "word/comments.xml")).toContain(other);
  const removed = await edit(changed, "remove", { comment: 1 });
  expect(await xml(removed)).toBe(await xml(input));
  expect(await xml(removed, "word/comments.xml")).toContain(other);
  expect((await read(removed)).items).toMatchObject([{ comment_id: 9, text: "Unselected note" }]);
});

it("rejects partial runs, nested comments and stale anchors without publishing", async () => {
  const input = await textFixture(`<w:p>${run("Ocean")}${run(" bay")}</w:p>`);
  const select = await range(input, 0, 9);
  const output = await edit(input, "add", { select, author: "", timestamp });
  for (const [bytes, token] of [[input, await range(input, 1, 9)], [output, await range(output, 0, 9)], [output, select]] as const) {
    const volume = Volume.fromJSON({ "/out": "" });
    await expect(docx.editDocumentComments(bytes, { operation: "comments.add", options: { select: token, author: "", timestamp, output: "-" } }, { ...editContext, stdout: { async write(b) { volume.appendFileSync("/out", b); } } })).rejects.toBeDefined();
    expect(volume.readFileSync("/out").length).toBe(0);
  }
});

it.each([
  ["", "deleted-anchor"],
  ['<w:commentRangeStart w:id="4"/>', "inconsistent-range"],
  [markers("Ocean", 5), "missing-body"]
])("reports range/body consistency after deleted or broken anchors (%s)", async (content, issue) => {
  const input = await textFixture(`<w:p>${content}${run("Visible")}</w:p>`, stories(body()));
  if (issue === "deleted-anchor") {
    expect((await read(input)).issues).toContain(issue);
    expect((await docx.extractDocumentText(input, textContext)).text).not.toContain("Review current wording");
  } else await expect(read(input)).rejects.toMatchObject({ code: "invalid-package" });
});

it("removes a deleted-anchor body without altering visible content", async () => {
  const input = await textFixture(paragraph("Visible"), stories(body()));
  const removed = await edit(input, "remove", { comment: 1 });
  expect((await read(removed)).items).toEqual([]);
  expect(await xml(removed)).toBe(await xml(input));
});

it("declares comment schema, capabilities, metadata defaults and errors", async () => {
  const discovery = (...args: string[]) => docx.getDocxDiscovery(docx.parseDocxArguments(args.map(s => new TextEncoder().encode(s))))!;
  for (const action of ["list", "get", "add", "set", "remove"]) expect(discovery("schema", "comments", action).data).toMatchObject({ operations: [{ id: `comments.${action}`, support: ["list", "get"].includes(action) ? "read" : "edit" }] });
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F25", level: "edit" })]) });
  expect(discovery("help", "comments", "get").human).not.toContain("--run");
  expect(discovery("help", "comments", "get").human).toContain("Scope defaults to comments");
  expect(discovery("help", "comments", "get").human).not.toContain("body|headers");
  expect(discovery("help", "comments", "add").human).not.toContain("--paragraph");
  const input = await textFixture(paragraph("Ocean"));
  const select = await range(input, 0, 5);
  const output = await edit(input, "add", { select, author: "", timestamp });
  expect((await read(output)).items[0]).toMatchObject({ author: "", initials: "", text: "" });
  await expect(docx.editDocumentComments(input, { operation: "comments.add", options: { select, author: "", timestamp, text: null, dryRun: true } } as unknown as docx.CommentEditRequest, editContext)).rejects.toBeDefined();
});

it("preserves explicit null initials, returns fresh staged locations and supports all removal", async () => {
  const input = await textFixture(paragraph("Ocean"));
  const volume = Volume.fromJSON({ "/out": "" });
  const result = await docx.editDocumentComments(input, { operation: "comments.add", options: { select: await range(input, 0, 5), author: "", initials: null, timestamp, output: "-" } },
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/out", b); } } });
  expect(result.changes[0]!.after!.value.generation).toBe(1);
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await read(bytes)).items[0]!.initials).toBeNull();
  expect(await xml(bytes, (await read(bytes)).items[0]!.location.value.part.slice(1))).not.toContain("initials=");
  const two = await textFixture(`<w:p>${markers("Ocean")}</w:p><w:p>${markers("Bay", 9)}</w:p>`, stories(body() + body("Second", 9)));
  const all = await docx.editDocumentComments(two, { operation: "comments.remove", options: { all: true, dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } });
  expect(all.changes).toHaveLength(2);
  expect(all.changes.every(c => c.after === null)).toBe(true);
});

it("preserves reference-run neighbors and detects missing reference markers", async () => {
  const input = await textFixture(`<w:p><w:commentRangeStart w:id="4"/>${run("Ocean")}<w:commentRangeEnd w:id="4"/><w:r><!--keep--><w:commentReference w:id="4"/><w:t> shore</w:t></w:r></w:p>`, stories(body()));
  const output = await edit(input, "remove", { comment: 1 });
  expect(await xml(output)).toContain('<w:r><!--keep--><w:t> shore</w:t></w:r>');
  const missing = await textFixture(`<w:p><w:commentRangeStart w:id="4"/>${run("Ocean")}<w:commentRangeEnd w:id="4"/></w:p>`, stories(body()));
  expect((await read(missing)).items[0]!.issues).toContain("inconsistent-range");
  await expect(docx.editDocumentComments(missing, { operation: "comments.remove", options: { comment: 1, dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("preserves modern metadata exactly on reads and rejects its comment mutations", async () => {
  const metadata = '<cx:commentsEx xmlns:cx="http://schemas.microsoft.com/office/word/2012/wordml"><cx:commentEx cx:paraId="AABBCCDD" cx:done="1"/></cx:commentsEx>';
  const base = await textFixture(`<w:p>${markers("Ocean")}</w:p>`, { ...stories(body()), modern: { kind: "commentsExtended", xml: metadata } });
  const archive = await docx.readArchive(base, textContext);
  const types = archive.members.find(m => m.name === "[Content_Types].xml")!;
  const editor = new docx.DocumentXmlEditor(types.bytes);
  const declaration = editor.root.children.find(n => n.attributes.some(a => a.localName === "PartName" && a.value === "/word/modern.xml"))!;
  editor.setAttribute(declaration, "ContentType", "application/vnd.ms-word.commentsExtended+xml");
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.writeArchive({ ...archive, members: archive.members.map(m => m === types ? { ...m, bytes: editor.serialize() } : m) }, { async write(b) { volume.appendFileSync("/out", b); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect((await read(input)).modern).toBe("preserve");
  expect(await xml(input, "word/modern.xml")).toBe(metadata);
  await expect(docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Changed", dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("adds disjoint comments in the same paragraph and preserves both references", async () => {
  const input = await textFixture(`<w:p>${markers("Ocean")}${run(" bay")}${run(" shore")}</w:p>`, stories(body()));
  const output = await edit(input, "add", { select: await range(input, 5, 15), author: "Noah", timestamp, text: "Second comment" });
  expect((await read(output)).items.map(n => n.comment_id)).toEqual([0, 4]);
  expect(await xml(output)).toContain(markers("Ocean"));
  await expect(docx.editDocumentComments(output, { operation: "comments.add", options: { select: await range(output, 0, 15), author: "", timestamp, dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects field boundaries across paragraphs and preserves unrelated cached fields", async () => {
  const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const input = await textFixture(`<w:p>${begin}</w:p>${paragraph("Ocean")}<w:p>${end}</w:p>`);
  await expect(docx.editDocumentComments(input, { operation: "comments.add", options: { select: await range(input, 0, 5, 2), author: "", timestamp, dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
  const field = `<w:p>${begin}${run("7")}${end}</w:p>`;
  const outside = await textFixture(field + paragraph("Ocean"));
  const output = await edit(outside, "add", { select: await range(outside, 0, 5, 2), author: "", timestamp });
  expect(await xml(output)).toContain(field);
});

it("keeps rich bodies readable and rejects removal of independently owned annotations", async () => {
  const rich = `<w:comment w:id="4" w:author="Mira">${paragraph("Notes")}${table([paragraph("Depth")])}</w:comment>`;
  const input = await textFixture(`<w:p>${markers("Ocean")}</w:p>`, stories(rich));
  expect((await read(input)).items[0]!.text).toContain("Depth");
  await expect(docx.editDocumentComments(input, { operation: "comments.set", options: { comment: 1, text: "Discard", dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
  const annotated = await textFixture(`<w:p>${markers("Ocean")}</w:p>`, stories('<w:comment w:id="4" w:author="Mira"><w:p><w:bookmarkStart w:id="7" w:name="Keep"/>' + run("Note") + '<w:bookmarkEnd w:id="7"/></w:p></w:comment>'));
  await expect(docx.editDocumentComments(annotated, { operation: "comments.remove", options: { comment: 1, dryRun: true } }, editContext)).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("replaces a plain multi-paragraph body and preserves metadata", async () => {
  const input = await textFixture(`<w:p>${markers("Ocean")}</w:p>`, stories(`<w:comment w:id="4" w:author="Mira" w:date="${timestamp}">${paragraph("First thought")}${paragraph("Second thought")}</w:comment>`));
  const output = await edit(input, "set", { comment: 1, text: "Final thought" });
  expect((await read(output)).items[0]).toMatchObject({ comment_id: 4, author: "Mira", timestamp, text: "Final thought" });
  expect(await xml(output)).toBe(await xml(input));
});

it("reads comment JSON through the CLI with matching SDK data and stable failure statuses", async () => {
  const bytes = await textFixture(`<w:p>${markers("Ocean")}</w:p>`, stories(body()));
  for (const action of ["list", "get"] as const) {
    const volume = Volume.fromJSON({ "/input": Buffer.from(bytes), "/out": "" });
    const options = action === "get" ? { comment: 1 } : {};
    const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["comments", action, "/input", "--json", ...(action === "get" ? ["--comment", "1"] : [])].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(b) { volume.appendFileSync("/out", b); } }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const data = await docx.inspectDocumentComments(bytes, { operation: `comments.${action}`, options }, textContext);
    expect(JSON.parse(volume.readFileSync("/out", "utf8").toString())).toMatchObject({ version: 1, operation: `comments.${action}`, ok: true, affected: 0, data, errors: [] });
  }
  for (const options of [{ author: "" }, { author: "", timestamp: "2026-02-30T00:00:00Z" }, { author: "", timestamp, extra: true }]) {
    await expect(docx.editDocumentComments(bytes, { operation: "comments.add", options: { ...options, dryRun: true } } as docx.CommentEditRequest, editContext)).rejects.toMatchObject({ code: "usage" });
  }
});
