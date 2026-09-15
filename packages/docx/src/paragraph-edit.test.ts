import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture } from "../tests/fixtures/text.js";

async function edit(body: string, operation: "paragraphs.set" | "paragraphs.add" | "runs.add", options: Record<string, unknown>, strict = false) {
  const input = await textFixture(body, {}, strict);
  const volume = Volume.fromJSON({ "/out": "" });
  const data = await docx.editDocumentParagraphs(input, { operation, options: { output: "-", ...options } }, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { data, bytes, xml, root: docx.parseDocumentXml(new TextEncoder().encode(xml)).root, text: await docx.extractDocumentText(bytes, textContext) };
}
const attr = (node: docx.XmlElement | undefined, key: string) => node?.attributes.find(a => a.localName === key)?.value;

it.each([false, true])("edits paragraph properties while retaining mixed runs and section properties (%s)", async strict => {
  const content = run("Coast ") + '<w:r><w:rPr><w:i/></w:rPr><w:t>海</w:t></w:r>';
  const result = await edit(`<w:p><w:pPr><!--retain--><w:ind w:${strict ? 'end' : 'right'}="80" w:${strict ? 'startChars' : 'leftChars'}="100"/><w:spacing w:after="90"/><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr>` + content + '</w:p>', "paragraphs.set", {
    paragraph: 1, alignment: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" }, leftIndent: { value: -0.5, unit: "in" }, firstLineIndent: { value: -12, unit: "pt" },
    spaceBefore: { value: 6, unit: "pt" }, lineSpacing: 1.5, keepWithNext: true, keepTogether: false, widowControl: null, pageBreakBefore: true, outlineLevel: 9
  }, strict);
  const props = result.root.children[0]!.children[0]!.children[0]!;
  const get = (name: string) => props.children.find(c => c.localName === name);
  expect(attr(get("jc"), "val")).toBe("center");
  expect(attr(get("ind"), strict ? "start" : "left")).toBe("-720");
  expect(attr(get("ind"), "hanging")).toBe("240");
  expect(attr(get("ind"), strict ? "end" : "right")).toBe("80");
  expect(attr(get("ind"), strict ? "startChars" : "leftChars")).toBeUndefined();
  expect(attr(get("spacing"), "before")).toBe("120");
  expect(attr(get("spacing"), "after")).toBe("90");
  expect(attr(get("spacing"), "line")).toBe("360");
  expect(attr(get("spacing"), "lineRule")).toBe("auto");
  expect(attr(get("keepLines"), "val")).toBe("0");
  expect(attr(get("outlineLvl"), "val")).toBe("9");
  expect(result.xml).toContain(content);
  expect(result.xml).toContain('<!--retain-->');
  expect(result.xml).toContain('<w:sectPr><w:cols w:num="2"/></w:sectPr>');
  expect(props.children.at(-1)?.localName).toBe("sectPr");
});

it("uses Strict directional names for alignment, indentation and tab stops", async () => {
  const result = await edit(paragraph("Harbor"), "paragraphs.set", { paragraph: 1, alignment: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "RIGHT" }, leftIndent: { value: 1, unit: "pt" }, rightIndent: { value: 2, unit: "pt" }, tabStops: [{ position: { value: 1, unit: "in" }, alignment: { enum: "WD_TAB_ALIGNMENT", name: "LEFT" } }] }, true);
  const props = result.root.children[0]!.children[0]!.children[0]!;
  expect(attr(props.children.find(c => c.localName === "jc"), "val")).toBe("end");
  expect(attr(props.children.find(c => c.localName === "ind"), "start")).toBe("20");
  expect(attr(props.children.find(c => c.localName === "ind"), "end")).toBe("40");
  expect(attr(props.children.find(c => c.localName === "tabs")!.children[0], "val")).toBe("start");
});

it("accepts before with a whole paragraph token", async () => {
  const body = paragraph("Harbor");
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const result = await edit(body, "paragraphs.add", { select: document.at("paragraph", 1).token, before: true, text: "First" });
  expect(result.text.text).toBe("First\nHarbor");
});

it("sorts tab stops with leaders and merges border sides and shading", async () => {
  const result = await edit('<w:p><w:pPr><w:pBdr><w:top w:val="double" w:sz="8"/></w:pBdr></w:pPr>' + run("Harbor") + '</w:p>', "paragraphs.set", {
    paragraph: 1, tabStops: [{ position: { value: 2, unit: "in" }, alignment: { enum: "WD_TAB_ALIGNMENT", name: "RIGHT" }, leader: { enum: "WD_TAB_LEADER", name: "DOTS" } }, { position: { value: -12, unit: "pt" } }],
    borders: { bottom: { style: "single", width: { value: 1, unit: "pt" }, color: "112233", space: { value: 2, unit: "pt" } } },
    shading: { fill: "ABCDEF", pattern: "clear" }, lineSpacing: { value: 14, unit: "pt" }
  });
  const props = result.root.children[0]!.children[0]!.children[0]!;
  expect(props.children.find(c => c.localName === "tabs")!.children.map(c => [attr(c, "pos"), attr(c, "val"), attr(c, "leader")])).toEqual([["-240", "left", "none"], ["2880", "right", "dot"]]);
  expect(result.xml).toContain('<w:top w:val="double" w:sz="8"/>');
  const border = props.children.find(c => c.localName === "pBdr")!.children.find(c => c.localName === "bottom");
  expect(attr(border, "sz")).toBe("8");
  expect(attr(border, "space")).toBe("2");
  expect(attr(props.children.find(c => c.localName === "spacing"), "lineRule")).toBe("exact");
});

it("clears whole paragraph text but retains properties and annotation markers", async () => {
  const result = await edit('<w:p><w:pPr><w:keepNext/></w:pPr><w:bookmarkStart w:id="3" w:name="Harbor"/><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r><w:bookmarkEnd w:id="3"/></w:p>', "paragraphs.set", { paragraph: 1, text: null });
  expect(result.text.text).toBe("");
  expect(result.xml).toContain('<w:keepNext/>');
  expect(result.xml).toContain('<w:bookmarkStart w:id="3" w:name="Harbor"/>');
  expect(result.xml).not.toContain('<w:b/>');
  expect((await docx.openDocumentLocations(result.bytes, textContext)).list("paragraph")).toHaveLength(1);
});

it.each(["paragraphs.add", "runs.add"] as const)("inserts at a scalar caret without dropping formatted suffix text: %s", async operation => {
  const body = '<w:p><w:pPr><w:keepNext/><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>🌊abc</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> tail</w:t></w:r></w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const select = document.range(document.at("paragraph", 1).token, 2, 2).token;
  const result = await edit(body, operation, { select, text: "NEW" });
  expect(result.text.text).toBe(operation === "paragraphs.add" ? "🌊a\nNEW\nbc tail" : "🌊aNEWbc tail");
  expect(result.text.segments.filter(s => s.text === "bc")[0]!.formatting.bold).toBe(true);
  expect(result.text.segments.filter(s => s.text === " tail")[0]!.formatting.italic).toBe(true);
  expect(result.xml.split('<w:cols w:num="2"/>')).toHaveLength(2);
  const paragraphs = result.root.children[0]!.children.filter(c => c.localName === "p");
  expect(paragraphs.at(-1)!.children[0]!.children.some(c => c.localName === "sectPr")).toBe(true);
});

it("appends blocks before final section properties and inside a nested table cell", async () => {
  const table = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>';
  const end = '</w:tc></w:tr></w:tbl>';
  const body = table + table + paragraph("Inner") + end + '<w:p/>' + end + '<w:sectPr><w:cols w:num="1"/></w:sectPr>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const cell = document.cell(document.at("table", 2).token, "A1");
  const nested = await edit(body, "paragraphs.add", { select: cell.token, text: "Added" });
  expect(nested.text.text).toContain("Inner\nAdded");
  const appended = await edit(body, "paragraphs.add", { text: "Last" });
  expect(appended.root.children[0]!.children.at(-1)!.localName).toBe("sectPr");
  expect(appended.root.children[0]!.children.at(-2)!.localName).toBe("p");
});

it.each(["page", "column", "line"] as const)("inserts an explicit %s break inline", async kind => {
  const result = await edit(paragraph("Harbor"), "runs.add", { paragraph: 1, break: kind });
  const p = result.root.children[0]!.children[0]!;
  expect(attr(p.children.at(-1)!.children[0], "type")).toBe(kind === "line" ? "textWrapping" : kind);
});

it.each([{ spaceBefore: { value: -0.000001, unit: "pt" } }, { lineSpacing: { value: -0.000001, unit: "pt" } }, { leftIndent: { value: Number.MAX_SAFE_INTEGER, unit: "pt" } }, { lineSpacing: 0 }, { outlineLevel: 10 }, { tabStops: [{ position: { value: 1, unit: "px" } }] }, { tabStops: [{ position: { value: 1, unit: "in" } }, { position: { value: 72, unit: "pt" } }] }, { borders: { top: { style: "single", color: "112233", width: { value: 13, unit: "pt" } } } }])("rejects invalid paragraph values before output: %j", async options => {
  await expect(edit(paragraph("Harbor"), "paragraphs.set", { paragraph: 1, ...options })).rejects.toMatchObject({ code: "usage" });
});

it("admits safe schema integers beyond signed 32-bit storage and rounds negative halves away from zero", async () => {
  const result = await edit(paragraph("Harbor"), "paragraphs.set", { paragraph: 1, leftIndent: { value: 2147483648, unit: "pt" }, firstLineIndent: { value: -0.025, unit: "pt" } });
  const indentation = result.root.children[0]!.children[0]!.children[0]!.children[0];
  expect(attr(indentation, "left")).toBe("42949672960");
  expect(attr(indentation, "hanging")).toBe("1");
});

it("rejects whole-text assignment over XML comments inside a run without discarding them", async () => {
  await expect(edit('<w:p><w:r><!--retain--><w:t>Harbor</w:t></w:r></w:p>', "paragraphs.set", { paragraph: 1, text: "Coast" })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it.each(["paragraphs.add", "runs.add"] as const)("rejects nonempty insertion ranges without publishing: %s", async operation => {
  const body = paragraph("Harbor");
  const input = await textFixture(body);
  const document = await docx.openDocumentLocations(input, textContext);
  const select = document.range(document.at("paragraph", 1).token, 1, 3).token;
  const writes: Uint8Array[] = [];
  await expect(docx.editDocumentParagraphs(input, { operation, options: { select, text: "Coast", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { writes.push(bytes); } } })).rejects.toMatchObject({ code: "usage" });
  expect(writes).toEqual([]);
});

it("rejects stale selections and protected content before publication", async () => {
  const document = await docx.openDocumentLocations(await textFixture(paragraph("Old")), textContext);
  await expect(edit(paragraph("New"), "paragraphs.set", { select: document.at("paragraph", 1).token, keepTogether: true })).rejects.toMatchObject({ code: "stale-selection" });
  await expect(edit('<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' + paragraph("Harbor") + '</w:sdtContent></w:sdt>', "paragraphs.set", { paragraph: 1, keepTogether: true })).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("executes paragraph flags through the common command engine and advertises edit support", async () => {
  const input = await textFixture(paragraph("Harbor"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) });
  let stdout = "";
  const result = await docx.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["paragraphs", "set", "/input.docx", "--paragraph", "1", "--alignment", "CENTER", "--line-spacing", "1.5", "--tab-stops-json", '[{"position":{"value":1,"unit":"in"}}]', "--dry-run", "--json"].map(v => new TextEncoder().encode(v)),
    cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ operation: "paragraphs.set", ok: true, affected: 1, data: { changed: true, dryRun: true, output: null } });
  const discovery = docx.getDocxDiscovery(docx.parseDocxArguments(["schema", "paragraphs", "set"].map(v => new TextEncoder().encode(v))))!;
  expect(discovery.data).toMatchObject({ operations: [{ support: "edit" }] });
});

it("emits paragraph and border properties in schema order", async () => {
  const result = await edit('<w:p><w:pPr><w:spacing w:after="20"/><w:sectPr/></w:pPr>' + run("Harbor") + '</w:p>', "paragraphs.set", {
    paragraph: 1, keepWithNext: true, keepTogether: true, widowControl: true, pageBreakBefore: true,
    alignment: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "RIGHT" }, outlineLevel: 2,
    borders: { right: { style: "single", width: { value: 1, unit: "pt" }, color: "112233" }, top: { style: "double", width: { value: 1, unit: "pt" }, color: "112233" } }
  });
  expect(result.root.children[0]!.children[0]!.children[0]!.children.map(c => c.localName)).toEqual(["keepNext", "keepLines", "pageBreakBefore", "widowControl", "pBdr", "spacing", "jc", "outlineLvl", "sectPr"]);
  const merged = await edit('<w:p><w:pPr><w:pBdr><w:bottom w:val="double" w:sz="8"/></w:pBdr></w:pPr>' + run("Harbor") + '</w:p>', "paragraphs.set", { paragraph: 1, borders: { top: { style: "single", width: { value: 1, unit: "pt" }, color: "112233" } } });
  expect(merged.root.children[0]!.children[0]!.children[0]!.children[0]!.children.map(c => c.localName)).toEqual(["top", "bottom"]);
});

it("resets nullable indentation and spacing without discarding sibling attributes", async () => {
  const result = await edit('<w:p><w:pPr><w:ind w:left="40" w:leftChars="100" w:right="60" w:firstLine="20"/><w:spacing w:line="240" w:lineRule="auto" w:before="20" w:beforeAutospacing="1" w:after="40"/><w:tabs><w:tab w:pos="720" w:val="left"/></w:tabs><w:shd w:fill="112233"/></w:pPr>' + run("Harbor") + '</w:p>', "paragraphs.set", {
    paragraph: 1, leftIndent: null, firstLineIndent: null, spaceBefore: null, lineSpacing: null, tabStops: null, shading: null
  });
  const props = result.root.children[0]!.children[0]!.children[0]!;
  expect(props.children.find(c => c.localName === "ind")!.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => [a.localName, a.value])).toEqual([["right", "60"]]);
  expect(props.children.find(c => c.localName === "spacing")!.attributes.filter(a => a.namespace !== "http://www.w3.org/2000/xmlns/").map(a => [a.localName, a.value])).toEqual([["after", "40"]]);
  expect(props.children.some(c => ["tabs", "shd"].includes(c.localName))).toBe(false);
});

it.each([0, 4])("keeps both required paragraphs at boundary caret %s", async caret => {
  const body = paragraph("🌊abc");
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const select = document.range(document.at("paragraph", 1).token, caret, caret).token;
  const result = await edit(body, "paragraphs.add", { select });
  expect(result.root.children[0]!.children.filter(c => c.localName === "p")).toHaveLength(3);
  expect(result.text.text).toBe(caret === 0 ? "\n\n🌊abc" : "🌊abc\n\n");
});

it("retains byte-identical XML when direct formatting has the same meaning", async () => {
  const body = '<w:p><w:pPr><w:keepNext w:val="on"/><w:jc w:val="center"/></w:pPr>' + run("Harbor") + '</w:p>';
  const result = await edit(body, "paragraphs.set", { paragraph: 1, keepWithNext: true, alignment: { enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" } });
  expect(result.data).toMatchObject({ changed: false, changes: [] });
  expect(result.xml).toContain(body);
});

it("does not materialize inherited properties when resetting an unformatted paragraph", async () => {
  const body = paragraph("Harbor");
  const result = await edit(body, "paragraphs.set", { paragraph: 1, leftIndent: null, spaceBefore: null, lineSpacing: null, lineSpacingRule: null, borders: {}, shading: null, tabStops: [] });
  expect(result.data).toMatchObject({ changed: false, changes: [] });
  expect(result.xml).toContain(body);
});

it.each([{ lineSpacing: 1.5, lineSpacingRule: { enum: "WD_LINE_SPACING", name: "AT_LEAST" } }, { lineSpacing: { value: 12, unit: "pt" }, lineSpacingRule: { enum: "WD_LINE_SPACING", name: "MULTIPLE" } }])("rejects conflicting spacing representations: %j", async options => {
  await expect(edit(paragraph("Harbor"), "paragraphs.set", { paragraph: 1, ...options })).rejects.toMatchObject({ code: "usage" });
});

it.each([["SINGLE", "240", "auto"], ["ONE_POINT_FIVE", "360", "auto"], ["DOUBLE", "480", "auto"], ["MULTIPLE", "400", "auto"], ["AT_LEAST", "400", "atLeast"], ["EXACTLY", "400", "exact"]])("sets the %s line spacing rule", async (name, line, rule) => {
  const result = await edit('<w:p><w:pPr><w:spacing w:line="400" w:lineRule="exact"/></w:pPr>' + run("Harbor") + '</w:p>', "paragraphs.set", { paragraph: 1, lineSpacingRule: { enum: "WD_LINE_SPACING", name } });
  const spacing = result.root.children[0]!.children[0]!.children[0]!.children[0];
  expect([attr(spacing, "line"), attr(spacing, "lineRule")]).toEqual([line, rule]);
});

it("formats all paragraphs in a nested cell and leaves body neighbors intact", async () => {
  const table = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc>';
  const end = '</w:tc></w:tr></w:tbl>';
  const body = paragraph("Outside") + table + table + paragraph("Inner A") + paragraph("Inner B") + end + '<w:p/>' + end;
  const result = await edit(body, "paragraphs.set", { table: 2, cell: "A1", all: true, keepWithNext: true });
  expect(result.data.changes).toHaveLength(2);
  expect(result.xml).toContain(paragraph("Outside"));
  expect(result.text.text).toContain("Inner A\nInner B");
});

it.each([0, 1, 9])("adds heading level %s through paragraph edits with a materialized reusable style", async level => {
  const result = await edit(paragraph("Existing coast"), "paragraphs.add", { paragraph: 1, level, text: "Survey heading" });
  const info = await docx.inspectDocumentStyles(result.bytes, {}, textContext);
  expect(info.styles).toHaveLength(1);
  expect(info.styles[0]).toMatchObject({ name: level === 0 ? "Title" : `Heading ${level}`, type: "paragraph", direct: { outlineLevel: level === 0 ? null : level - 1 } });
  expect(result.text.text).toContain("Survey heading");
  const volume = Volume.fromJSON({ "/out": "" });
  await docx.editDocumentParagraphs(result.bytes, { operation: "paragraphs.add", options: { paragraph: 1, level, text: "Second heading", output: "-" } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }
  });
  expect((await docx.inspectDocumentStyles(new Uint8Array(volume.readFileSync("/out") as Buffer), {}, textContext)).styles).toHaveLength(1);
});

it('checks grouped box restrictions before unchanged paragraph formatting', async () => {
 const {groupedNativeBox}=await import('../tests/fixtures/shapes.js');
 await expect(edit(groupedNativeBox(),'paragraphs.set',{scope:'text-boxes',paragraph:1,keepTogether:null})).rejects.toMatchObject({code:'unsupported-edit'});
});
