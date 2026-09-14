import { expect, it } from "vitest";
import { Volume } from "memfs";
import { run, textContext, textFixture } from "../tests/fixtures/text.js";
import { extractDocumentText } from "./text.js";
import { inspectDocumentTable } from "./table-read.js";
import { readArchive } from "./archive.js";
import { validateDocumentArchive } from "./validation.js";

const field = (tag: string, type = "<w:text/>", text = "Old") => `<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="${tag}"/>${type}</w:sdtPr><w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;
const region = (blocks: string) => `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent>${blocks}</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
it("counts and addresses native repeat-owned rows in maintained table inspection", async () => {
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region(`<w:tr><w:tc><w:p>${field("name")}</w:p></w:tc></w:tr>`)}</w:tbl>`);
  expect((await inspectDocumentTable(input, { table: 1 }, textContext)).item.details).toMatchObject({ rows: 1, columns: 1 });
});
it("validates native repeat-owned row cells against the actual table grid", async () => {
  const input = await textFixture(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region(`<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>`)}</w:tbl>`);
  expect(validateDocumentArchive(await readArchive(input, textContext)).valid).toBe(false);
});
async function repeat(body: string | Uint8Array, records: readonly { values: readonly { binding: string; value: string | number | boolean }[] }[]) {
  const module = await import("./control-repeat.js"); const input = typeof body === "string" ? await textFixture(body) : body; const fs = Volume.fromJSON({ "/out": "" });
  const result = await module.editDocumentControlRepeats(input, { control: 1, data: records, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { fs.appendFileSync("/out", bytes); } } });
  return { result, bytes: new Uint8Array(fs.readFileSync("/out") as Buffer) };
}
it.each(["block", "row"])("expands original %s repeating native items from exact tagged scalar records", async shape => {
  const body = shape === "block" ? region(`<w:p>${field("name")}</w:p>`) : `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>${region(`<w:tr><w:tc><w:p>${field("name")}</w:p></w:tc></w:tr>`)}</w:tbl>`;
  const { bytes } = await repeat(body, [{ values: [{ binding: "name", value: "Harbor" }] }, { values: [{ binding: "name", value: "Coast" }] }]);
  expect((await extractDocumentText(bytes, textContext)).text).toBe("Harbor\nCoast");
});
it("retains one empty reusable native placeholder item and permits a subsequent refill", async () => {
  const module = await import("./controls.js"); const { bytes } = await repeat(region(`<w:p>${field("name")}</w:p>`), []);
  const items = (await module.inspectDocumentControls(bytes, {}, textContext)).items;
  expect(items.filter(item => item.kind === "repeating-item")).toHaveLength(1); expect(items.find(item => item.tag === "name")).toMatchObject({ value: "", placeholder: true });
  const repeatModule = await import("./control-repeat.js"); const chunks: Uint8Array[] = [];
  await repeatModule.editDocumentControlRepeats(bytes, { control: 1, data: [{ values: [{ binding: "name", value: "Return" }] }], output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(value) { chunks.push(value); } } });
  expect((await extractDocumentText(Buffer.concat(chunks), textContext)).text).toBe("Return");
});
it.each([
  { values: [] },
  { values: [{ binding: "missing", value: "New" }] },
  { values: [{ binding: "name", value: "New" }, { binding: "name", value: "Again" }] },
  { values: [{ binding: "name", value: 2 }] },
])("rejects missing/extra/duplicate/type-conflicting record %j", async record => {
  await expect(repeat(region(`<w:p>${field("name")}</w:p>`), [record]).then(() => undefined)).rejects.toMatchObject({ code: "usage" });
});

it("clears choice/date values and resets declared checkbox glyph in a reusable empty item", async () => {
  const types = {
    check: '<c:checkbox xmlns:c="http://schemas.microsoft.com/office/word/2010/wordml"><c:checked c:val="1"/><c:checkedState c:val="2612" c:font="Symbol"/><c:uncheckedState c:val="2610" c:font="Symbol"/></c:checkbox>',
    choice: '<w:dropDownList w:lastValue="a"><w:listItem w:value="a" w:displayText="Alpha"/></w:dropDownList>',
    date: '<w:date w:fullDate="2025-02-03T00:00:00Z"><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="en-GB"/><w:calendar w:val="gregorian"/></w:date>',
  };
  const { bytes } = await repeat(region(`<w:p>${field("check", types.check, "☒")}${field("choice", types.choice, "Alpha")}${field("date", types.date, "03/02/2025")}</w:p>`), []);
  const { inspectDocumentControls } = await import("./controls.js"); const controls = (await inspectDocumentControls(bytes, {}, textContext)).items;
  expect(controls.find(item => item.tag === "check")).toMatchObject({ value: false });
  expect(controls.find(item => item.tag === "choice")).toMatchObject({ value: "", placeholder: true });
  expect(controls.find(item => item.tag === "date")).toMatchObject({ value: null, placeholder: true });
  expect((await extractDocumentText(bytes, textContext)).text).toBe("☐");
  const refilled = await repeat(bytes, [{ values: [{ binding: "check", value: true }, { binding: "choice", value: "a" }, { binding: "date", value: "2026-02-03" }] }]);
  expect((await extractDocumentText(refilled.bytes, textContext)).text).toBe("☒Alpha03/02/2026");
});

it("refuses unsupported same-namespace template nodes", async () => {
  await expect(repeat(region(`<w:p>${field("name")}<w:future w:val="opaque"/></w:p>`), [{ values: [{ binding: "name", value: "New" }] }])).rejects.toMatchObject({ code: "unsupported-edit" });
});
it("independently preflights prior-item scalar boundaries before replacing them", async () => {
  const first = region(`<w:p>${field("name")}</w:p>`);
  const extra = `<w:sdt><w:sdtPr><w:id w:val="4"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field("name").replace('w:val="3"','w:val="5"').replace('</w:sdtContent>', '<w:fldSimple w:instr="QUOTE">'+run("Protected")+'</w:fldSimple></w:sdtContent>')}</w:p></w:sdtContent></w:sdt>`;
  const body = first.slice(0, -'</w:sdtContent></w:sdt>'.length) + extra + '</w:sdtContent></w:sdt>';
  await expect(repeat(body, [{ values: [{ binding: "name", value: "New" }] }])).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("admits expanded block-table dimensions before producing item copies", async () => {
  const { editDocumentControlRepeats } = await import("./control-repeat.js");
  const input = await textFixture(region(`<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p>${field("name")}</w:p></w:tc></w:tr></w:tbl>`));
  await expect(editDocumentControlRepeats(input, { control: 1, data: [1, 2, 3].map(() => ({ values: [{ binding: "name", value: "New" }] })), limit: [{ name: "tableRows", value: 2 }], dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("refuses cross-story references to bookmarks in a prior item that would be deleted", async () => {
  const { editDocumentControlRepeats } = await import("./control-repeat.js");
  const item = (id: number, name: string, controlId: number) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:bookmarkStart w:id="${id+5}" w:name="${name}"/>${field("name").replace('w:val="3"', `w:val="${controlId}"`)}<w:bookmarkEnd w:id="${id+5}"/></w:p></w:sdtContent></w:sdt>`;
  const body = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent>${item(2,"harbor",3)}${item(4,"coast",5)}</w:sdtContent></w:sdt><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>`;
  const input = await textFixture(body, { header: { kind: "header", xml: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:hyperlink w:anchor="coast"><w:r><w:t>Jump</w:t></w:r></w:hyperlink></w:p></w:hdr>' } });
  await expect(editDocumentControlRepeats(input, { control: 1, data: [{ values: [{ binding: "name", value: "New" }] }], dryRun: true }, { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("refuses unverified same-namespace template attributes", async () => {
  await expect(repeat(region(`<w:p w:future="opaque">${field("name")}</w:p>`), [{ values: [{ binding: "name", value: "New" }] }])).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects item-count ceilings and cancellation without writing publication bytes", async () => {
  const { editDocumentControlRepeats } = await import("./control-repeat.js"); const input = await textFixture(region(`<w:p>${field("name")}</w:p>`));
  const writes: Uint8Array[] = [], context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(value: Uint8Array) { writes.push(value); } } };
  await expect(editDocumentControlRepeats(input, { control: 1, data: [1,2].map(() => ({ values: [{ binding: "name", value: "New" }] })), limit: [{ name: "matches", value: 1 }], output: "-" }, context)).rejects.toMatchObject({ code: "limit-exceeded" });
  const controller = new AbortController(); controller.abort();
  await expect(editDocumentControlRepeats(input, { control: 1, data: [{ values: [{ binding: "name", value: "New" }] }], output: "-" }, { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  expect(writes).toEqual([]);
});
it("retains inherited XML language/space and exact prefixes while filling cloned fields", async () => {
  const body = region(`<w:p xml:lang="en-GB" xml:space="preserve">${field("name").replace('<w:sdtContent>', '<w:sdtContent xml:lang="en-US" xml:space="preserve">')}</w:p>`);
  const { bytes } = await repeat(body, [{ values: [{ binding: "name", value: " New " }] }]);
  const archive = await readArchive(bytes, textContext), xml = new TextDecoder().decode(archive.members.find(member => member.name === "word/document.xml")!.bytes);
  expect(xml).toContain('xml:lang="en-GB"'); expect(xml).toContain('xml:lang="en-US"'); expect(xml).toContain('xml:space="preserve"');
  expect((await extractDocumentText(bytes, textContext)).text).toBe(" New ");
});
