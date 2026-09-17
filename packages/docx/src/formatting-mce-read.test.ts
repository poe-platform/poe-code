import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentBudget, Twips, WD_ALIGN_PARAGRAPH, applyStyleModelBatch, createDocxInspectionCommandEngine, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const paragraphProperties = '<w:jc w:val="center"/><w:keepNext/><w:ind w:left="720"/><w:spacing w:after="200" w:line="360"/><w:tabs><w:tab w:val="right" w:pos="720" w:leader="dot"/></w:tabs>';
const runProperties = '<w:rFonts w:ascii="Original Face"/><w:b/><w:i w:val="0"/><w:color w:val="123456"/><w:sz w:val="28"/><w:u w:val="single"/><w:vertAlign w:val="superscript"/>';
const alternate = (selected: string, fallback = "", requires = "w") => `<mc:AlternateContent xmlns:mc="${mc}" xmlns:f="urn:original:future"><mc:Choice Requires="${requires}">${selected}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const fixtures: readonly { name: string; p: string; r: string; whole: boolean; attrs: string; wrap?: (markup: string) => string }[] = [
  { name: "direct control", p: paragraphProperties, r: runProperties, whole: false, attrs: "" },
  { name: "selected properties", p: alternate(paragraphProperties, '<w:jc w:val="right"/>'), r: alternate(runProperties, '<w:b w:val="0"/>'), whole: false, attrs: "" },
  { name: "fallback properties", p: alternate('<w:jc w:val="right"/>', paragraphProperties, "f"), r: alternate('<w:b w:val="0"/>', runProperties, "f"), whole: false, attrs: "" },
  { name: "selected property containers", p: alternate(`<w:pPr>${paragraphProperties}</w:pPr>`), r: alternate(`<w:rPr>${runProperties}</w:rPr>`), whole: true, attrs: "" },
  { name: "inherited ProcessContent", p: `<f:pass>${paragraphProperties}</f:pass>`, r: `<f:pass>${runProperties}</f:pass>`, whole: false, attrs: ` xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"` },
  { name: "ancestor ProcessContent", p: `<f:pass>${paragraphProperties}</f:pass>`, r: `<f:pass>${runProperties}</f:pass>`, whole: false, attrs: "", wrap: markup => `<f:container xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:container f:pass">${markup}</f:container>` }
];

for (const strict of [false, true]) for (const route of ["model", "batch", "tabs"] as const) it.each(fixtures)(
  `${strict ? "Strict" : "Transitional"} ${route} reads $name without rewriting stored formatting`,
  async ({ p, r, whole, attrs, wrap }) => {
    const body = `<w:p${attrs}>${whole ? p : `<w:pPr>${p}</w:pPr>`}<w:r>${whole ? r : `<w:rPr>${r}</w:rPr>`}<w:t>Original text</w:t></w:r></w:p>`;
    const input = await textFixture(wrap ? wrap(body) : body, {}, strict);
    const document = await Document(input, textContext);
    const beforeXml = document.element.serialize();
    const paragraph = document.paragraphs[0]!, run = paragraph.runs[0]!, format = paragraph.paragraph_format, font = run.font;
    if (route === "model") {
      expect({
        alignment: paragraph.alignment?.name, keepWithNext: format.keep_with_next,
        left: format.left_indent?.twips, after: format.space_after?.twips, line: format.line_spacing,
        bold: run.bold, italic: run.italic, size: font.size?.pt, name: font.name,
        underline: font.underline, color: font.color.rgb?.toString(), superscript: font.superscript
      }).toEqual({ alignment: "CENTER", keepWithNext: true, left: 720, after: 200, line: 1.5, bold: true, italic: false, size: 14, name: "Original Face", underline: true, color: "123456", superscript: true });
    } else if (route === "tabs") {
      const tabs = format.tab_stops;
      expect([...tabs].map(tab => [tab.position.twips, tab.alignment.name, tab.leader.name])).toEqual([[720, "RIGHT", "DOTS"]]);
      expect(tabs.element.localName).toBe("pPr");
      expect(tabs.at(0).element.localName).toBe("tab");
    } else {
      const batch = { version: 1, operations: [
        { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
        { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
        { operation: "model.text.paragraph.Paragraph.alignment.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {} },
        { operation: "model.text.run.Run.bold.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {} },
        { operation: "model.text.run.Run.italic.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {} }
      ] };
      const expected = [{ enum: "WD_PARAGRAPH_ALIGNMENT", name: "CENTER" }, true, false];
      const sdk = await applyStyleModelBatch(input, batch, textContext);
      expect(sdk.affected).toBe(0);
      expect(sdk.results.slice(2).map(result => result.value)).toEqual(expected);
      const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input.docx", "--ops-json", JSON.stringify(batch), "--json"].map(word => new TextEncoder().encode(word)),
        cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } },
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      expect(envelope.data.results.slice(2).map((result: { value: unknown }) => result.value)).toEqual(expected);
      expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    }
    expect(document.element.serialize()).toEqual(beforeXml);
    const output = Volume.fromJSON({ "/saved": "" });
    await document.save({ async write(bytes) { output.appendFileSync("/saved", bytes); } });
    const saved = new Uint8Array(output.readFileSync("/saved") as Buffer);
    const before = await readArchive(input, textContext), after = await readArchive(saved, textContext);
    expect(after.members.map(member => [member.name, member.bytes])).toEqual(before.members.map(member => [member.name, member.bytes]));
    expect((await Document(saved, textContext)).paragraphs[0]!.text).toBe("Original text");
  }
);

for (const strict of [false, true]) it.each(fixtures.filter(item => item.name !== "direct control"))(
  `retains ${strict ? "Strict" : "Transitional"} $name after refused formatting edits`,
  async ({ p, r, whole, attrs, wrap }) => {
    const body = `<w:p${attrs}>${whole ? p : `<w:pPr>${p}</w:pPr>`}<w:r>${whole ? r : `<w:rPr>${r}</w:rPr>`}<w:t>Original text</w:t></w:r></w:p>`;
    const input = await textFixture(wrap ? wrap(body) : body, {}, strict);
    const document = await Document(input, textContext), paragraph = document.paragraphs[0]!, font = paragraph.runs[0]!.font;
    const before = document.element.serialize(), tabs = paragraph.paragraph_format.tab_stops, tab = tabs.at(0);
    for (const action of [
      () => { paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT; },
      () => { font.bold = false; },
      () => { tab.position = Twips(1440); },
      () => { tabs.remove(0); },
      () => { tabs.clear_all(); },
      () => { tabs.add_tab_stop(Twips(1440)); },
      () => { tab.element.set_attribute({ namespaceURI: tab.element.namespace, localName: "pos" }, "1440"); }
    ]) {
      expect(action).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
      expect(document.element.serialize()).toEqual(before);
      expect(paragraph.alignment?.name).toBe("CENTER");
      expect(font.bold).toBe(true);
      expect(tab.position.twips).toBe(720);
    }
  }
);

it("keeps repeated live formatting reads bounded and cancellable", async () => {
  const body = Array.from({ length: 100 }, () => '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Original</w:t></w:r></w:p>').join("");
  const input = await textFixture(body), controller = new AbortController();
  const budget = new DocumentBudget({ retainedBytes: 2 * 1024 * 1024 }, controller.signal);
  const document = await Document(input, { ...textContext, signal: controller.signal, budget });
  expect(document.paragraphs.map(p => [p.alignment?.name, p.runs[0]!.bold])).toEqual(Array.from({ length: 100 }, () => ["CENTER", true]));
  const font = document.paragraphs[0]!.runs[0]!.font, before = budget.usage;
  for (let i = 0; i < 100; i++) expect(font.bold).toBe(true);
  expect(budget.usage.retainedBytes).toBe(before.retainedBytes);
  expect(budget.usage.work).toBeGreaterThan(before.work);
  controller.abort();
  expect(() => font.bold).toThrow("cancelled");
});

it("edits through an owned formatting XML view and retains a neighboring alternate", async () => {
  const retained = alternate('<w:p><w:r><w:t>Selected neighbor</w:t></w:r></w:p>', '<w:p><w:r><w:t>Inactive neighbor</w:t></w:r></w:p>');
  const input = await textFixture('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Plain</w:t></w:r></w:p>' + retained);
  const document = await Document(input, textContext), paragraph = document.paragraphs[0]!;
  const alignment = paragraph.paragraph_format.element.children[0]!.children[0]!;
  expect(alignment.localName).toBe("jc");
  alignment.set_attribute({ namespaceURI: alignment.namespace, localName: "val" }, "right");
  expect(paragraph.alignment?.name).toBe("RIGHT");
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  const reopened = await Document(output, textContext);
  expect(reopened.paragraphs[0]!.alignment?.name).toBe("RIGHT");
  expect(reopened.paragraphs[1]!.text).toBe("Selected neighbor");
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) {
    const next = after.members.find(item => item.name === member.name)!;
    if (member.name === "word/document.xml") expect(new TextDecoder().decode(next.bytes)).toContain(retained);
    else expect(next.bytes).toEqual(member.bytes);
  }
});
