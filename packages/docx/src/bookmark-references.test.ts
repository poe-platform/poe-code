import { expect, it } from "vitest";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { DocumentBudget } from "./budget.js";
import { updateBookmarkReferences } from "./bookmark-references.js";

const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function editor(content: string): DocumentXmlEditor {
  return new DocumentXmlEditor(new TextEncoder().encode(`<w:document xmlns:w="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content}</w:body></w:document>`));
}
const output = (xml: DocumentXmlEditor) => new TextDecoder().decode(xml.serialize());
function update(xml: DocumentXmlEditor, name: string | null = "Arrival", policy: "update" | "remove" | "reject" = "update"): void {
  updateBookmarkReferences(new Map([["word/document.xml", xml]]), "Harbor", name, policy, new DocumentBudget());
}

it("renames internal links and simple field operands preserving switches and external links", () => {
  const xml = editor('<w:p><w:hyperlink w:anchor="Harbor"><w:r><w:t>Route</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId4" w:anchor="Harbor"><w:r><w:t>External</w:t></w:r></w:hyperlink><w:fldSimple w:instr="  REF  &quot;Harbor&quot; \\h  "><w:r><w:t>Port</w:t></w:r></w:fldSimple><w:fldSimple w:instr="DATE \\@ yyyy"><w:r><w:t>2030</w:t></w:r></w:fldSimple></w:p>');
  const before = output(xml);
  update(xml);
  expect(output(xml)).toBe(before.replace('w:anchor="Harbor"', 'w:anchor="Arrival"').replace('&quot;Harbor&quot;', '&quot;Arrival&quot;'));
});

it("renames a split complex PAGEREF operand inside a table retaining annotations", () => {
  const xml = editor('<w:tbl><w:tr><w:tc><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE</w:instrText></w:r><w:r><w:instrText>REF Har</w:instrText></w:r><w:commentRangeStart w:id="7"/><w:r><w:instrText xml:space="preserve">bor \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>14</w:t></w:r><w:commentRangeEnd w:id="7"/><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:tc></w:tr></w:tbl>');
  const before = output(xml);
  update(xml);
  expect(output(xml)).toBe(before.replace('REF Har', 'REF Arrival').replace('bor \\h ', ' \\h '));
});

it("removes nested simple references without dropping text or comment annotations", () => {
  const xml = editor('<w:p><w:hyperlink w:anchor="Harbor"><w:commentRangeStart w:id="8"/><w:fldSimple w:instr="REF Harbor"><w:r><w:t>Harbor</w:t></w:r></w:fldSimple><w:commentRangeEnd w:id="8"/></w:hyperlink></w:p>');
  update(xml, null, "remove");
  expect(output(xml)).toContain('<w:p><w:commentRangeStart w:id="8"/><w:r><w:t>Harbor</w:t></w:r><w:commentRangeEnd w:id="8"/></w:p>');
});

it.each([
  '<w:fldSimple w:instr="REF Harbor"><w:r><w:t>Port</w:t></w:r></w:fldSimple>',
  '<w:fldSimple w:instr="HYPERLINK \\l &quot;Harbor&quot;"><w:r><w:t>Port</w:t></w:r></w:fldSimple>',
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Harbor</w:instrText></w:r>'
])("rejects dependencies or unsafe fields before changing earlier links", field => {
  const xml = editor(`<w:p><w:hyperlink w:anchor="Harbor"><w:r><w:t>Route</w:t></w:r></w:hyperlink>${field}</w:p>`);
  const before = output(xml);
  expect(() => update(xml, null, "reject")).toThrow(UnsupportedEditError);
  expect(output(xml)).toBe(before);
});

it("explicitly rejects complex-field removal", () => {
  const xml = editor('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Harbor</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Port</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>');
  expect(() => update(xml, null, "remove")).toThrow(UnsupportedEditError);
});

it("rejects removal that would discard a wrapper namespace binding", () => {
  const xml = editor('<w:p><w:hyperlink xmlns:q="urn:retained" w:anchor="Harbor"><w:r><w:t>Port</w:t></w:r></w:hyperlink></w:p>');
  const before = output(xml);
  expect(() => update(xml, null, "remove")).toThrow(UnsupportedEditError);
  expect(output(xml)).toBe(before);
});

it("rejects opaque deleted instruction dependencies while retaining revision annotations", () => {
  const xml = editor('<w:p><w:del w:id="8" w:author="Mira"><w:r><w:delInstrText>REF Harbor</w:delInstrText></w:r></w:del></w:p>');
  expect(() => update(xml)).toThrow(UnsupportedEditError);
});

it("preserves unrelated complex fields and supports strict namespace aliases", () => {
  const source = '<d:document xmlns:d="http://purl.oclc.org/ooxml/wordprocessingml/main"><d:body><d:p><d:hyperlink d:anchor="Harbor"><d:r><d:t>Port</d:t></d:r></d:hyperlink><d:r><d:fldChar d:fldCharType="begin"/><d:instrText> DATE \\@ yyyy </d:instrText><d:fldChar d:fldCharType="separate"/><d:t>2030</d:t><d:fldChar d:fldCharType="end"/></d:r></d:p></d:body></d:document>';
  const xml = new DocumentXmlEditor(new TextEncoder().encode(source));
  update(xml);
  expect(output(xml)).toBe(source.replace('d:anchor="Harbor"', 'd:anchor="Arrival"'));
});

it("checks every story before staging reference changes", () => {
  const main = editor('<w:p><w:hyperlink w:anchor="Harbor"><w:r><w:t>Port</w:t></w:r></w:hyperlink></w:p>');
  const header = editor('<w:p><w:fldSimple w:instr="CUSTOM Harbor"><w:r><w:t>Port</w:t></w:r></w:fldSimple></w:p>');
  const before = output(main);
  expect(() => updateBookmarkReferences(new Map([["word/document.xml", main], ["word/header1.xml", header]]), "Harbor", "Arrival", "update", new DocumentBudget())).toThrow(UnsupportedEditError);
  expect(output(main)).toBe(before);
});

it("rejects a deleted instruction dependency split across revision runs", () => {
  const xml = editor('<w:p><w:del w:id="9" w:author="Mira"><w:r><w:delInstrText>REF Har</w:delInstrText></w:r><w:r><w:delInstrText>bor</w:delInstrText></w:r></w:del></w:p>');
  expect(() => update(xml)).toThrow(UnsupportedEditError);
});

it("rejects opaque bookmark dependencies beneath a neutral XML root", () => {
  const xml = new DocumentXmlEditor(new TextEncoder().encode('<store xmlns:x="urn:opaque"><x:reference target="Harbor"/></store>'));
  expect(() => update(xml)).toThrow(UnsupportedEditError);
});

it("finds supported word references beneath a neutral XML root", () => {
  const source = `<store xmlns:w="${ns}"><w:hyperlink w:anchor="Harbor"><w:r><w:t>Port</w:t></w:r></w:hyperlink></store>`;
  const xml = new DocumentXmlEditor(new TextEncoder().encode(source));
  update(xml);
  expect(output(xml)).toBe(source.replace('w:anchor="Harbor"', 'w:anchor="Arrival"'));
});

it("rejects opaque foreign text dependencies without treating visible text as references", () => {
  const ordinary = editor('<w:p><w:r><w:t>Harbor</w:t></w:r></w:p>');
  const before = output(ordinary);
  update(ordinary);
  expect(output(ordinary)).toBe(before);
  const opaque = new DocumentXmlEditor(new TextEncoder().encode('<store xmlns:x="urn:opaque"><x:reference>jump Harbor now</x:reference></store>'));
  expect(() => update(opaque)).toThrow(UnsupportedEditError);
});

it.each(['xml:space="preserve"', 'xml:lang="pl"'])("rejects reference removal that would lose inherited %s", attribute => {
  const xml = editor(`<w:p><w:hyperlink w:anchor="Harbor" ${attribute}><w:r><w:t>Port</w:t></w:r></w:hyperlink></w:p>`);
  expect(() => update(xml, null, "remove")).toThrow(UnsupportedEditError);
});

it.each(["footnote", "endnote", "comment", "txbxContent"])("rejects complex field boundaries crossing %s stories", story => {
  const xml = editor(`<w:${story} w:id="3"><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Harbor</w:instrText></w:r></w:p></w:${story}><w:${story} w:id="4"><w:p><w:r><w:fldChar w:fldCharType="separate"/><w:t>Port</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p></w:${story}>`);
  expect(() => update(xml)).toThrow(UnsupportedEditError);
});

it("keeps independent textbox field stacks separate from the enclosing story", () => {
  const field = '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>REF Harbor</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Port</w:t><w:fldChar w:fldCharType="end"/></w:r>';
  const xml = editor(`<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:txbxContent><w:p>${field}</w:p></w:txbxContent><w:r><w:t>2030</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>`);
  const before = output(xml);
  update(xml);
  expect(output(xml)).toBe(before.replace('REF Harbor', 'REF Arrival'));
});

it("rejects internal document-location dependencies but preserves external hyperlink locations", () => {
  const internal = editor('<w:p><w:hyperlink w:docLocation="Harbor"><w:r><w:t>Port</w:t></w:r></w:hyperlink></w:p>');
  expect(() => update(internal)).toThrow(UnsupportedEditError);
  const external = editor('<w:p><w:hyperlink r:id="rId8" w:anchor="Harbor" w:docLocation="Harbor"><w:r><w:t>Port</w:t></w:r></w:hyperlink></w:p>');
  const before = output(external);
  update(external);
  expect(output(external)).toBe(before);
});

it("rejects opaque fragment attributes containing the bookmark name", () => {
  const xml = new DocumentXmlEditor(new TextEncoder().encode('<store xmlns:x="urn:opaque"><x:reference target="#Harbor"/></store>'));
  expect(() => update(xml)).toThrow(UnsupportedEditError);
});

it.each(["PAGE", "NUMPAGES"])("preserves operand-free %s fields when the bookmark shares their name", name => {
  const xml = editor(`<w:p><w:fldSimple w:instr=" ${name} \\* MERGEFORMAT "><w:r><w:t>14</w:t></w:r></w:fldSimple></w:p>`);
  const before = output(xml);
  updateBookmarkReferences(new Map([["word/document.xml", xml]]), name, "Arrival", "update", new DocumentBudget());
  expect(output(xml)).toBe(before);
});
