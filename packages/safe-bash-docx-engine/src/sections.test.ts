import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

const geometry = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/>';
const section = (props = geometry) => `<w:sectPr>${props}</w:sectPr>`;
const boundary = (props = geometry) => `<w:p><w:pPr>${section(props)}</w:pPr>${run("Coast")}</w:p>`;
const multiple = boundary() + boundary() + paragraph("Harbor") + section();
async function edit(body: string | Uint8Array, options: Record<string, unknown>, operation: "sections.set" | "sections.add" = "sections.set", strict = false, stories: Parameters<typeof textFixture>[1] = {}) {
  const input = typeof body === "string" ? await textFixture(body, stories, strict) : body;
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await docx.editDocumentSections(input, { operation, options: { output: "-", ...options } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  const root = docx.parseDocumentXml(new TextEncoder().encode(xml)).root;
  return { data, bytes, xml, body: root.children[0]!, listed: await docx.inspectDocumentSections(bytes, {}, textContext) };
}
const attr = (node: docx.XmlElement | undefined, name: string) => node?.attributes.find(a => a.localName === name)?.value;

it.each([false, true])("edits the owning middle section without changing surrounding geometry (%s)", async strict => {
  const result = await edit(multiple, { section: 2, orientation: { enum: "WD_ORIENTATION", name: "LANDSCAPE" }, pageWidth: { value: 11, unit: "in" }, pageHeight: { value: 8.5, unit: "in" }, gutter: { value: 0.25, unit: "in" }, headerDistance: { value: 0.4, unit: "in" }, footerDistance: { value: 0.6, unit: "in" }, startType: { enum: "WD_SECTION_START", name: "CONTINUOUS" }, columns: 2, pageNumberStart: 7, pageNumberFormat: "upperRoman", differentFirstPage: true }, "sections.set", strict);
  expect(result.listed.items).toHaveLength(3);
  expect(result.listed.items[1]).toMatchObject({ position: 2, owner: "paragraph", direct: { pageWidth: 15840, pageHeight: 12240, orientation: "landscape", gutter: 360, headerDistance: 576, footerDistance: 864, startType: "continuous", columns: 2, pageNumberStart: 7, pageNumberFormat: "upperRoman", differentFirstPage: true } });
  expect(result.listed.items[0]!.direct.pageWidth).toBe(12240);
  expect(result.listed.items[2]!.direct.pageWidth).toBe(12240);
  expect(result.body.children.at(-1)!.localName).toBe("sectPr");
  expect(result.data.changes).toHaveLength(1);
  expect(result.body.children[1]!.children[0]!.children[0]!.children.map(n => n.localName)).toEqual(["type", "pgSz", "pgMar", "pgNumType", "cols", "titlePg"]);
});

it("changes orientation without implicitly swapping dimensions and switches back to portrait", async () => {
  const landscape = await edit(multiple, { section: 1, orientation: { enum: "WD_ORIENTATION", name: "LANDSCAPE" } });
  expect(landscape.listed.items[0]!.direct).toMatchObject({ orientation: "landscape", pageWidth: 12240, pageHeight: 15840 });
  const portrait = await edit(landscape.bytes, { section: 1, orientation: { enum: "WD_ORIENTATION", name: "PORTRAIT" }, startType: { enum: "WD_SECTION_START", name: "NEW_PAGE" } });
  expect(portrait.listed.items[0]!.direct).toMatchObject({ orientation: "portrait", startType: "nextPage" });
});

it("retains lexical metadata and column separator while setting an equal count and existing gap", async () => {
  const result = await edit(paragraph("Bay") + section(geometry + '<!--retain--><w:cols w:num="2" w:space="400" w:sep="1"/><w:docGrid w:linePitch="360"/>'), { section: 1, columns: 3 });
  const cols = result.body.children.at(-1)!.children.find(n => n.localName === "cols");
  expect([attr(cols, "num"), attr(cols, "space"), attr(cols, "sep")]).toEqual(["3", "400", "1"]);
  expect(result.xml).toContain('<!--retain-->');
  expect(result.xml).toContain('<w:docGrid w:linePitch="360"/>');
});

it("appends a paragraph-owned boundary and retains the final section with inherited header references", async () => {
  const header = { headerA: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Tide report")}</w:hdr>` } };
  const body = paragraph("Bay") + section('<w:headerReference w:type="default" r:id="headerA"/>' + geometry + '<w:titlePg/>');
  const result = await edit(body, { startType: { enum: "WD_SECTION_START", name: "CONTINUOUS" } }, "sections.add", false, header);
  expect(result.listed.items).toHaveLength(2);
  expect(result.listed.items[0]!.owner).toBe("paragraph");
  expect(result.listed.items[1]!).toMatchObject({ owner: "body", direct: { startType: "continuous", pageWidth: 12240, differentFirstPage: true }, headers: { default: { linkedToPrevious: true, sourceSection: 1, part: "/word/headerA.xml" } } });
  expect(result.body.children.at(-1)!.localName).toBe("sectPr");
  expect(result.body.children.at(-1)!.children.some(c => c.localName === "headerReference")).toBe(false);
  expect((await docx.extractDocumentText(result.bytes, textContext, { scope: "headers" })).text).toBe("Tide report");
});

it("models absent and inherited headers for every variant without creating parts or changing following bindings", async () => {
  const stories = { headerA: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Coast heading")}</w:hdr>` } };
  const result = await edit(boundary('<w:headerReference w:type="default" r:id="headerA"/>' + geometry) + boundary() + section(), { section: 1, differentFirstPage: true }, "sections.set", false, stories);
  expect(result.listed.items[1]!).toMatchObject({ headers: { default: { linkedToPrevious: true, sourceSection: 1, part: "/word/headerA.xml" }, first: { linkedToPrevious: true, sourceSection: null, part: null }, even: { linkedToPrevious: true, sourceSection: null, part: null } }, direct: { differentFirstPage: false } });
});

it("requires explicit all-section scope to change the document-wide even/odd policy", async () => {
  await expect(edit(multiple, { section: 1, evenAndOddHeaders: true })).rejects.toMatchObject({ code: "usage" });
  const result = await edit(multiple, { all: true, evenAndOddHeaders: true });
  expect(result.listed.evenAndOddHeaders).toBe(true);
  expect(result.data.changes).toHaveLength(3);
  const reset = await edit(paragraph("Bay") + section(), { all: true, evenAndOddHeaders: false });
  expect(reset.listed.evenAndOddHeaders).toBe(false);
});

it.each([{ leftMargin: { value: 9, unit: "in" } }, { gutter: { value: 9, unit: "in" } }, { columns: 100 }, { pageWidth: { value: 0.00001, unit: "pt" } }, { gutter: { value: -1, unit: "pt" } }])("rejects invalid merged section geometry before publication: %j", async options => {
  await expect(edit(multiple, { section: 2, ...options })).rejects.toMatchObject({ code: "usage" });
});

it("rejects revised and duplicate properties and stale section tokens", async () => {
  await expect(edit(paragraph("Bay") + section(geometry + '<w:sectPrChange w:id="1"/>'), { section: 1, columns: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
  await expect(edit(paragraph("Bay") + section(geometry + '<w:pgSz w:w="100" w:h="200"/>'), { section: 1, columns: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
  const listed = await docx.inspectDocumentSections(await textFixture(multiple), {}, textContext);
  await expect(edit(paragraph("New") + section(), { select: listed.items[0]!.location.token, columns: 2 })).rejects.toMatchObject({ code: "stale-selection" });
});

it("preserves missing geometry without inventing previous-section inheritance", async () => {
  const input = await textFixture(boundary() + paragraph("Bay") + section('<w:type w:val="continuous"/>'));
  const info = await docx.inspectDocumentSections(input, {}, textContext);
  expect(info.items[1]!.direct).toMatchObject({ pageWidth: null, pageHeight: null, leftMargin: null, startType: "continuous" });
  await expect(edit(boundary() + section('<w:type w:val="continuous"/>'), { section: 2, columns: 2 })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("rejects edits that cannot isolate a continuous section's missing page properties", async () => {
  await expect(edit(boundary('<w:type w:val="continuous"/>') + paragraph("Bay") + section(), { section: 2, pageWidth: { value: 11, unit: "in" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("keeps an unchanged implicit final owner absent for a no-op policy edit", async () => {
  const result = await edit(paragraph("Bay"), { section: 1, differentFirstPage: false });
  expect(result.data.changed).toBe(false);
  expect(result.body.children.some(n => n.localName === "sectPr")).toBe(false);
});

it("provides correct revision-bound resulting paths when adding an implicit final section", async () => {
  const result = await edit(paragraph("Bay"), {}, "sections.add");
  const after = result.data.changes[0]!.after;
  expect(after.value.path).toEqual(result.listed.items.at(-1)!.location.value.path);
  expect(after.positions.section).toBe(2);
});

it("publishes no bytes on invalid geometry or cancellation and lowers invocation limits", async () => {
  const input = await textFixture(multiple);
  const volume = Volume.fromJSON({ "/out": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  await expect(docx.editDocumentSections(input, { operation: "sections.set", options: { section: 1, gutter: { value: 20, unit: "in" }, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout })).rejects.toMatchObject({ code: "usage" });
  expect(volume.readFileSync("/out").length).toBe(0);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(docx.inspectDocumentSections(input, {}, { ...textContext, signal: cancelled.signal })).rejects.toMatchObject({ code: "cancelled" });
  await expect(docx.inspectDocumentSections(input, { limit: [{ name: "serializedOutput", value: 16 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("inserts multiple section properties before a retained later property in schema order", async () => {
  const result = await edit(paragraph("Bay") + section(geometry + '<w:docGrid w:linePitch="360"/>'), { section: 1, pageNumberStart: 3, columns: 2, differentFirstPage: true });
  expect(result.body.children.at(-1)!.children.map(c => c.localName)).toEqual(["pgSz", "pgMar", "pgNumType", "cols", "titlePg", "docGrid"]);
});

it("rejects page geometry that cannot contain retained unequal columns", async () => {
  const body = paragraph("Bay") + section(geometry + '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="3000" w:space="400"/><w:col w:w="3500" w:space="0"/></w:cols>');
  await expect(edit(body, { section: 1, pageWidth: { value: 4, unit: "in" } })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each([false, true])("preserves all header/footer variants through global policy enable and disable (%s)", async strict => {
  const stories = Object.fromEntries(["header", "footer"].flatMap(kind => ["default", "first", "even"].map(variant => [`${kind}${variant}`, { kind, xml: `<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}">${paragraph(kind + " " + variant + " coast")}</w:${kind === "header" ? "hdr" : "ftr"}>` }])));
  const refs = ["header", "footer"].flatMap(kind => ["default", "first", "even"].map(variant => `<w:${kind}Reference w:type="${variant}" r:id="${kind}${variant}"/>`)).join("");
  const input = await textFixture(boundary(refs + geometry) + boundary() + section(), stories, strict);
  const enabled = await edit(input, { all: true, evenAndOddHeaders: true });
  const disabled = await edit(enabled.bytes, { all: true, evenAndOddHeaders: false });
  expect(disabled.listed.evenAndOddHeaders).toBe(false);
  for (const item of disabled.listed.items) for (const kind of ["headers", "footers"] as const) for (const variant of ["default", "first", "even"] as const) {
    expect(item[kind][variant]).toMatchObject({ linkedToPrevious: item.position !== 1, sourceSection: 1, part: `/word/${kind.slice(0, -1)}${variant}.xml` });
  }
  const before = await docx.readArchive(input, textContext);
  const after = await docx.readArchive(disabled.bytes, textContext);
  for (const member of before.members.filter(m => m.name.startsWith("word/header") || m.name.startsWith("word/footer"))) expect(after.members.find(m => m.name === member.name)!.bytes).toEqual(member.bytes);
});

it("reports custom column count and rejects gap edits without explicit conversion", async () => {
  const body = paragraph("Bay") + section(geometry + '<w:cols w:equalWidth="0"><w:col w:w="4000" w:space="400"/><w:col w:w="4960"/></w:cols>');
  const info = await docx.inspectDocumentSections(await textFixture(body), {}, textContext);
  expect(info.items[0]!.direct).toMatchObject({ columns: 2, equalWidth: false });
  await expect(edit(body, { section: 1, columnGap: { value: 1, unit: "in" } })).rejects.toMatchObject({ code: "unsupported-edit" });
  const converted = await edit(body, { section: 1, columns: 3 });
  expect(converted.listed.items[0]!.direct).toMatchObject({ columns: 3, equalWidth: true });
  expect(converted.body.children.at(-1)!.children.find(c => c.localName === "cols")!.children).toHaveLength(0);
});

it("resolves listed section tokens through the shared location SDK including an implicit final owner", async () => {
  for (const body of [multiple, paragraph("Bay")]) {
    const input = await textFixture(body);
    const info = await docx.inspectDocumentSections(input, {}, textContext);
    const document = await docx.openDocumentLocations(input, textContext);
    for (const item of info.items) expect(document.resolve(item.location.token, "section")).toEqual(item.location);
    expect(document.list("section").map(s => s.token)).toEqual(info.items.map(s => s.location.token));
  }
});

it("rejects geometry edits with a top gutter that consumes vertical content", async () => {
  const stories = { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:gutterAtTop/></w:settings>` } };
  const body = paragraph("Bay") + section(geometry);
  await expect(edit(body, { section: 1, pageHeight: { value: 3, unit: "in" }, gutter: { value: 2, unit: "in" } }, "sections.set", false, stories)).rejects.toMatchObject({ code: "usage" });
});

it("bounds section inventory cardinality before returning results", async () => {
  await expect(docx.inspectDocumentSections(await textFixture(multiple), { limit: [{ name: "matches", value: 2 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
});

it("escapes document-supplied direction controls in human section inventory", async () => {
  const input = await textFixture(paragraph("Bay") + section('<w:pgSz w:w="12240" w:h="15840" w:orient="portrait&#x202E;"/>'));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) });
  let stdout = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["sections", "list", "/input.docx"].map(v => new TextEncoder().encode(v)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(stdout).toContain("portrait");
  expect(stdout).not.toContain("\u202e");
});

it("requires only read authority for section listing", async () => {
  const input = await textFixture(multiple);
  let stdout = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["sections", "list", "/input.docx", "--json"].map(v => new TextEncoder().encode(v)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; }, async lstat() { throw new Error("Publication identity is unavailable"); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout).data.items).toHaveLength(3);
});
