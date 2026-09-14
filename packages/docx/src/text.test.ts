import { expect, it } from "vitest";
import { extractDocumentText, openDocumentLocations, DocumentBudget } from "./index.js";
import { textFixture, textContext, w, run, paragraph, table } from "../tests/fixtures/text.js";

it.each([false, true])("preserves logical Unicode, nested blocks and authored breaks (strict=%s)", async strict => {
  const bytes = await textFixture(`<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/><w:rtl/><w:lang w:val="ar" w:eastAsia="ja-JP"/><w:rFonts w:eastAsia="Serif"/></w:rPr><w:t>مرحبًا 日本語 é 🌊</w:t><w:tab/><w:t>東京</w:t><w:br/><w:t>Next</w:t><w:br w:type="page"/><w:br w:type="column"/><w:lastRenderedPageBreak/></w:r></w:p>${table([paragraph("A") + table([paragraph("内"), paragraph("側")]) + paragraph("B"), paragraph("C")])}${paragraph("End")}`, {}, strict);
  const result = await extractDocumentText(bytes, textContext);
  expect(result.text).toBe("مرحبًا 日本語 é 🌊\t東京\nNext\f\v\nA\n内\t側\nB\tC\nEnd");
  expect(result.segments.map(segment => segment.text).join("")).toBe(result.text);
  expect(result.segments[0]).toMatchObject({ revision: "unchanged", location: { kind: "run" }, formatting: { bold: true, rtl: true, hidden: null, language: { val: "ar", eastAsia: "ja-JP" }, fonts: { eastAsia: "Serif" }, paragraph: { bidi: true } } });
  const document = await openDocumentLocations(bytes, textContext);
  for (const segment of result.segments) expect(document.resolve(segment.location.token)).toEqual(segment.location);
});

it("orders all story scopes and deduplicates shared parts", async () => {
  const section = '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/></w:sectPr>';
  const box = `<w:p><w:r><w:txbxContent>${paragraph("Box")}</w:txbxContent></w:r></w:p>`;
  const bytes = await textFixture(`${paragraph("Body")}<w:p><w:pPr>${section}</w:pPr>${run("Second")}</w:p>${box}${section}`, {
    header: { kind: "header", xml: `<w:hdr xmlns:w="${w}">${paragraph("Top")}</w:hdr>` },
    footer: { kind: "footer", xml: `<w:ftr xmlns:w="${w}">${paragraph("Bottom")}</w:ftr>` },
    notes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="9">${paragraph("Nine")}</w:footnote><w:footnote w:id="0" w:type="separator">${paragraph("Internal")}</w:footnote><w:footnote w:id="2">${paragraph("Two")}</w:footnote></w:footnotes>` },
    ends: { kind: "endnotes", xml: `<w:endnotes xmlns:w="${w}"><w:endnote w:id="1">${paragraph("Endnote")}</w:endnote></w:endnotes>` },
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="3">${paragraph("Comment")}</w:comment></w:comments>` }
  });
  expect((await extractDocumentText(bytes, textContext)).text).toBe("Body\nSecond\n");
  expect((await extractDocumentText(bytes, textContext, { scope: "all-stories" })).text).toBe("Body\nSecond\n\n\nTop\n\nBottom\n\nTwo\n\nNine\n\nEndnote\n\nComment\n\nBox");
  for (const [scope, text] of [["headers", "Top"], ["footers", "Bottom"], ["footnotes", "Two\n\nNine"], ["endnotes", "Endnote"], ["comments", "Comment"], ["text-boxes", "Box"]] as const)
    expect((await extractDocumentText(bytes, textContext, { scope })).text).toBe(text);
  expect((await extractDocumentText(bytes, textContext, { scope: "headers", section: 2 })).text).toBe("Top");
});

it.each(["final", "original", "all"] as const)("keeps %s revisions separate from field instructions", async view => {
  const field = '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PRIVATE instruction</w:instrText><w:t>Instruction payload</w:t></w:r><w:r><w:fldChar w:fldCharType="separate"/><w:t>42</w:t><w:fldChar w:fldCharType="end"/></w:r>';
  const bytes = await textFixture(`<w:p>${run("Start ")}<w:del w:id="1"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2">${run("New")}</w:ins><w:moveFrom w:id="3">${run("Away")}</w:moveFrom><w:moveTo w:id="4">${run("Here")}</w:moveTo>${field}<w:fldSimple w:instr="PRIVATE simple">${run("Cached")}</w:fldSimple></w:p>`);
  const result = await extractDocumentText(bytes, textContext, { view });
  expect(result.text).toBe("Start " + ({ final: "NewHere", original: "OldAway", all: "OldNewAwayHere" })[view] + "42Cached");
  expect(result.segments.filter(s => s.revision === "delete").map(s => s.text)).toEqual(view === "final" ? [] : ["Old", "Away"]);
  expect(result.segments.filter(s => s.revision === "insert").map(s => s.text)).toEqual(view === "original" ? [] : ["New", "Here"]);
});

it("includes hidden logical text with explicit direct-format context and never invents drawing or equation text", async () => {
  const bytes = await textFixture(`<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>Shown</w:t><w:drawing><w:t>Not prose</w:t></w:drawing></w:r><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x=7</m:t></m:r></m:oMath></w:p>`);
  const result = await extractDocumentText(bytes, textContext);
  expect(result.text).toBe("HiddenShown");
  expect(result.segments.map(s => s.formatting.hidden)).toEqual([true, false]);
});

it("honors selected cells, runs, scalar ranges and budgets without mutating the input", async () => {
  const bytes = await textFixture(paragraph("🌊é海") + table([paragraph("West"), paragraph("East")]));
  const before = new Uint8Array(bytes);
  expect((await extractDocumentText(bytes, textContext, { table: 1, cell: "B1" })).text).toBe("East");
  expect((await extractDocumentText(bytes, textContext, { paragraph: 1, run: 1 })).text).toBe("🌊é海");
  const document = await openDocumentLocations(bytes, textContext);
  expect((await extractDocumentText(bytes, textContext, { select: document.range(document.at("paragraph", 1).token, 1, 3).token })).text).toBe("é");
  await expect(extractDocumentText(bytes, { ...textContext, budget: new DocumentBudget({ serializedOutput: 1 }) })).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(extractDocumentText(bytes, textContext, { view: "invalid" } as never)).rejects.toMatchObject({ code: "usage" });
  expect(bytes).toEqual(before);
});

it("reads legacy and modern text boxes once and applies their enclosing revision view", async () => {
  const legacy = `<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>${paragraph("Legacy")}</w:txbxContent></v:textbox></v:shape></w:pict>`;
  const modern = `<w:drawing><s:wsp xmlns:s="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><s:txbx><w:txbxContent>${paragraph("Modern")}</w:txbxContent></s:txbx></s:wsp></w:drawing>`;
  const bytes = await textFixture(`<w:p><w:del w:id="1"><w:r>${legacy}</w:r></w:del><w:ins w:id="2"><w:r>${modern}</w:r></w:ins></w:p>`);
  expect((await extractDocumentText(bytes, textContext, { scope: "text-boxes" })).text).toBe("Modern");
  expect((await extractDocumentText(bytes, textContext, { scope: "text-boxes", view: "original" })).text).toBe("Legacy");
  const all = await extractDocumentText(bytes, textContext, { scope: "text-boxes", view: "all" });
  expect(all.text).toBe("Legacy\n\nModern");
  expect(all.segments.filter(s => s.kind === "text").map(s => s.revision)).toEqual(["delete", "insert"]);
});

it("retains normal zero-ID notes and uses canonical part order before numeric note IDs", async () => {
  const bytes = await textFixture(paragraph("Body"), {
    z: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="0">${paragraph("Zero")}</w:footnote></w:footnotes>` },
    a: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="1">${paragraph("First part")}</w:footnote></w:footnotes>` }
  });
  expect((await extractDocumentText(bytes, textContext, { scope: "footnotes" })).text).toBe("First part\n\nZero");
});

it("tracks nested fields across paragraphs even when selection starts inside a field", async () => {
  const field = (kind: string) => `<w:r><w:fldChar w:fldCharType="${kind}"/></w:r>`;
  const bytes = await textFixture(`<w:p>${field("begin")}${run("Never")}${field("begin")}${field("separate")}${run("Inner instruction")}${field("end")}</w:p><w:p>${run("Still instruction")}${field("separate")}${run("Outer ")}${field("begin")}${field("separate")}${run("Inner")}${field("end")}${field("end")}${run(" Done")}</w:p>`);
  expect((await extractDocumentText(bytes, textContext, { paragraph: 2 })).text).toBe("Outer Inner Done");
});

it("keeps selection inside a single table row without empty separators from other rows", async () => {
  const bytes = await textFixture('<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc>' + paragraph("North") + '</w:tc></w:tr><w:tr><w:tc>' + paragraph("South") + '</w:tc></w:tr></w:tbl>');
  expect((await extractDocumentText(bytes, textContext, { table: 1, cell: "A2" })).text).toBe("South");
});

it.each(["final", "original", "all"] as const)("applies %s review policy to paragraph marks and table rows", async view => {
  const bytes = await textFixture(`<w:p><w:pPr><w:rPr><w:del w:id="1"/></w:rPr></w:pPr>${run("Old boundary")}</w:p>${paragraph("Next")}<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:del w:id="2"/></w:trPr><w:tc>${paragraph("Removed row")}</w:tc></w:tr><w:tr><w:trPr><w:ins w:id="3"/></w:trPr><w:tc>${paragraph("Added row")}</w:tc></w:tr></w:tbl>`);
  expect((await extractDocumentText(bytes, textContext, { view })).text).toBe({ final: "Old boundaryNext\nAdded row", original: "Old boundary\nNext\nRemoved row", all: "Old boundary\nNext\nRemoved row\nAdded row" }[view]);
});

it("retains bidi controls, empty blocks, hidden styles and active compatibility content without reshaping", async () => {
  const bytes = await textFixture(`<w:p/><w:p><w:r><w:rPr><w:rStyle w:val="Concealed"/></w:rPr><w:t>עברית \u2067日本\u2069 é</w:t></w:r></w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unknown"><mc:Choice Requires="x">${paragraph("Inactive")}</mc:Choice><mc:Fallback>${paragraph("Visible")}</mc:Fallback></mc:AlternateContent><w:p/>`, {
    styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="character" w:styleId="Concealed"><w:name w:val="Concealed"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>` }
  });
  const result = await extractDocumentText(bytes, textContext);
  expect(result.text).toBe("\nעברית \u2067日本\u2069 é\nVisible\n");
  expect(result.segments.find(s => s.kind === "text")?.formatting).toMatchObject({ style: "Concealed", hidden: null });
  const document = await openDocumentLocations(bytes, textContext);
  expect(document.text()).toEqual(result);
  expect(() => document.text({ limit: [{ name: "serializedOutput", value: 1 }] })).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  const controller = new AbortController();
  controller.abort();
  await expect(extractDocumentText(bytes, { ...textContext, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
});
