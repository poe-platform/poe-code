import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { run, textContext, textFixture } from "../tests/fixtures/text.js";

async function edit(input: Uint8Array, operation: string, options: Record<string, unknown>) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentFields(input, { operation, options: { ...options, output: "-" } } as docx.FieldEditRequest, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const archive = await docx.readDocumentArchive(bytes, textContext);
  return { data, bytes, xml: new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes) };
}

it.each([false, true])("creates bounded fields with separate inert instructions and caches (%s)", async strict => {
  let input = await textFixture(`<w:p>${run("Report")}</w:p>`, {}, strict);
  for (const kind of ["PAGE", "NUMPAGES", "REF", "PAGEREF", "SEQ", "TOC"]) {
    const added = await edit(input, "fields.add", { paragraph: 1, kind, ...(["REF", "PAGEREF", "SEQ"].includes(kind) ? { target: "Harbor" } : {}), result: "cached", update: true });
    input = added.bytes;
    expect(added.data.changes).toHaveLength(1);
  }
  const fields = (await docx.inspectDocumentFields(input, {}, textContext)).items;
  expect(fields.map(f => f.kind)).toEqual(["PAGE", "NUMPAGES", "REF", "PAGEREF", "SEQ", "TOC"]);
  expect(fields.every(f => f.result === "cached" && f.update)).toBe(true);
  expect(fields[2]!.instruction).toBe(' REF "Harbor" ');
});

it("creates TOCs and caption labels while preserving an existing TOC verbatim", async () => {
  const retained = '<w:fldSimple w:instr=" TOC \\o &quot;1-4&quot; "><w:r><w:t>Existing contents 12</w:t></w:r></w:fldSimple>';
  const input = await textFixture(`<w:p>${retained}</w:p><w:p>${run("Append here")}</w:p>`);
  const toc = await edit(input, "toc.add", { paragraph: 2, levels: { start: 2, end: 5 }, title: "Contents", result: "Stored entries" });
  expect(toc.xml).toContain(retained);
  expect((await docx.inspectDocumentFields(toc.bytes, {}, textContext)).items[1]).toMatchObject({ instruction: ' TOC \\o "2-5" ', result: "Stored entries", update: true });
  const caption = await edit(toc.bytes, "captions.add", { paragraph: 2, label: "Figure", text: "Harbor at dawn" });
  expect(caption.xml).toContain(retained);
  expect((await docx.inspectDocumentFields(caption.bytes, {}, textContext)).items[2]).toMatchObject({ instruction: ' SEQ "Figure" ', result: "", update: true });
  const staticCaption = await edit(caption.bytes, "captions.add", { paragraph: 2, label: "Plate A", text: "North shore", static: true });
  expect((await docx.inspectDocumentFields(staticCaption.bytes, {}, textContext)).items).toHaveLength(3);
  expect(staticCaption.xml).toContain("Plate A");
});

it("requires explicit sequence reuse on collision and rejects instruction injection", async () => {
  const input = await textFixture('<w:p><w:fldSimple w:instr=" SEQ Figure ">' + run("6") + '</w:fldSimple></w:p>');
  await expect(edit(input, "captions.add", { paragraph: 1, label: "Figure", text: "New" })).rejects.toMatchObject({ code: "unsupported-edit" });
  const reused = await edit(input, "captions.add", { paragraph: 1, label: "Figure", text: "New", sequence: "Figure" });
  expect((await docx.inspectDocumentFields(reused.bytes, {}, textContext)).items).toHaveLength(2);
  await expect(edit(input, "fields.add", { paragraph: 1, kind: "REF", target: 'Harbor" \\h' })).rejects.toThrow();
});

it("edits typed TOC instructions and flags without flattening nested stored contents", async () => {
  const page = '<w:fldSimple w:instr=" PAGEREF Harbor ">' + run("12") + '</w:fldSimple>';
  const input = await textFixture('<w:p><w:fldSimple w:instr=" TOC \\o &quot;1-3&quot; ">' + run("Harbor ") + page + '</w:fldSimple></w:p>');
  const edited = await edit(input, "toc.set", { field: 1, levels: { start: 1, end: 5 }, update: true });
  expect(edited.xml).toContain(page);
  expect((await docx.inspectDocumentFields(edited.bytes, {}, textContext)).items[0]).toMatchObject({ instruction: ' TOC \\o "1-5" ', result: "Harbor 12", update: true });
  await expect(edit(input, "toc.set", { field: 1, text: "flatten" })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(edit(input, "captions.set", { field: 1, text: "wrong kind" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("detects quoted caption sequence collisions across complex instructions", async () => {
  const input = await textFixture('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> SEQ "Figure series" </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>9</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  await expect(edit(input, "captions.add", { paragraph: 1, label: "Figure series", text: "Next" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects appending inside a multi-paragraph field, including empty middle paragraphs", async () => {
  const input = await textFixture('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC </w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p><w:p/><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  await expect(edit(input, "fields.add", { paragraph: 2, kind: "PAGE" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("creates referenced bookmarks and renames generated REF/PAGEREF operands without touching caches", async () => {
  let input = await textFixture(`<w:p>${run("Coastal harbor")}</w:p><w:p/>`);
  const document = await docx.openDocumentLocations(input, textContext);
  const volume = Volume.fromJSON({ "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } } };
  await docx.editDocumentBookmarks(input, { operation: "bookmarks.add", options: { name: "Harbor", select: document.range(document.at("paragraph", 1).token, 0, 14).token, output: "-" } }, context);
  input = new Uint8Array(volume.readFileSync("/output") as Buffer);
  input = (await edit(input, "fields.add", { paragraph: 2, kind: "REF", target: "Harbor", result: "Coastal harbor" })).bytes;
  input = (await edit(input, "fields.add", { paragraph: 2, kind: "PAGEREF", target: "Harbor", result: "12" })).bytes;
  volume.writeFileSync("/output", "");
  await docx.editDocumentBookmarks(input, { operation: "bookmarks.set", options: { bookmark: 1, name: "Port", references: "update", output: "-" } }, context);
  const result = new Uint8Array(volume.readFileSync("/output") as Buffer);
  expect((await docx.inspectDocumentFields(result, {}, textContext)).items.map(f => [f.instruction, f.result, f.update])).toEqual([[' REF "Port" ', "Coastal harbor", false], [' PAGEREF "Port" ', "12", false]]);
  expect((await docx.inspectDocumentBookmarks(result, {}, textContext)).items[0]!.name).toBe("Port");
});

it("changes only selected instruction operands, preserving switches and complex result runs", async () => {
  const input = await textFixture('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC  \\o "1-3" \\h \\z </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Stored</w:t><w:fldChar w:fldCharType="end"/></w:r><w:fldSimple w:instr=" REF &quot;Harbor&quot; \\h ">' + run("Label") + '</w:fldSimple></w:p>');
  const toc = await edit(input, "toc.set", { field: 1, levels: { start: 2, end: 4 } });
  expect((await docx.inspectDocumentFields(toc.bytes, {}, textContext)).items[0]!.instruction).toBe(' TOC  \\o "2-4" \\h \\z ');
  const ref = await edit(toc.bytes, "fields.set", { field: 2, target: "Port" });
  expect((await docx.inspectDocumentFields(ref.bytes, {}, textContext)).items[1]).toMatchObject({ instruction: ' REF "Port" \\h ', result: "Label" });
  const page = await edit(ref.bytes, "fields.set", { field: 2, kind: "PAGE" });
  expect((await docx.inspectDocumentFields(page.bytes, {}, textContext)).items[1]).toMatchObject({ instruction: " PAGE ", result: "Label" });
});
