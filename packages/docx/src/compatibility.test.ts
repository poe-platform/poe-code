import { expect, it } from "vitest";
import { Volume } from "memfs";
import { technicalBitmap } from "../tests/fixtures/documents.js";
import { parseDocumentXml } from "./package-xml.js";
import { MarkupCompatibility, documentCompatibilityProfile } from "./compatibility.js";
import { DocumentXmlEditor, DocumentArchiveEditor, InvalidXmlError, UnsupportedEditError, UnsupportedProfileError } from "./index.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const svg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
const bytes = (xml: string) => new TextEncoder().encode(xml);
const wrap = (body: string, attributes = "") => `<w:document xmlns:w="${w}" xmlns:mc="${mc}" xmlns:x="urn:future" xmlns:s="${svg}" ${attributes}>${body}</w:document>`;
const alternate = '<mc:AlternateContent><mc:Choice Requires="s"><s:svgBlip src="vector.svg"/></mc:Choice><mc:Choice Requires="w"><w:drawing src="raster.png"/></mc:Choice><mc:Fallback><w:drawing src="preview.png"/></mc:Fallback></mc:AlternateContent>';

it("selects the first fully understood choice and retains every original representation", () => {
  const source = wrap(alternate);
  const editor = new DocumentXmlEditor(bytes(source));
  const view = editor.compatibility;
  expect(view.branches[0]!.selected).toBe(editor.root.children[0]!.children[1]);
  expect(view.content[0]).toMatchObject({ source: editor.root, content: [{ source: { localName: "drawing" }, attributes: [expect.objectContaining({ value: "raster.png" })] }] });
  expect(editor.serialize()).toEqual(bytes(source));
});

it("resolves Requires at the choice and uses fallback or an explicit empty selection", () => {
  const body = '<mc:AlternateContent><mc:Choice xmlns:w="urn:future" Requires="w"><x:item/></mc:Choice><mc:Fallback><w:p>preview</w:p></mc:Fallback></mc:AlternateContent>';
  const editor = new DocumentXmlEditor(bytes(wrap(body)));
  expect(editor.compatibility.branches[0]!.selected?.localName).toBe("Fallback");
  const empty = new DocumentXmlEditor(bytes(wrap('<mc:AlternateContent><mc:Choice Requires="x"><x:item/></mc:Choice></mc:AlternateContent>')));
  expect(empty.compatibility.branches[0]!.selected).toBeUndefined();
  expect(empty.compatibility.content[0]).toMatchObject({ content: [] });
});

it("supports a caller-declared understood namespace profile without mutating it", () => {
  const profile = { understoodNamespaces: [w, svg], extensionElements: [] };
  const editor = new DocumentXmlEditor(bytes(wrap(alternate)), {}, profile);
  profile.understoodNamespaces.length = 0;
  expect(editor.compatibility.branches[0]!.selected?.attributes.find(a => a.name === "Requires")?.value).toBe("s");
});

it("inherits expanded ignorable and process-content names across prefix rebinding", () => {
  const source = wrap('<x:skip mc:MustUnderstand="x"><w:p>hidden</w:p></x:skip><x:pass>lead<w:p x:flag="keep">visible</w:p>tail</x:pass><w:p xmlns:x="urn:other"><x:pass/></w:p>', 'mc:Ignorable="x" mc:ProcessContent="x:pass" mc:PreserveElements="x:*" mc:PreserveAttributes="x:flag"');
  const editor = new DocumentXmlEditor(bytes(source));
  const root = editor.compatibility.content[0]!;
  expect(root).toMatchObject({ content: [{ text: "lead" }, { source: { localName: "p" }, attributes: [] }, { text: "tail" }, { content: [{ disposition: "opaque" }] }] });
  expect(editor.serialize()).toEqual(bytes(source));
});

it.each([
  '<w:p mc:MustUnderstand="x"/>',
  '<x:pass mc:MustUnderstand="x"/>',
  '<mc:AlternateContent mc:MustUnderstand="x"><mc:Choice Requires="x"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="w" mc:MustUnderstand="x"/></mc:AlternateContent>'
])("reports required unsupported namespaces only on examined content: %s", body => {
  const editor = new DocumentXmlEditor(bytes(wrap(body, 'mc:Ignorable="x" mc:ProcessContent="x:pass"')));
  expect(() => editor.compatibility).toThrow(UnsupportedProfileError);
  expect(() => editor.compatibility).toThrow(expect.objectContaining({ code: "unsupported-profile" }));
});

it("does not examine unsupported requirements in ignored or unselected content", () => {
  const editor = new DocumentXmlEditor(bytes(wrap('<x:skip mc:MustUnderstand="x"/><mc:AlternateContent><mc:Choice Requires="x" mc:MustUnderstand="x"><w:p mc:MustUnderstand="x"/></mc:Choice><mc:Fallback><w:p>safe</w:p></mc:Fallback></mc:AlternateContent>', 'mc:Ignorable="x"')));
  expect(editor.compatibility.branches[0]!.selected?.localName).toBe("Fallback");
});

it.each([
  '<w:p mc:Ignorable="missing"/>', '<w:p mc:Ignorable="mc"/>',
  '<w:p mc:ProcessContent="x:p"/>', '<w:p mc:PreserveElements="x:*"/>',
  '<w:p mc:PreserveAttributes="missing:a"/>', '<w:p mc:MustUnderstand="x:bad"/>',
  '<mc:AlternateContent/>', '<mc:Choice Requires="w"/>',
  '<mc:AlternateContent><mc:Fallback/><mc:Choice Requires="w"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires=""/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="missing"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback/><mc:Fallback/></mc:AlternateContent>',
  '<mc:AlternateContent extra="bad"><mc:Choice Requires="w"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="w"/><w:p/></mc:AlternateContent>',
  '<mc:AlternateContent>bad<mc:Choice Requires="w"/></mc:AlternateContent>',
  '<w:p mc:Unknown="x"/>'
])("rejects malformed compatibility markup: %s", body => {
  expect(() => new DocumentXmlEditor(bytes(wrap(body))).compatibility).toThrow(InvalidXmlError);
});

it("allows ignored interspersed alternate children and nested selected content", () => {
  const editor = new DocumentXmlEditor(bytes(wrap('<mc:AlternateContent><x:extra/><mc:Choice Requires="w">'+alternate+'</mc:Choice><x:extra/><mc:Fallback/></mc:AlternateContent>', 'mc:Ignorable="x"')));
  expect(editor.compatibility.branches).toHaveLength(2);
});

it("refuses selected and unselected branch edits but permits an unrelated edit with exact preservation", () => {
  const source = wrap('<w:p>before</w:p>'+alternate);
  const editor = new DocumentXmlEditor(bytes(source));
  editor.setText(editor.root.children[0]!.content[0]!, "after");
  for (const branch of editor.root.children[1]!.children)
    expect(() => editor.setAttribute(branch.children[0]!, "src", "replacement")).toThrow(UnsupportedEditError);
  expect(() => editor.setAttribute(editor.root.children[1]!.children[0]!, "Requires", "w")).toThrow(UnsupportedEditError);
  const fs = Volume.fromJSON({ "/result.xml": "" });
  fs.writeFileSync("/result.xml", editor.serialize());
  expect(new Uint8Array(fs.readFileSync("/result.xml") as Uint8Array)).toEqual(bytes(source.replace("before", "after")));
});

it("refuses changes to preservation directives, ignored content and required unsupported documents", () => {
  const editor = new DocumentXmlEditor(bytes(wrap('<x:pass><w:p>guarded</w:p></x:pass><x:hidden a="old"/>', 'mc:Ignorable="x" mc:ProcessContent="x:*"')));
  expect(() => editor.setAttribute(editor.root, "mc:Ignorable", "")).toThrow(UnsupportedEditError);
  expect(() => editor.setText(editor.root.children[0]!.children[0]!.content[0]!, "changed")).toThrow(UnsupportedEditError);
  expect(() => editor.setAttribute(editor.root.children[1]!, "a", "new")).toThrow(UnsupportedEditError);
  const required = new DocumentXmlEditor(bytes(wrap('<w:p>old</w:p>', 'mc:MustUnderstand="x"')));
  expect(() => required.setText(required.root.children[0]!.content[0]!, "new")).toThrow(UnsupportedProfileError);
  expect(required.dirtyNodes).toEqual([]);
});

it("suspends processing in declared application extension content and protects SVG raster pairs", () => {
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const source = wrap(`<w:p>before</w:p><a:blip xmlns:a="${a}" src="raster.png"><a:extLst><a:ext uri="urn:svg"><s:svgBlip mc:MustUnderstand="x" src="vector.svg"/></a:ext></a:extLst></a:blip>`);
  const editor = new DocumentXmlEditor(bytes(source));
  expect(() => editor.compatibility).not.toThrow();
  expect(() => editor.setAttribute(editor.root.children[1]!, "src", "new.png")).toThrow(UnsupportedEditError);
  editor.setText(editor.root.children[0]!.content[0]!, "after");
  expect(editor.serialize()).toEqual(bytes(source.replace("before", "after")));
});

it.each([null, {}, { understoodNamespaces: [1] }, { understoodNamespaces: [mc] }, { understoodNamespaces: [w], unexpected: true }])("rejects invalid profile configuration", profile => {
  expect(() => new DocumentXmlEditor(bytes(wrap("")), {}, profile as never)).toThrow(RangeError);
});

it.each([
  '<x:pass xml:space="preserve"><w:p/></x:pass>',
  '<x:pass xml:lang="en"><w:p/></x:pass>',
  '<x:pass xml:base="local"><w:p/></x:pass>',
  '<mc:AlternateContent xml:space="preserve"><mc:Choice Requires="w"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="w" extra="invalid"/></mc:AlternateContent>',
  '<mc:AlternateContent><mc:Choice Requires="w"/><mc:Fallback Requires="w"/></mc:AlternateContent>'
])("rejects forbidden wrapper attributes: %s", body => {
  expect(() => new DocumentXmlEditor(bytes(wrap(body, 'mc:Ignorable="x" mc:ProcessContent="x:*"'))).compatibility).toThrow(InvalidXmlError);
});

it("supports wildcard processing, empty directive lists and known ignorable namespaces", () => {
  const source = wrap('<x:one><w:p>one</w:p></x:one><x:two><w:p>two</w:p></x:two><w:p mc:MustUnderstand="" mc:PreserveAttributes=""/>', 'mc:Ignorable="x w" mc:ProcessContent="x:*"');
  expect(new DocumentXmlEditor(bytes(source)).compatibility.content[0]).toMatchObject({ disposition: "understood", content: [{ source: { localName: "p" } }, { source: { localName: "p" } }, { source: { localName: "p" } }] });
});

it("requires every namespace in a choice and supports AlternateContent as the root", () => {
  const source = `<mc:AlternateContent xmlns:mc="${mc}" xmlns:w="${w}" xmlns:x="urn:future"><mc:Choice Requires="w x"><w:p>both</w:p></mc:Choice><mc:Fallback><w:p>fallback</w:p></mc:Fallback></mc:AlternateContent>`;
  const editor = new DocumentXmlEditor(bytes(source));
  expect(editor.compatibility.content).toMatchObject([{ source: { localName: "p" }, content: [{ text: "fallback" }] }]);
});

it("retains unknown nonignorable attributes and namespaces as opaque, without claiming edit support", () => {
  const editor = new DocumentXmlEditor(bytes(wrap('<x:item/><w:p x:flag="keep">safe</w:p>', 'mc:Ignorable=""')));
  expect(editor.compatibility.content[0]).toMatchObject({ content: [{ disposition: "opaque" }, { attributes: [expect.objectContaining({ namespace: "urn:future" })] }] });
  expect(() => editor.setAttribute(editor.root.children[1]!, "x:flag", "changed")).toThrow(UnsupportedEditError);
  editor.setText(editor.root.children[1]!.content[0]!, "revised");
});

it("rejects opaque extension edits even when no MCE attributes exist", () => {
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const source = wrap(`<a:ext xmlns:a="${a}" uri="urn:extension"><w:p>opaque</w:p></a:ext>`);
  const editor = new DocumentXmlEditor(bytes(source));
  expect(() => editor.setText(editor.root.children[0]!.children[0]!.content[0]!, "changed")).toThrow(UnsupportedEditError);
});


it("uses the same owned profile for archive-part reads and mutation guards", () => {
  const source = wrap(alternate);
  const editor = new DocumentArchiveEditor({ members: [{ name: "word/document.xml", bytes: bytes(source), directory: false, modified: new Date(0) }], comment: new Uint8Array() }, {}, { understoodNamespaces: [w, svg] });
  expect(editor.xml("word/document.xml").compatibility.branches[0]!.selected?.attributes[0]!.value).toBe("s");
  expect(editor.snapshot().members[0]!.bytes).toEqual(bytes(source));
  expect(editor.dirtyParts).toEqual([]);
});

it("retains original SVG and raster payloads and relationships through an unrelated package edit", () => {
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const source = wrap(`<w:p>before</w:p><mc:AlternateContent xmlns:a="${a}" xmlns:r="${r}"><mc:Choice Requires="s"><s:svgBlip r:embed="vector"/></mc:Choice><mc:Fallback><a:blip r:embed="raster"/></mc:Fallback></mc:AlternateContent>`);
  const payloads = [
    { name: "word/document.xml", bytes: bytes(source) },
    { name: "word/_rels/document.xml.rels", bytes: bytes(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="vector" Type="${r}/image" Target="media/vector.svg"/><Relationship Id="raster" Type="${r}/image" Target="media/raster.bmp"/></Relationships>`) },
    { name: "word/media/vector.svg", bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"/>') },
    { name: "word/media/raster.bmp", bytes: technicalBitmap() }
  ];
  const archive = new DocumentArchiveEditor({ members: payloads.map(member => ({ ...member, directory: false, modified: new Date(0) })), comment: new Uint8Array() });
  const editor = archive.xml("word/document.xml");
  expect(editor.compatibility.branches[0]!.selected?.localName).toBe("Fallback");
  const fallback = editor.root.children[1]!.children[1]!.children[0]!;
  expect(() => editor.setAttribute(fallback, "r:embed", "newRaster")).toThrow(UnsupportedEditError);
  editor.setText(editor.root.children[0]!.content[0]!, "after");
  const fs = Volume.fromJSON({});
  for (const member of archive.snapshot().members) {
    const path = "/" + member.name;
    fs.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(path, member.bytes);
    expect(new Uint8Array(fs.readFileSync(path) as Uint8Array)).toEqual(member.name === "word/document.xml" ? bytes(source.replace("before", "after")) : payloads.find(p => p.name === member.name)!.bytes);
  }
});

it("honors locally declared choice scopes and Unicode namespace prefixes", () => {
  const editor = new DocumentXmlEditor(bytes(wrap('<mc:AlternateContent><mc:Choice xmlns:名="urn:extra" mc:Ignorable="名" mc:ProcessContent="名:*" Requires="w"><名:wrap><w:p>selected</w:p></名:wrap></mc:Choice></mc:AlternateContent>')));
  expect(editor.compatibility.content[0]).toMatchObject({ content: [{ source: { localName: "p" }, content: [{ text: "selected" }] }] });
});

it("copies extension configuration and suspends compatibility checks at the declared boundary", () => {
  const extensionElements = [{ namespace: w, localName: "opaque" }];
  const editor = new DocumentXmlEditor(bytes(wrap('<w:opaque mc:Unknown="keep"><mc:Choice/><x:item mc:MustUnderstand="missing"/></w:opaque>')), {}, { understoodNamespaces: [w], extensionElements });
  extensionElements[0]!.localName = "changed";
  expect(editor.compatibility.content[0]).toMatchObject({ content: [{ disposition: "extension", content: [{ source: { localName: "Choice" } }, { source: { localName: "item" } }] }] });
});

it.each(['mc:Ignorable="w"', 'mc:Ignorable="x" mc:ProcessContent="x:*"'])("reports a profile mismatch when an ignorable alternate child survives processing: %s", attributes => {
  const child = attributes.includes('"w"') ? '<w:extra/>' : '<x:extra/>';
  const source = wrap('<mc:AlternateContent>'+child+'<mc:Choice Requires="w"/></mc:AlternateContent>', attributes);
  expect(() => new DocumentXmlEditor(bytes(source)).compatibility).toThrow(UnsupportedProfileError);
});

it("rejects an alternate extension child that cannot be ignored and preserves the source", () => {
  const source = wrap('<w:p>before</w:p><mc:AlternateContent><x:extra/><mc:Choice Requires="w"><w:p>choice</w:p></mc:Choice></mc:AlternateContent>', 'mc:Ignorable="x"');
  const fs = Volume.fromJSON({ "/document.xml": source });
  const editor = new DocumentXmlEditor(new Uint8Array(fs.readFileSync("/document.xml") as Uint8Array), {}, {
    understoodNamespaces: [w], extensionElements: [{ namespace: "urn:future", localName: "extra" }]
  });
  expect(() => editor.compatibility).toThrow(UnsupportedProfileError);
  expect(() => editor.setText(editor.root.children[0]!.content[0]!, "after")).toThrow(expect.objectContaining({ code: "unsupported-profile" }));
  fs.writeFileSync("/result.xml", editor.serialize());
  expect(fs.readFileSync("/result.xml")).toEqual(fs.readFileSync("/document.xml"));
  expect(editor.dirtyNodes).toEqual([]);
});
it("admits only exact native repeat names and owned attributes without activating namespace choices", () => {
  const root = parseDocumentXml(new TextEncoder().encode('<w:sdtPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="v"><v:repeatingSection unknown="x"><v:sectionTitle v:val="Rows" v:unknown="x"/><v:future/></v:repeatingSection><v:repeatingSectionItem/><mc:AlternateContent><mc:Choice Requires="v"><w:text/></mc:Choice><mc:Fallback><w:richText/></mc:Fallback></mc:AlternateContent></w:sdtPr>')).root;
  const compatibility = new MarkupCompatibility(root); expect(compatibility.canEdit(root.children[0]!)).toBe(true); expect(compatibility.canEdit(root.children[0]!.attributes[0]!)).toBe(false);
  expect(compatibility.canEdit(root.children[0]!.children[0]!.attributes[0]!)).toBe(true); expect(compatibility.canEdit(root.children[0]!.children[0]!.attributes[1]!)).toBe(false); expect(compatibility.canEdit(root.children[0]!.children[1]!)).toBe(false);
  expect(compatibility.branches[0]!.selected!.localName).toBe("Fallback"); expect(documentCompatibilityProfile.understoodNamespaces).not.toContain("http://schemas.microsoft.com/office/word/2012/wordml");
});

it("admits exact positive transform dimension ext while keeping drawing extensions opaque", () => {
  const root = parseDocumentXml(new TextEncoder().encode('<a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext cx="12" cy="34"/></a:xfrm>')).root;
  expect(new MarkupCompatibility(root).canEdit(root.children[0]!)).toBe(true);
});
