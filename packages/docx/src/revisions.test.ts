import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

const identity = 'w:id="7" w:author="Mira" w:date="2025-02-03T04:05:06Z"';
const history = `<w:rPr><w:b/><w:rPrChange ${identity}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>`;

it.each([false, true])("reads property snapshots without merging current properties (%s)", async strict => {
  const bytes = await textFixture(`<w:p><w:pPr><w:pPrChange w:id="6" w:author="Mira" w:date="2025-02-03T04:05:06Z"><w:pPr><w:bidi/></w:pPr></w:pPrChange></w:pPr><w:r>${history}<w:t>Harbor</w:t></w:r></w:p>`, {}, strict);
  for (const view of ["final", "original", "all"] as const) {
    const data = await docx.extractDocumentText(bytes, textContext, { view });
    expect(data.text).toBe("Harbor");
    expect(data.segments[0]!.formatting).toMatchObject(view === "original"
      ? { bold: null, italic: true, paragraph: { style: null, bidi: true } }
      : { bold: true, italic: null, paragraph: { style: null, bidi: null } });
    expect(data.segments[0]).toMatchObject({ revisions: [expect.objectContaining({ type: "format", id: "6", author: "Mira", timestamp: "2025-02-03T04:05:06Z", support: "supported" }), expect.objectContaining({ type: "format" })] });
  }
});

it("retains nested revision ancestry, split runs and deleted paragraph boundaries", async () => {
  const bytes = await textFixture(`<w:del w:id="5">${paragraph("Retired")}</w:del><w:p><w:ins ${identity}>${run("Sea")}${run("wall")}<w:del w:id="8">${run(" nested")}</w:del></w:ins></w:p>${paragraph("End")}`);
  expect((await docx.extractDocumentText(bytes, textContext)).text).toBe("Seawall\nEnd");
  expect((await docx.extractDocumentText(bytes, textContext, { view: "original" })).text).toBe("Retired\n\nEnd");
  const all = await docx.extractDocumentText(bytes, textContext, { view: "all" });
  expect(all.text).toBe("Retired\nSeawall nested\nEnd");
  expect(all.segments.find(s => s.text === " nested")).toMatchObject({ revision: "delete", revisions: [expect.objectContaining({ id: "7" }), expect.objectContaining({ id: "8" })] });
});

it("inventories move pairs, property history and opaque revisions without exposing opaque prose", async () => {
  const bytes = await textFixture(`<w:p><w:moveFromRangeStart w:id="10" w:name="journey" w:author="Mira" w:date="2025-02-03T04:05:06Z"/><w:moveFrom w:id="11">${run("West")}</w:moveFrom><w:moveFromRangeEnd w:id="10"/><w:moveToRangeStart w:id="12" w:name="journey"/><w:moveTo w:id="13">${run("East")}</w:moveTo><w:moveToRangeEnd w:id="12"/><w:r>${history}<w:t> dock</w:t></w:r><w:futureChange w:id="14" w:author="Lee">${run("Secret")}</w:futureChange></w:p>`);
  expect((await docx.extractDocumentText(bytes, textContext)).text).toBe("East dock");
  expect((await docx.extractDocumentText(bytes, textContext, { view: "original" })).text).toBe("West dock");
  const list = await docx.inspectDocumentRevisions(bytes, {}, textContext);
  expect(list.items.map(i => i.markup)).toEqual(["moveFromRangeStart", "moveFrom", "moveFromRangeEnd", "moveToRangeStart", "moveTo", "moveToRangeEnd", "rPrChange", "futureChange"]);
  expect(list.items[0]).toMatchObject({ id: "10", name: "journey", type: "move", support: "supported", author: "Mira" });
  expect(list.items.at(-1)).toMatchObject({ id: "14", type: "unsupported", support: "opaque" });
  const selected = await docx.inspectDocumentRevisions(bytes, { revision: 8 }, textContext);
  expect(selected.items).toEqual([list.items[7]]);
});

it.each([
  `<w:p><w:r>${history}<w:t>Harbor</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:rPr><w:del ${identity}/></w:rPr></w:pPr>${run("Harbor")}</w:p>`,
  `<w:p><w:moveFromRangeStart ${identity}/>${run("Harbor")}<w:moveFromRangeEnd w:id="7"/></w:p>`
])("rejects removal of review history before publication: %s", async body => {
  const input = await textFixture(body);
  await expect(docx.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: "", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects affected move ranges and preserves unrelated review bytes on replacement", async () => {
  const review = `<w:moveFromRangeStart ${identity}/>${run("Harbor")}<w:moveFromRangeEnd w:id="7"/>`;
  const input = await textFixture(`<w:p>${review}</w:p>${paragraph("Coast")}`);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await expect(docx.replaceDocumentText(input, { find: "Harbor", with: "", all: true, dryRun: true }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.replaceDocumentText(input, { find: "Coast", with: "Shore", all: true, output: "-" }, { ...context, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  expect(new TextDecoder().decode(await docx.getDocumentXml(output, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array)).toContain(review);
});

it("shares revision JSON and selectors with the command engine and advertises bounded review operations", async () => {
  const bytes = await textFixture(`<w:p><w:ins ${identity}>${run("Pier")}</w:ins></w:p>`);
  const volume = Volume.fromJSON({ "/input": Buffer.from(bytes) });
  let output = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["revisions", "list", "/input", "--revision", "1", "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ operation: "revisions.list", ok: true, affected: 0, data: await docx.inspectDocumentRevisions(bytes, { revision: 1 }, textContext) });
  for (const [name, support] of [["list", "read"], ["accept", "edit"], ["reject", "edit"]]) {
    const schema = docx.getDocxDiscovery(docx.parseDocxArguments(["schema", "revisions", name!].map(s => new TextEncoder().encode(s))))!;
    expect(schema.data).toMatchObject({ operations: [expect.objectContaining({ id: "revisions." + name, support })] });
  }
});

it("reports opaque extension revisions while excluding their text and ignoring inactive alternatives", async () => {
  const bytes = await textFixture(`<w:p xmlns:x="urn:original:review" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x">${run("Visible")}<x:conflictIns w:id="21" w:author="Ren">${run("Opaque")}</x:conflictIns><mc:AlternateContent><mc:Choice Requires="x"><w:ins w:id="22">${run("Inactive")}</w:ins></mc:Choice><mc:Fallback>${run(" fallback")}</mc:Fallback></mc:AlternateContent></w:p>`);
  const list = await docx.inspectDocumentRevisions(bytes, {}, textContext);
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({ id: "21", type: "unsupported", support: "opaque" });
  const data = await docx.extractDocumentText(bytes, textContext);
  expect(data.text).toBe("Visible fallback");
  expect(data).toMatchObject({ revisions: [expect.objectContaining({ id: "21", support: "opaque" })], warnings: [expect.objectContaining({ code: "opaque-revision" })] });
});

it("keeps review-only row and paragraph-mark metadata in annotated segments", async () => {
  const bytes = await textFixture(`<w:p><w:pPr><w:rPr><w:del ${identity}/></w:rPr></w:pPr>${run("A")}</w:p>${paragraph("B")}`);
  const data = await docx.extractDocumentText(bytes, textContext, { view: "all" });
  expect(data.segments.find(s => s.kind === "paragraph")).toMatchObject({ revision: "delete", revisions: [expect.objectContaining({ id: "7", author: "Mira" })] });
});

it("rejects whole-text removal inside a move range spanning other paragraphs", async () => {
  const bytes = await textFixture(`<w:p><w:moveToRangeStart ${identity}/>${run("Start")}</w:p>${paragraph("Middle")}<w:p>${run("End")}<w:moveToRangeEnd w:id="7"/></w:p>`);
  await expect(docx.editDocumentParagraphs(bytes, { operation: "paragraphs.set", options: { paragraph: 2, text: "", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("orders opaque and supported inventory together and honors enclosing read views", async () => {
  const bytes = await textFixture(`<w:p xmlns:x="urn:original:review" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x"><x:conflictDel w:id="1"/><w:ins w:id="2">${run("New")}<w:del w:id="3">${run("Old")}</w:del></w:ins></w:p>`);
  expect((await docx.inspectDocumentRevisions(bytes, {}, textContext)).items.map(i => i.id)).toEqual(["1", "2", "3"]);
  expect((await docx.inspectDocumentRevisions(bytes, { view: "original" }, textContext)).items.map(i => i.id)).toEqual(["1"]);
});

it("retains all property histories but marks malformed and unverified families opaque", async () => {
  const bytes = await textFixture(`<w:p><w:pPr><w:pPrChange w:id="1"/></w:pPr><w:r><w:rPr><w:b/><w:rPrChange w:id="2"/></w:rPr><w:t>Harbor</w:t></w:r></w:p><w:sectPr><w:sectPrChange w:id="3"><w:sectPr/></w:sectPrChange></w:sectPr>`);
  const data = await docx.inspectDocumentRevisions(bytes, {}, textContext);
  expect(data.items.map(i => [i.id, i.type, i.support])).toEqual([["1", "format", "opaque"], ["2", "format", "opaque"], ["3", "section", "opaque"]]);
  const text = await docx.extractDocumentText(bytes, textContext, { view: "original" });
  expect(text.text).toBe("Harbor");
  expect(text.warnings).toHaveLength(1);
});

it("exposes historical direct formatting alongside current formatting in all view", async () => {
  const bytes = await textFixture(`<w:p><w:pPr><w:pPrChange w:id="6"><w:pPr><w:bidi/></w:pPr></w:pPrChange></w:pPr><w:r>${history}<w:t>Harbor</w:t></w:r></w:p>`);
  const data = await docx.extractDocumentText(bytes, textContext, { view: "all" });
  expect(data.segments[0]).toMatchObject({ formatting: { bold: true, italic: null, paragraph: { bidi: null } }, originalFormatting: { bold: null, italic: true, paragraph: { bidi: true } } });
});

it("does not let an inactive review branch block unrelated text removal", async () => {
  const bytes = await textFixture(`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:inactive"><mc:Choice Requires="x"><w:p><w:moveToRangeStart w:id="9"/></w:p></mc:Choice><mc:Fallback>${paragraph("First")}</mc:Fallback></mc:AlternateContent>${paragraph("Second")}`);
  await expect(docx.editDocumentParagraphs(bytes, { operation: "paragraphs.set", options: { paragraph: 2, text: "Changed", dryRun: true } }, { ...textContext, encoding: { order: "input", compression: "store" } })).resolves.toMatchObject({ changed: true });
});

it("keeps existing annotation ordinals in XML encounter order", async () => {
  const bytes = await textFixture(`<w:p><w:ins w:id="1">${run("First")}</w:ins><w:bookmarkStart w:id="2" w:name="dock"/>${run("Next")}<w:bookmarkEnd w:id="2"/></w:p>`);
  const document = await docx.openDocumentLocations(bytes, textContext);
  expect(document.at("annotation", 1).value.path).toEqual([0, 0, 0]);
  expect(document.at("annotation", 1).positions).toMatchObject({ paragraph: 1, section: 1 });
  expect(document.list("annotation", { section: 1 })).toHaveLength(2);
});

it.each(["del", "ins"])("filters revision descendants by the enclosing %s row before assigning ordinals", async kind => {
  const row = `<w:tr><w:trPr><w:${kind} w:id="1"/></w:trPr><w:tc><w:p><w:r><w:rPr><w:rPrChange w:id="2"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Harbor</w:t></w:r></w:p></w:tc></w:tr>`;
  const bytes = await textFixture(`<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid>${row}</w:tbl><w:p><w:ins w:id="3">${run("Coast")}</w:ins><w:r>${history}<w:t>Dock</w:t></w:r></w:p>`);
  const view = kind === "del" ? "final" : "original";
  const items = (await docx.inspectDocumentRevisions(bytes, { view }, textContext)).items;
  expect(items.map(item => item.id)).toEqual(kind === "del" ? ["3", "7"] : ["7"]);
  expect((await docx.inspectDocumentRevisions(bytes, { view, revision: 1 }, textContext)).items).toEqual([items[0]]);
  expect((await docx.inspectDocumentRevisions(bytes, { view, table: 1 }, textContext)).items).toEqual([]);
});

it.each(["moveTo", "customXmlIns"])("rejects replacement within a story-level %s range but permits later text", async kind => {
  const bytes = await textFixture(`<w:${kind}RangeStart w:id="7"/>${paragraph("Harbor")}<w:${kind}RangeEnd w:id="7"/>${paragraph("Coast")}`);
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await expect(docx.replaceDocumentText(bytes, { find: "Harbor", with: "Pier", all: true, dryRun: true }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(docx.replaceDocumentText(bytes, { find: "Coast", with: "Shore", all: true, dryRun: true }, context)).resolves.toMatchObject({ changed: true });
});

it.each(["rPr", "pPr"])("keeps unverified %s snapshot contents opaque without claiming rollback", async name => {
  const props = `<w:${name}><w:${name === "rPr" ? "b" : "bidi"}/><w:${name}Change w:id="7"><w:${name}><w:unverified/></w:${name}></w:${name}Change></w:${name}>`;
  const bytes = await textFixture(`<w:p>${name === "pPr" ? props : ""}<w:r>${name === "rPr" ? props : ""}<w:t>Harbor</w:t></w:r></w:p>`);
  expect((await docx.inspectDocumentRevisions(bytes, {}, textContext)).items[0]).toMatchObject({ id: "7", support: "opaque" });
  const data = await docx.extractDocumentText(bytes, textContext, { view: "original" });
  expect(data.segments[0]!.formatting).toMatchObject(name === "rPr" ? { bold: true } : { paragraph: { bidi: true } });
  expect(data.warnings).toContainEqual(expect.objectContaining({ code: "opaque-revision" }));
});

it.each(['<w:b w:val="banana"/>', '<w:b/><w:b w:val="0"/>', '<w:b>Opaque</w:b>', 'Opaque<w:b/>', '<w:b>\u00a0</w:b>', '\u00a0<w:b/>'])("does not interpret malformed direct history: %s", async old => {
  const bytes = await textFixture(`<w:p><w:r><w:rPr><w:i/><w:rPrChange w:id="7"><w:rPr>${old}</w:rPr></w:rPrChange></w:rPr><w:t>Harbor</w:t></w:r></w:p>`);
  expect((await docx.inspectDocumentRevisions(bytes, {}, textContext)).items[0]).toMatchObject({ support: "opaque" });
  expect((await docx.extractDocumentText(bytes, textContext, { view: "original" })).segments[0]!.formatting).toMatchObject({ italic: true, bold: null });
});

it("rejects a historical style reference missing its required value", async () => {
  const bytes = await textFixture(`<w:p><w:r><w:rPr><w:rPrChange w:id="7"><w:rPr><w:rStyle/></w:rPr></w:rPrChange></w:rPr><w:t>Harbor</w:t></w:r></w:p>`);
  await expect(docx.inspectDocumentRevisions(bytes, {}, textContext)).rejects.toMatchObject({ code: "invalid-package" });
});
