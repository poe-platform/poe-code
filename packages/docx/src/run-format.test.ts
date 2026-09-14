import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as docx from "./index.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

async function format(body: string, options: Record<string, unknown> = {}, strict = false, parts: Record<string, { kind: string; xml: string }> = {}) {
  const input = await textFixture(body, parts, strict);
  const volume = Volume.fromJSON({ "/output": "" });
  const data = await docx.formatDocumentRuns(input, { paragraph: 1, run: 1, bold: true, output: "-", ...options }, {
    ...textContext, encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } }
  });
  const bytes = new Uint8Array(volume.readFileSync("/output") as Buffer);
  const xml = new TextDecoder().decode(await docx.getDocumentXml(bytes, textContext, { part: "/word/document.xml", raw: true }) as Uint8Array);
  return { input, bytes, data, xml, text: await docx.extractDocumentText(bytes, textContext) };
}

it.each([false, true])("formats whole runs without splitting and preserves unrelated properties in dialect %s", async strict => {
  const untouched = '<w:r><w:rPr><w:i/></w:rPr><w:t> untouched</w:t></w:r>';
  const body = '<w:p><w:pPr><w:bidi/></w:pPr><w:r w:rsidR="12345678"><w:rPr><w:rStyle w:val="Emphasis"/><w:bCs/><w:iCs/><w:szCs w:val="30"/><w:rtl/><w:cs/><w:eastAsianLayout w:combine="1"/></w:rPr><w:t>海 coast</w:t></w:r>' + untouched + '</w:p>';
  const result = await format(body, { italic: false, strike: true, underline: { enum: "WD_UNDERLINE", name: "DOUBLE" }, size: { value: 11.5, unit: "pt" }, hidden: false }, strict, { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style></w:styles>` } });
  expect(result.text.text).toBe("海 coast untouched");
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["海 coast", true, false], [" untouched", null, true]]);
  expect(result.xml.split('<w:r ').length - 1).toBe(1);
  for (const value of [untouched, '<w:pPr><w:bidi/></w:pPr>', '<w:bCs/>', '<w:iCs/>', '<w:szCs w:val="30"/>', '<w:rtl/>', '<w:cs/>', '<w:eastAsianLayout w:combine="1"/>', '<w:rStyle w:val="Emphasis"/>']) expect(result.xml).toContain(value);
  const parsed = docx.parseDocumentXml(new TextEncoder().encode(result.xml));
  const props = parsed.root.children[0]!.children[0]!.children[1]!.children[0]!;
  expect(props.children.find(c => c.localName === "sz")?.attributes.find(a => a.localName === "val")?.value).toBe("23");
  expect(result.data.changes).toHaveLength(1);
  expect(await docx.getDocumentXml(result.bytes, textContext, { part: "/word/styles.xml", raw: true }))
    .toEqual(await docx.getDocumentXml(result.input, textContext, { part: "/word/styles.xml", raw: true }));
});

it("distinguishes removal, explicit defaults and semantically unchanged formatting", async () => {
  const body = '<w:p><w:r><w:rPr><!--retain--><w:b w:val="on"/><w:i/><w:u w:val="double"/><w:vertAlign w:val="superscript"/><w:color w:val="112233"/></w:rPr><w:t>coast</w:t></w:r></w:p>';
  const same = await format(body);
  expect(same.data).toMatchObject({ changed: false, changes: [] });
  expect(await docx.getDocumentXml(same.bytes, textContext, { part: "/word/document.xml", raw: true })).toEqual(await docx.getDocumentXml(same.input, textContext, { part: "/word/document.xml", raw: true }));
  const reset = await format(body, { bold: null, italic: false, underline: false, superscript: false, color: null });
  expect(reset.xml).toContain('<!--retain-->');
  expect(reset.text.segments[0]!.formatting).toMatchObject({ bold: null, italic: false });
  expect(reset.xml).toContain('w:val="baseline"');
  expect(reset.xml).toContain('w:val="none"');
  expect(reset.xml).not.toContain('<w:color');
});

it("splits only the exact scalar range, preserving prefix and suffix run structure", async () => {
  const body = '<w:p><w:r><w:rPr><w:i/><w:rFonts w:eastAsia="Coastal CJK"/></w:rPr><w:t>🌊ab</w:t><w:tab/><w:t>海cd</w:t></w:r>' + run(" untouched") + '</w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const selected = document.range(document.at("run", 1, { owner: document.at("paragraph", 1).token }).token, 2, 5);
  const result = await format(body, { paragraph: undefined, run: undefined, select: selected.token });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold])).toEqual([["🌊a", null], ["b", true], ["\t", true], ["海", true], ["cd", null], [" untouched", null]]);
  expect(result.xml).toContain(run(" untouched"));
  expect(result.data.changes[0]!.before.value.range).toEqual({ start: 2, end: 5 });
  expect(result.data.changes[0]!.after.value.range).toEqual({ start: 2, end: 5 });
});

it("formats a paragraph range across runs without flattening distinct styles", async () => {
  const body = '<w:p>' + run("🌊ab") + '<w:r><w:rPr><w:i/></w:rPr><w:t>cd海</w:t></w:r></w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const selected = document.range(document.at("paragraph", 1).token, 2, 5);
  const result = await format(body, { paragraph: undefined, run: undefined, select: selected.token });
  expect(result.text.segments.map(s => [s.text, s.formatting.bold, s.formatting.italic])).toEqual([["🌊a", null, null], ["b", true, null], ["cd", true, true], ["海", null, true]]);
});

it("merges changed adjacent equivalent runs but retains style and marker boundaries", async () => {
  const result = await format('<w:p>' + run("a") + '<w:r><w:rPr><w:b w:val="on"/></w:rPr><w:t>b</w:t></w:r><w:bookmarkStart w:id="1" w:name="Coast"/>' + run("c") + '<w:bookmarkEnd w:id="1"/></w:p>', { paragraph: undefined, run: undefined, all: true });
  const document = await docx.openDocumentLocations(result.bytes, textContext);
  expect(document.list("run")).toHaveLength(2);
  expect(result.text.text).toBe("abc");
  expect(result.data.changes).toHaveLength(3);
  expect(result.xml).toContain('<w:bookmarkStart w:id="1" w:name="Coast"/>');
});

it("reports empty formatted runs at their exact paragraph scalar position", async () => {
  const result = await format('<w:p><w:r/>' + run("tail") + '</w:p>');
  expect(result.data.changes[0]!.after).toMatchObject({ kind: "paragraph", value: { generation: 1, range: { start: 0, end: 0 } } });
  expect(result.text.text).toBe("tail");
});

it("updates font and language attributes without losing complex-script and theme metadata", async () => {
  const body = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Old" w:hAnsi="Old" w:eastAsia="海" w:cs="Coastal Arabic" w:cstheme="minorBidi" w:hint="eastAsia"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/><w:color w:val="112233" w:themeColor="accent1" w:themeTint="80"/></w:rPr><w:t>coast</w:t></w:r></w:p>';
  const result = await format(body, { bold: undefined, font: "Coastal Sans", language: "fr-CA", themeColor: { enum: "MSO_THEME_COLOR", name: "ACCENT_2" } });
  for (const value of ['w:eastAsia="海"', 'w:cs="Coastal Arabic"', 'w:cstheme="minorBidi"', 'w:hint="eastAsia"', 'w:eastAsia="ja-JP"', 'w:bidi="ar-SA"', 'w:themeTint="80"', 'w:themeColor="accent2"']) expect(result.xml).toContain(value);
  expect(result.text.segments[0]!.formatting.fonts).toMatchObject({ ascii: "Coastal Sans", hAnsi: "Coastal Sans" });
  const cleared = await format(body, { bold: undefined, font: null, language: null, size: null });
  expect(cleared.text.segments[0]!.formatting.fonts).not.toHaveProperty("ascii");
  expect(cleared.text.segments[0]!.formatting.language).toEqual({ eastAsia: "ja-JP", bidi: "ar-SA" });
});

it.each([{ size: { value: 0.1, unit: "pt" } }, { size: { value: 12, unit: "px" } }, { size: { value: 1639, unit: "pt" } }, { underline: "DOUBLE" }, { highlight: { enum: "WD_COLOR_INDEX", name: "INHERITED" } }, { language: "bad_tag" }, { baseline: "floating" }, { baseline: "baseline", superscript: true }, { font: "" }])("rejects invalid formatting before publication: %j", async options => {
  await expect(format(paragraph("coast"), options)).rejects.toMatchObject({ code: "usage" });
});

it("rejects stale selections, locked controls and partial complex runs without output", async () => {
  const document = await docx.openDocumentLocations(await textFixture(paragraph("coast")), textContext);
  const select = document.range(document.at("run", 1, { owner: document.at("paragraph", 1).token }).token, 1, 3).token;
  await expect(format(paragraph("changed"), { select, paragraph: undefined, run: undefined })).rejects.toMatchObject({ code: "stale-selection" });
  await expect(format('<w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' + run("coast") + '</w:sdtContent></w:sdt></w:p>')).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("does not merge into an unselected equivalent neighbor or discard inline comments", async () => {
  const neighbor = '<w:r><w:rPr><w:b/></w:rPr><w:t>untouched<!--retain--></w:t></w:r>';
  const result = await format('<w:p>' + run("coast") + neighbor + '</w:p>');
  expect(result.xml).toContain(neighbor);
  expect((await docx.openDocumentLocations(result.bytes, textContext)).list("run")).toHaveLength(2);
});

it("does not change unselected field instructions through a visible text range", async () => {
  const body = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>coast</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const document = await docx.openDocumentLocations(await textFixture(body), textContext);
  const paragraph = document.at("paragraph", 1);
  expect(() => document.range(paragraph.token, 0, 5)).toThrow();
  const select = docx.encodeLocation({ ...paragraph.value, range: { start: 0, end: 5 } });
  await expect(format(body, { paragraph: undefined, run: undefined, select })).rejects.toMatchObject({ code: "stale-selection" });
});
