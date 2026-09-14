import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { technicalBitmap } from "../tests/fixtures/documents.js";

const ref = (id: number, kind = "footnote") => `<w:r><w:${kind}Reference w:id="${id}"/></w:r>`;
const note = (id: number, text: string, kind = "footnote") => `<w:${kind} w:id="${id}"><w:p><w:r><w:${kind}Ref/></w:r>${run(text)}</w:p></w:${kind}>`;
const separators = (kind = "footnote") => `<w:${kind} w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;
const story = (xml: string, kind = "footnote") => ({ kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}">${xml}</w:${kind}s>` });
async function edit(input: Uint8Array, operation: "notes.add" | "notes.set" | "notes.remove", options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentNotes(input, { operation, options: { output: "-", ...options } } as docx.NoteEditRequest,
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const archive = await docx.readDocumentArchive(bytes, textContext);
  const xml = (name: string) => new TextDecoder().decode(archive.members.find(m => m.name === name)!.bytes);
  return { data, bytes, archive, xml };
}
const inspect = (input: Uint8Array, options = {}) => docx.inspectDocumentNotes(input, { operation: "notes.list", options }, textContext);

it.each([false, true])("inserts footnotes and endnotes with independent reserved IDs (%s)", async strict => {
  const original = await textFixture(paragraph("Observation"), {}, strict);
  const a = await edit(original, "notes.add", { paragraph: 1, kind: "footnote", text: "Tidal record" });
  const b = await edit(a.bytes, "notes.add", { paragraph: 1, kind: "endnote", text: "Source record" });
  const read = await inspect(b.bytes);
  expect(read.items.map(n => [n.kind, n.id, n.text, n.references.length])).toEqual([["footnote", 1, "Tidal record", 1], ["endnote", 1, "Source record", 1]]);
  expect(read.separators.map(n => [n.kind, n.id, n.type])).toEqual([["footnote", -1, "separator"], ["footnote", 0, "continuationSeparator"], ["endnote", -1, "separator"], ["endnote", 0, "continuationSeparator"]]);
  expect((await docx.extractDocumentText(b.bytes, textContext)).text).toBe("Observation");
  expect(a.data.changes[0]!.after?.value.generation).toBe(1);
  expect((await docx.inspectDocumentNotes(b.bytes, { operation: "notes.get", options: { note: 1, kind: "endnote" } }, textContext)).items[0]!.text).toBe("Source record");
});

it("edits marker-bearing note text and preserves unchanged package parts", async () => {
  const input = await textFixture(`<w:p>${run("Observation")}${ref(7)}</w:p>`, { footnotes: story(separators() + note(7, "Old")) });
  const result = await edit(input, "notes.set", { note: 1, text: "New\t🌊\nentry" });
  expect((await inspect(result.bytes)).items[0]!.text).toBe("New\t🌊\nentry");
  expect(result.xml("word/footnotes.xml")).toContain("footnoteRef");
  expect(result.xml("word/footnotes.xml")).toContain(separators());
  const before = await docx.readDocumentArchive(input, textContext);
  for (const member of before.members.filter(m => m.name !== "word/footnotes.xml")) expect(result.archive.members.find(m => m.name === member.name)!.bytes).toEqual(member.bytes);
});

it("removes one shared reference without deleting its body then removes the last", async () => {
  const input = await textFixture(`<w:p>${ref(8)}${run(" and ")}${ref(8)}</w:p>`, { footnotes: story(separators() + note(8, "Shared survey")) });
  await expect(edit(input, "notes.remove", { note: 1 })).rejects.toMatchObject({ code: "ambiguous-selection" });
  await expect(edit(input, "notes.set", { note: 1, text: "Changed" })).rejects.toMatchObject({ code: "ambiguous-selection" });
  const first = await edit(input, "notes.remove", { note: 1, reference: 1 });
  expect((await inspect(first.bytes)).items[0]).toMatchObject({ id: 8, text: "Shared survey" });
  expect((await inspect(first.bytes)).items[0]!.references).toHaveLength(1);
  const last = await edit(first.bytes, "notes.remove", { note: 1 });
  expect((await inspect(last.bytes)).items).toEqual([]);
  expect(last.xml("word/footnotes.xml")).toContain(separators());
  expect(last.data.changes[0]!.after).toBeNull();
});

it("preserves IDs by default and explicitly remaps document-order IDs and all references", async () => {
  const input = await textFixture(`<w:p>${ref(9)}${ref(3)}${ref(9)}</w:p>`, { footnotes: story(separators() + note(3, "Earlier ID") + note(9, "First reference")) });
  const retained = await edit(input, "notes.add", { kind: "footnote", paragraph: 1, text: "Last" });
  expect((await inspect(retained.bytes)).items.map(n => n.id)).toEqual([1, 3, 9]);
  const compact = await edit(input, "notes.add", { kind: "footnote", paragraph: 1, text: "Last", renumber: "document-order" });
  expect((await inspect(compact.bytes)).items.map(n => [n.id, n.text, n.references.length])).toEqual([[1, "First reference", 2], [2, "Earlier ID", 1], [3, "Last", 1]]);
  expect(compact.xml("word/footnotes.xml")).toContain(separators());
});

it.each([
  separators() + note(2, "A") + note(2, "B"),
  separators() + '<w:footnote><w:p/></w:footnote>',
  separators() + note(4, "Other"),
])("rejects duplicate, missing or unresolved IDs before publication (%s)", async content => {
  const input = await textFixture(`<w:p>${ref(2)}</w:p>`, { footnotes: story(content) });
  await expect(edit(input, "notes.remove", { note: 1 })).rejects.toMatchObject({ code: "invalid-package" });
});

it("preserves document and section numbering/restart properties", async () => {
  const props = '<w:footnotePr><w:numFmt w:val="lowerRoman"/><w:numStart w:val="4"/><w:numRestart w:val="eachSect"/></w:footnotePr>';
  const local = '<w:sectPr><w:footnotePr><w:numStart w:val="7"/><w:numRestart w:val="eachPage"/></w:footnotePr></w:sectPr>';
  const input = await textFixture(`<w:p>${ref(2)}</w:p>${local}`, { footnotes: story(separators() + note(2, "Note")), settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}">${props}</w:settings>` } });
  const result = await edit(input, "notes.add", { kind: "footnote", paragraph: 1, text: "Next", renumber: "document-order" });
  expect(result.xml("word/settings.xml")).toContain(props);
  expect(result.xml("word/document.xml")).toContain(local);
  expect((await inspect(result.bytes)).numbering).toMatchObject({ document: { footnote: { format: "lowerRoman", start: 4, restart: "eachSect" } }, sections: [{ section: 1, footnote: { format: "lowerRoman", start: 7, restart: "eachPage" } }] });
});

it("reads rich note bodies and reuses scoped text editing without discarding blocks", async () => {
  const body = `<w:footnote w:id="6">${paragraph("Opening")}${table([paragraph("Table entry")])}${paragraph("Closing")}</w:footnote>`;
  const input = await textFixture(`<w:p>${ref(6)}</w:p>`, { footnotes: story(separators() + body) });
  expect((await inspect(input)).items[0]!.text).toBe("Opening\nTable entry\nClosing");
  await expect(edit(input, "notes.set", { note: 1, text: "Would discard table" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const volume = Volume.fromJSON({ "/output": "" });
  await docx.replaceDocumentText(input, { scope: "footnotes", note: 1, find: "entry", with: "record", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/output", b); } } });
  expect((await inspect(new Uint8Array(volume.readFileSync("/output") as Buffer))).items[0]!.text).toBe("Opening\nTable record\nClosing");
});

it("replaces a multi-paragraph text body without leaving extra empty paragraphs", async () => {
  const input = await textFixture(`<w:p>${ref(2)}</w:p>`, { footnotes: story(separators() + `<w:footnote w:id="2">${paragraph("First")}${paragraph("Second")}</w:footnote>`) });
  const result = await edit(input, "notes.set", { note: 1, text: "Combined" });
  expect((await inspect(result.bytes)).items[0]!.text).toBe("Combined");
});

it("supports explicit shared edits and removal of all references", async () => {
  const input = await textFixture(`<w:p>${ref(2)}${ref(2)}</w:p>`, { footnotes: story(separators() + note(2, "Common")) });
  const changed = await edit(input, "notes.set", { note: 1, text: "Revised", shared: true });
  expect((await inspect(changed.bytes)).items[0]).toMatchObject({ text: "Revised" });
  const removed = await edit(changed.bytes, "notes.remove", { note: 1, references: "all" });
  expect((await inspect(removed.bytes)).items).toEqual([]);
});

it("uses separator types and preserves continuation notices and conventional-ID collisions", async () => {
  const special = '<w:footnote w:id="4" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="5" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="6" w:type="continuationNotice">' + paragraph("Continued on following sheet") + '</w:footnote>';
  const input = await textFixture(`<w:p>${ref(0)}${ref(8)}</w:p>`, { footnotes: story(special + note(0, "Zero ID") + note(8, "Next ID")) });
  const result = await edit(input, "notes.remove", { note: 1, renumber: "document-order" });
  expect(result.xml("word/footnotes.xml")).toContain(special);
  expect((await inspect(result.bytes)).items.map(n => [n.id, n.text])).toEqual([[1, "Next ID"]]);
});

it("repairs absent special entries without reusing an existing normal zero ID", async () => {
  const input = await textFixture(`<w:p>${ref(0)}</w:p>`, { footnotes: story(note(0, "Imported zero")) });
  const result = await edit(input, "notes.add", { kind: "footnote", paragraph: 1, text: "Added" });
  const read = await inspect(result.bytes);
  expect(read.items.map(n => [n.id, n.text])).toEqual([[0, "Imported zero"], [1, "Added"]]);
  expect(read.separators.map(n => [n.id, n.type])).toEqual([[-1, "separator"], [2, "continuationSeparator"]]);
});

it("removes a selected reference token while retaining inactive-branch ownership", async () => {
  const hidden = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:unhandled"><mc:Choice Requires="x">${ref(2)}</mc:Choice><mc:Fallback>${run("Fallback")}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p>${ref(2)}${hidden}</w:p>`, { footnotes: story(separators() + note(2, "Retained")) });
  const read = await inspect(input);
  const result = await edit(input, "notes.remove", { select: read.items[0]!.references[0]!.token });
  expect(result.xml("word/document.xml")).toContain(hidden);
  expect((await inspect(result.bytes)).items[0]!.text).toBe("Retained");
  await expect(edit(input, "notes.add", { kind: "footnote", paragraph: 1, renumber: "document-order" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("retains independently bookmarked note content when its last note reference is removed", async () => {
  const content = '<w:footnote w:id="3"><w:p><w:bookmarkStart w:id="1" w:name="Record"/>' + run("Referenced record") + '<w:bookmarkEnd w:id="1"/></w:p></w:footnote>';
  const input = await textFixture(`<w:p>${ref(3)}<w:hyperlink w:anchor="Record">${run("Jump")}</w:hyperlink></w:p>`, { footnotes: story(separators() + content) });
  const result = await edit(input, "notes.remove", { note: 1 });
  expect(result.xml("word/footnotes.xml")).toContain(content);
  expect((await inspect(result.bytes)).items[0]!.references).toEqual([]);
});

it("keeps note images and relationships through scoped edits and deletion", async () => {
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const drawing = `<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${r}" r:embed="tile"/></w:drawing></w:r></w:p>`;
  const source = await textFixture(`<w:p>${ref(2)}${ref(3)}</w:p>`, { footnotes: story(separators() + `<w:footnote w:id="2">${paragraph("Photo record")}${table([paragraph("Caption")])}${drawing}</w:footnote>` + note(3, "Second")) });
  const archive = await docx.readArchive(source, textContext);
  const types = new docx.DocumentXmlEditor(archive.members.find(m => m.name === "[Content_Types].xml")!.bytes);
  types.insertChildren(types.root, '<Default xmlns="http://schemas.openxmlformats.org/package/2006/content-types" Extension="bmp" ContentType="image/bmp"/>');
  const outgoing = new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="tile" Type="${r}/image" Target="media/tile.bmp"/></Relationships>`);
  const volume = Volume.fromJSON({ "/input": "", "/output": "" });
  await docx.writeArchive({ ...archive, members: [...archive.members.map(m => m.name === "[Content_Types].xml" ? { ...m, bytes: types.serialize() } : m),
    { name: "word/_rels/footnotes.xml.rels", bytes: outgoing, directory: false, modified: new Date(0) },
    { name: "word/media/tile.bmp", bytes: technicalBitmap(), directory: false, modified: new Date(0) }] }, { async write(b) { volume.appendFileSync("/input", b); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  expect((await inspect(input)).items[0]!.text).toContain("Photo record\nCaption");
  await docx.replaceDocumentText(input, { scope: "footnotes", note: 1, find: "record", with: "survey", all: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/output", b); } } });
  const changed = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const removed = await edit(changed, "notes.remove", { note: 1 });
  expect(removed.archive.members.find(m => m.name === "word/media/tile.bmp")!.bytes).toEqual(technicalBitmap());
  expect(removed.archive.members.find(m => m.name === "word/_rels/footnotes.xml.rels")!.bytes).toEqual(outgoing);
  expect((await inspect(removed.bytes)).items[0]!.text).toBe("Second");
});

it("addresses each note reference separately even when two share a run", async () => {
  const input = await textFixture('<w:p><w:r><w:footnoteReference w:id="2"/><w:footnoteReference w:id="2"/></w:r></w:p>', { footnotes: story(separators() + note(2, "Shared run")) });
  const references = (await inspect(input)).items[0]!.references;
  expect(new Set(references.map(r => r.token)).size).toBe(2);
  const result = await edit(input, "notes.remove", { select: references[1]!.token });
  expect((await inspect(result.bytes)).items[0]!.references).toHaveLength(1);
});

it("rejects insertion inside a spanning complex field", async () => {
  const body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> IF 1 = 1 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p><w:p/><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const input = await textFixture(body);
  await expect(edit(input, "notes.add", { kind: "footnote", paragraph: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("reuses paragraph and table insertion in an existing note story", async () => {
  const input = await textFixture(`<w:p>${ref(2)}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr>`, { footnotes: story(separators() + note(2, "Opening")) });
  const volume = Volume.fromJSON({ "/paragraph": "", "/table": "" });
  const context = (path: string) => ({ ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(b: Uint8Array) { volume.appendFileSync(path, b); } } });
  await docx.editDocumentParagraphs(input, { operation: "paragraphs.add", options: { scope: "footnotes", note: 1, text: "Details", output: "-" } }, context("/paragraph"));
  const more = new Uint8Array(volume.readFileSync("/paragraph") as Buffer);
  expect((await inspect(more)).items[0]!.text).toBe("Opening\nDetails");
  await docx.editDocumentTables(more, { operation: "tables.add", options: { scope: "footnotes", note: 1, rows: 1, cols: 1, width: { value: 2, unit: "in" }, output: "-" } }, context("/table"));
  const result = new Uint8Array(volume.readFileSync("/table") as Buffer);
  expect((await docx.openDocumentLocations(result, textContext)).list("table", { scope: "footnotes" })).toHaveLength(1);
});

it("retains addressable after-locations for imported integer lexical forms", async () => {
  const input = await textFixture('<w:p><w:r><w:footnoteReference w:id="02"/></w:r></w:p>', { footnotes: story(separators() + '<w:footnote w:id="02">' + paragraph("Imported") + '</w:footnote>') });
  const result = await edit(input, "notes.set", { note: 1, text: "Revised" });
  expect(result.data.changes[0]!.after?.value.story).toBe('/word/footnotes.xml#footnote:02');
});

it("uses admitted option values across asynchronous acquisition", async () => {
  const input = await textFixture(`<w:p>${ref(2)}</w:p>`, { footnotes: story(separators() + note(2, "Original")) });
  const volume = Volume.fromJSON({ "/output": "" });
  const options = { note: 1, text: "Admitted", output: "-" };
  const pending = docx.editDocumentNotes(input, { operation: "notes.set", options }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(b) { volume.appendFileSync("/output", b); } } });
  options.text = "Changed after admission";
  await pending;
  expect((await inspect(new Uint8Array(volume.readFileSync("/output") as Buffer))).items[0]!.text).toBe("Admitted");
});

it("rejects whole-note assignment when a hyperlink owns the note marker", async () => {
  const content = '<w:footnote w:id="2"><w:p><w:hyperlink w:anchor="Target"><w:r><w:footnoteRef/></w:r></w:hyperlink>' + run("Linked marker") + '</w:p></w:footnote>';
  const input = await textFixture(`<w:p>${ref(2)}</w:p>`, { footnotes: story(separators() + content) });
  await expect(edit(input, "notes.set", { note: 1, text: "Revised" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
