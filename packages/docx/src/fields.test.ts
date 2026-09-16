import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { run, textContext, textFixture, w, r } from "../tests/fixtures/text.js";

const marker = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const instruction = '<w:r><w:instrText xml:space="preserve"> MERGE</w:instrText></w:r><w:r><w:instrText xml:space="preserve">FIELD  Harbor \\* MERGEFORMAT </w:instrText></w:r>';
const styled = '<w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r>';
const complex = marker("begin") + instruction + marker("separate") + styled + run(" value") + marker("end");
const simple = '<w:fldSimple w:instr=" REF  Harbor &quot;label&quot; " w:dirty="1" w:fldLock="0">' + styled + '</w:fldSimple>';
async function edit(bytes: Uint8Array, options: docx.DocxOperationArguments<"fields.set">) {
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.editDocumentFields(bytes, { operation: "fields.set", options: { output: "-", ...options } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(chunk) { volume.appendFileSync("/output", chunk); } } });
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const archive = await docx.readDocumentArchive(output, textContext);
  return { data, output, xml: new TextDecoder().decode(archive.members.find(m => m.name === "word/document.xml")!.bytes) };
}

it.each([false, true])("lists split complex instructions and simple fields in document order (%s)", async strict => {
  const input = await textFixture(`<w:p>${complex}${simple}</w:p>`, {}, strict);
  const data = await docx.inspectDocumentFields(input, {}, textContext);
  expect(data.items.map(({ kind, instruction, result, form }) => ({ kind, instruction, result, form }))).toEqual([
    { kind: "MERGEFIELD", instruction: " MERGEFIELD  Harbor \\* MERGEFORMAT ", result: "Old value", form: "complex" },
    { kind: "REF", instruction: ' REF  Harbor "label" ', result: "Old", form: "simple" }
  ]);
  expect(data.items.map(item => item.location.positions.field)).toEqual([1, 2]);
});

it("changes cached text while preserving instruction XML, all run formatting and flags exactly", async () => {
  const input = await textFixture(`<w:p>${complex}${simple}</w:p>`);
  const result = await edit(input, { field: 1, result: "New & bright" });
  expect(result.xml).toContain(instruction);
  expect(result.xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>New &amp; bright</w:t></w:r><w:r><w:t></w:t></w:r>');
  expect(result.xml).toContain(simple);
  const second = await edit(result.output, { field: 2, result: "Next" });
  expect(second.xml).toContain(simple.replace(">Old<", ">Next<"));
  expect(second.data.changes).toHaveLength(1);
});

it("stacks nested REF/PAGE fields without mixing their instructions or cached results", async () => {
  const page = marker("begin") + '<w:r><w:instrText> PAGE </w:instrText></w:r>' + marker("separate") + run("7") + marker("end");
  const input = await textFixture('<w:p>' + marker("begin") + '<w:r><w:instrText> REF Harbor </w:instrText></w:r>' + marker("separate") + run("See ") + page + marker("end") + '</w:p>');
  const list = await docx.inspectDocumentFields(input, {}, textContext);
  expect(list.items.map(i => [i.kind, i.instruction, i.result])).toEqual([["REF", " REF Harbor ", "See 7"], ["PAGE", " PAGE ", "7"]]);
  const result = await edit(input, { select: list.items[1]!.location.token, result: "9" });
  expect(result.xml).toContain(page.replace(">7<", ">9<"));
  expect(result.xml).toContain('<w:instrText> REF Harbor </w:instrText>');
  await expect(edit(input, { field: 1, result: "flatten" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each(["header", "footer"])("lists and sets cached %s fields in their explicit story", async kind => {
  const input = await textFixture(`<w:sectPr><w:${kind}Reference w:type="default" r:id="owner"/></w:sectPr>`, { owner: { kind, xml: `<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}" xmlns:r="${r}"><w:p>${simple}</w:p></w:${kind === "header" ? "hdr" : "ftr"}>` } });
  const scope = kind === "header" ? "headers" : "footers";
  expect((await docx.inspectDocumentFields(input, {}, textContext)).items).toEqual([]);
  expect((await docx.inspectDocumentFields(input, { scope }, textContext)).items[0]!.location.value.part).toBe("/word/owner.xml");
  const result = await edit(input, { scope, field: 1, result: "North" });
  const archive = await docx.readDocumentArchive(result.output, textContext);
  expect(new TextDecoder().decode(archive.members.find(m => m.name === "word/owner.xml")!.bytes)).toContain(simple.replace(">Old<", ">North<"));
});

it.each([marker("end"), marker("begin"), marker("begin") + marker("separate") + marker("separate") + marker("end"), '<w:fldSimple>' + run("bad") + '</w:fldSimple>'])("rejects malformed fields before publication: %s", async malformed => {
  const input = await textFixture(`<w:p>${simple}${malformed}</w:p>`);
  await expect(edit(input, { all: true, result: "No" })).rejects.toMatchObject({ code: malformed.startsWith("<w:fldSimple") ? "unsupported-edit" : "invalid-package" });
});

it("rejects unsupported result structures and inert instruction kinds", async () => {
  for (const field of ['<w:fldSimple w:instr=" INCLUDETEXT file:///never-read ">' + styled + '</w:fldSimple>', '<w:fldSimple w:instr=" PAGE "><w:r><w:drawing/></w:r></w:fldSimple>']) {
    const input = await textFixture(`<w:p>${field}</w:p>`);
    await expect(edit(input, { field: 1, result: "No" })).rejects.toMatchObject({ code: "unsupported-edit" });
  }
});

it("preserves spaced result text and explicitly changes update metadata only", async () => {
  const input = await textFixture(`<w:p>${simple}</w:p>`);
  const result = await edit(input, { field: 1, result: "  Shore  ", update: false });
  expect(result.xml).toContain('w:instr=" REF  Harbor &quot;label&quot; " w:dirty="false" w:fldLock="0"');
  expect(result.xml).toContain('xml:space="preserve"');
  expect((await docx.inspectDocumentFields(result.output, {}, textContext)).items[0]).toMatchObject({ result: "  Shore  ", update: false, locked: false });
});

it.each(['<w:fldSimple w:instr=" PAGE "/>', '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:i/></w:rPr><w:t/></w:r></w:fldSimple>'])("fills empty simple cached results: %s", async field => {
  const result = await edit(await textFixture(`<w:p>${field}</w:p>`), { field: 1, result: "4", update: true });
  expect((await docx.inspectDocumentFields(result.output, {}, textContext)).items[0]).toMatchObject({ result: "4", update: true });
  expect(result.xml).toContain('w:instr=" PAGE "');
  if (field.includes("<w:i/>")) expect(result.xml).toContain('<w:rPr><w:i/></w:rPr>');
});

it("preserves nested fields used inside instruction text", async () => {
  const child = marker("begin") + '<w:r><w:instrText> PAGE </w:instrText></w:r>' + marker("separate") + run("2") + marker("end");
  const field = marker("begin") + '<w:r><w:instrText> REF </w:instrText></w:r>' + child + '<w:r><w:instrText> \\h </w:instrText></w:r>' + marker("separate") + run("Cached") + marker("end");
  const input = await textFixture(`<w:p>${field}</w:p>`);
  const list = await docx.inspectDocumentFields(input, {}, textContext);
  expect(list.items.map(i => [i.instruction, i.result])).toEqual([[" REF  \\h ", "Cached"], [" PAGE ", "2"]]);
  const result = await edit(input, { field: 1, result: "Updated" });
  expect(result.xml).toContain(field.replace(">Cached<", ">Updated<"));
});

it.each(["sym", "noBreakHyphen", "footnoteReference", "mystery"])("rejects unsupported cached content without publishing: %s", async name => {
  const input = await textFixture(`<w:p><w:fldSimple w:instr=" PAGE ">${styled}<w:r><w:${name}/></w:r></w:fldSimple></w:p>`);
  let writes = 0;
  await expect(docx.editDocumentFields(input, { operation: "fields.set", options: { field: 1, result: "No", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write() { writes++; } } })).rejects.toMatchObject({ code: name === "footnoteReference" ? "invalid-package" : "unsupported-edit" });
  expect(writes).toBe(0);
});

it("lists only the selected compatibility branch and retains other branch bytes", async () => {
  const alternate = '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:extra="urn:unhandled"><mc:Choice Requires="extra"><w:fldSimple w:instr=" PAGE ">' + run("Hidden") + '</w:fldSimple></mc:Choice><mc:Fallback>' + simple + '</mc:Fallback></mc:AlternateContent>';
  const input = await textFixture(`<w:p>${alternate}</w:p>`);
  const list = await docx.inspectDocumentFields(input, {}, textContext);
  expect(list.items.map(i => i.result)).toEqual(["Old"]);
  expect(list.items[0]!.instruction).toBe(' REF  Harbor "label" ');
});

it("rejects stale field tokens and preserves unchanged result XML", async () => {
  const input = await textFixture(`<w:p>${simple}</w:p>`);
  const token = (await docx.inspectDocumentFields(input, {}, textContext)).items[0]!.location.token;
  const noChange = await edit(input, { select: token, result: "Old" });
  expect(noChange.data.changed).toBe(false);
  expect(noChange.xml).toContain(simple);
  await expect(edit((await edit(input, { field: 1, result: "Next" })).output, { select: token, result: "Last" })).rejects.toMatchObject({ code: "stale-selection" });
});

it("does not interpret foreign namespace text as editable field text", async () => {
  const input = await textFixture('<w:p><w:fldSimple w:instr=" PAGE "><w:r><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">Opaque</a:t></w:r></w:fldSimple></w:p>');
  await expect(edit(input, { field: 1, result: "No" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("fills an empty complex result and retains adjacent fields in the same run", async () => {
  const field = '<w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/>';
  const input = await textFixture(`<w:p><w:r><w:rPr><w:b/></w:rPr>${field}${field}</w:r></w:p>`);
  const result = await edit(input, { all: true, result: "3" });
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
  expect((await docx.inspectDocumentFields(result.output, {}, textContext)).items.map(i => i.result)).toEqual(["3", "3"]);
  expect(result.data.changes[1]!.after.value.path).not.toEqual(result.data.changes[1]!.before.value.path);
});

it("preserves exact entity and quote spelling in instructions when adding update metadata", async () => {
  const input = await textFixture("<w:p><w:fldSimple w:instr=' REF  &quot;Harbor&quot; &#92;h ' w:fldLock='on'>" + run("Old") + "</w:fldSimple></w:p>");
  const result = await edit(input, { field: 1, update: true });
  expect(result.xml).toContain("w:instr=' REF  &quot;Harbor&quot; &#92;h ' w:fldLock='on'");
  expect(result.xml).toContain(run("Old"));
});

it("writes line and tab results as run content while preserving formatting", async () => {
  const result = await edit(await textFixture(`<w:p>${simple}</w:p>`), { field: 1, result: "East\tbay\nSouth" });
  const archive = await docx.readDocumentArchive(result.output, textContext);
  const root = docx.parseDocumentXml(archive.members.find(m => m.name === "word/document.xml")!.bytes).root;
  const leaves = root.children[0]!.children[0]!.children[0]!.children[0]!.children;
  expect(leaves.map(n => n.localName)).toEqual(["rPr", "t", "tab", "t", "br", "t"]);
  expect(result.xml).toContain('<w:rPr><w:b/></w:rPr>');
  const next = await edit(result.output, { field: 1, result: "Plain" });
  expect((await docx.inspectDocumentFields(next.output, {}, textContext)).items[0]!.result).toBe("Plain");
});

it.each(['<w:fldSimple w:instr=" PAGE " w:dirty="unknown">' + run("Old") + '</w:fldSimple>', '<w:fldSimple w:instr=" REF &quot;Unclosed ">' + run("Old") + '</w:fldSimple>', '<w:fldSimple w:instr=" MERGEFIELD ">' + run("Old") + '</w:fldSimple>'])("rejects malformed metadata or supported instructions: %s", async field => {
  await expect(edit(await textFixture(`<w:p>${field}</w:p>`), { field: 1, result: "No" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("preserves comments inside cached text when assigning whitespace", async () => {
  const field = '<w:fldSimple w:instr=" PAGE "><w:r><w:t><!--keep-->Old</w:t></w:r></w:fldSimple>';
  const result = await edit(await textFixture(`<w:p>${field}</w:p>`), { field: 1, result: " New " });
  expect(result.xml).toContain('<!--keep-->');
});

it("rejects shared story edits, allows explicit empty selection and enforces budgets and cancellation", async () => {
  const section = '<w:sectPr><w:headerReference w:type="default" r:id="owner"/></w:sectPr>';
  const input = await textFixture('<w:p><w:pPr>' + section + '</w:pPr></w:p>' + section, { owner: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p>${simple}</w:p></w:hdr>` } });
  await expect(edit(input, { scope: "headers", section: 1, field: 1, result: "No" })).rejects.toMatchObject({ code: "ambiguous-selection" });
  const empty = await docx.editDocumentFields(input, { operation: "fields.set", options: { all: true, allowEmpty: true, result: "None", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } });
  expect(empty).toMatchObject({ changed: false, changes: [], output: null });
  await expect(docx.inspectDocumentFields(input, { scope: "headers", limit: [{ name: "matches", value: 0 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  const controller = new AbortController(); controller.abort();
  await expect(docx.inspectDocumentFields(input, {}, { ...textContext, signal: controller.signal })).rejects.toBeDefined();
});

it("updates displayed run positions when filling an earlier empty field adds a run", async () => {
  const input = await textFixture(`<w:p><w:fldSimple w:instr=" PAGE "/>${complex}</w:p>`);
  const result = await edit(input, { all: true, result: "New" });
  expect(result.data.changes[1]!.before.positions.run).toBe(1);
  expect(result.data.changes[1]!.after.positions.run).toBe(2);
});

it("rejects structural text conversion that would discard an embedded comment", async () => {
  const input = await textFixture('<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t><!--keep-->Old</w:t></w:r></w:fldSimple></w:p>');
  await expect(edit(input, { field: 1, result: "A\nB" })).rejects.toMatchObject({ code: "unsupported-edit" });
});
