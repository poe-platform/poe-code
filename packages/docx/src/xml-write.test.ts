import { expect, it, vi } from "vitest";
import { DocumentBudget } from "./budget.js";
import { Volume } from "memfs";
import {
  DocumentXmlEditor, DocumentArchiveEditor, parseDocumentXml, readArchive, readDocumentArchive, writeArchive,
  UnsupportedEditError, InvalidXmlError, ResourceLimitError, type ArchiveLimits
} from "./index.js";

import { createDocumentFixture } from "../tests/fixtures/documents.js";

const utf8 = (text: string) => new TextEncoder().encode(text);
it("admits scalar-copy budgets before iterating replacement text", () => {
  const budget = new DocumentBudget({ retainedBytes: 100000 }); const editor = new DocumentXmlEditor(utf8("<root>Old</root>"), {}, undefined, budget);
  budget.charge("retainedBytes", budget.limits.retainedBytes - budget.usage.retainedBytes - 1);
  const value = "Caller scalar awaiting admission", original = String.prototype[Symbol.iterator]; let entered = false;
  const spy = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function(this: string) { if (String(this) === value) entered = true; return original.call(this); });
  try { expect(() => editor.replaceScalarText(editor.root, value)).toThrow(ResourceLimitError); expect(entered).toBe(false); expect(editor.dirtyNodes).toEqual([]); } finally { spy.mockRestore(); }
});
it.each(["UTF-8", "UTF-16LE", "UTF-16BE"])("replaces a scalar root text leaf faithfully in %s", encoding => {
  const input = '<?xml version="1.0"?>\n<!--cover--><v:root xmlns:v="urn:harbor:records" marker = \'keep&#33;\'><![CDATA[Old]]></v:root><?tail keep?>';
  const editor = new DocumentXmlEditor(encode(input, encoding));
  editor.replaceScalarText(editor.root, "]]>\r<&");
  const expected = input.replace("<![CDATA[Old]]>", "]]&gt;&#13;&lt;&amp;");
  expect(editor.serialize()).toEqual(encode(expected, encoding));
});
it("refuses mixed or foreign scalar owners without staging", () => {
  for (const xml of ["<root><child/></root>", "<root>Text<!--keep--></root>"]) {
    const editor = new DocumentXmlEditor(utf8(xml)); expect(() => editor.replaceScalarText(editor.root, "New")).toThrow(UnsupportedEditError); expect(editor.dirtyNodes).toEqual([]);
  }
  const editor = new DocumentXmlEditor(utf8("<root/>")), foreign = new DocumentXmlEditor(utf8("<other/>"));
  expect(() => editor.replaceScalarText(foreign.root, "New")).toThrow(UnsupportedEditError);
});
it("fills self-closing scalar root and nested leaf shells", () => {
  for (const xml of ["<root marker = 'keep'/>", "<outer><root marker = 'keep'/></outer>"]) {
    const editor = new DocumentXmlEditor(utf8(xml)), leaf = editor.root.children[0] ?? editor.root;
    editor.replaceScalarText(leaf, "<&");
    expect(new TextDecoder().decode(editor.serialize())).toBe(xml.replace("<root marker = 'keep'/>", "<root marker = 'keep'>&lt;&amp;</root>"));
  }
});
const source = '<?xml version="1.0"?>\r\n<!--cover--><?review open?><d:page xmlns:d="urn:page" xmlns:x="urn:opaque" x:flag = \'keep&#33;\'><d:p xml:space="preserve"> A &amp; <x:wrap x:hint="a > b"><x:unknown/>opaque</x:wrap> B <![CDATA[<raw>&]]><?mark keep?><!--note--> C </d:p></d:page>\r\n<?review closed?>';

function encode(text: string, encoding: string): Uint8Array {
  if (encoding === "UTF-8") return utf8(text);
  if (encoding === "UTF-8-BOM") return new Uint8Array([239, 187, 191, ...utf8(text)]);
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  const little = encoding === "UTF-16LE";
  view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
  return bytes;
}

it.each(["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"])("retains exact no-op and unselected bytes in %s", encoding => {
  const bytes = encode(source, encoding);
  const editor = new DocumentXmlEditor(bytes);
  bytes.fill(0);
  expect(editor.dirtyNodes).toEqual([]);
  expect(editor.serialize()).toEqual(encode(source, encoding));
  const text = editor.root.children[0]!.content[0]!;
  editor.setText(text, " A & ");
  expect(editor.dirtyNodes).toEqual([]);
  editor.setText(text, "雪 😀 é <&>\r");
  expect(editor.dirtyNodes).toEqual([text]);
  const expected = source.replace(" A &amp; ", "雪 😀 é &lt;&amp;&gt;&#13;");
  expect(editor.serialize()).toEqual(encode(expected, encoding));
  expect(parseDocumentXml(editor.serialize()).root.children[0]!.content[0]).toMatchObject({ text: "雪 😀 é <&>\r" });
  editor.setText(text, " A & ");
  expect(editor.dirtyNodes).toEqual([]);
  expect(editor.serialize()).toEqual(encode(source, encoding));
});

it("edits separate mixed-content slots and attributes without rewriting opaque wrappers", () => {
  const editor = new DocumentXmlEditor(utf8(source));
  const paragraph = editor.root.children[0]!;
  editor.setText(paragraph.content[2]!, " tail ");
  editor.setAttribute(editor.root, "x:flag", "\"'&\t\n\r");
  const expected = source.replace(" B ", " tail ").replace("keep&#33;", "&quot;&apos;&amp;&#9;&#10;&#13;");
  expect(editor.serialize()).toEqual(utf8(expected));
  expect(editor.dirtyNodes).toEqual([paragraph.content[2], editor.root]);
  editor.setAttribute(editor.root, "x:flag", "keep!");
  expect(editor.dirtyNodes).toEqual([paragraph.content[2]]);
});

it("retains empty CDATA, comments, instructions and text across adjacent boundaries", () => {
  const editor = new DocumentXmlEditor(utf8('<r><![CDATA[]]><![CDATA[a]]><!--b--><?c d?> tail</r>'));
  editor.setText(editor.root.content[0]!, "new");
  expect(editor.serialize()).toEqual(utf8('<r><![CDATA[new]]><![CDATA[a]]><!--b--><?c d?> tail</r>'));
});

it("rejects edits that cannot preserve their selected node kind or boundary", () => {
  const editor = new DocumentXmlEditor(utf8(source));
  const paragraph = editor.root.children[0]!;
  for (const [node, value] of [
    [paragraph, "flatten"], [paragraph.content[3]!, "]]>"] ,
    [paragraph.content[4]!, "?>"], [paragraph.content[5]!, "--"],
    [paragraph.content[5]!, "trailing-"], [paragraph.content[3]!, "\r"]
  ] as const) expect(() => editor.setText(node, value)).toThrow(UnsupportedEditError);
  expect(() => editor.setAttribute(editor.root, "xmlns:d", "urn:changed")).toThrow(UnsupportedEditError);
  expect(() => editor.setAttribute(editor.root, "missing", "new")).toThrow(UnsupportedEditError);
  expect(editor.dirtyNodes).toEqual([]);
  expect(editor.serialize()).toEqual(utf8(source));
});

it("rejects foreign nodes, invalid XML values and coercion without changing staged edits", () => {
  const editor = new DocumentXmlEditor(utf8('<r a="yes">old</r>'));
  const node = editor.root.content[0]!;
  editor.setText(node, "valid");
  expect(() => editor.setText(parseDocumentXml(utf8('<r>foreign</r>')).root.content[0]!, "new")).toThrow(UnsupportedEditError);
  for (const text of ["\0", "\ud800", "\uffff"]) expect(() => editor.setText(node, text)).toThrow(InvalidXmlError);
  for (const value of [null, undefined, 36, {}, false]) expect(() => editor.setAttribute(editor.root, "a", value as never)).toThrow(TypeError);
  expect(editor.serialize()).toEqual(utf8('<r a="yes">valid</r>'));
});

it("prevents direct tree or byte mutation from discarding content", () => {
  const editor = new DocumentXmlEditor(utf8(source));
  expect(() => editor.root.children.pop()).toThrow(TypeError);
  expect(() => { editor.root.text = "lost"; }).toThrow(TypeError);
  (editor.root.namespaces as Map<string, string>).set("d", "urn:changed");
  expect(() => editor.serialize()).toThrow(UnsupportedEditError);
});

it("enforces input and staged output budgets before accepting changes", () => {
  const editor = new DocumentXmlEditor(utf8('<r>old</r>'), { maxBytes: 20 });
  expect(() => editor.setText(editor.root.content[0]!, "x".repeat(21))).toThrow(ResourceLimitError);
  expect(editor.dirtyNodes).toEqual([]);
  expect(editor.serialize()).toEqual(utf8('<r>old</r>'));
});

const limits: ArchiveLimits = {
  maxArchiveBytes: 131072, maxEntryBytes: 16384, maxTotalBytes: 65536,
  maxMembers: 20, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 1024,
  maxCommentBytes: 0, maxRetainedBytes: 8 * 1024 * 1024, chunkSize: 512
};
const context = { limits, signal: new AbortController().signal };

it.each(["store", "deflate"] as const)("compares every uncompressed part independently of %s ZIP metadata", async compression => {
  const members = [
    { name: "word/document.xml", bytes: utf8(source) },
    { name: "word/styles.xml", bytes: utf8('<s>\r\n<!--unchanged--></s>') },
    { name: "custom/opaque.xml", bytes: new Uint8Array([0xff, 0, 42]) },
    { name: "word/media/item.bin", bytes: new Uint8Array([0, 1, 255]) }
  ].map(member => ({ ...member, directory: false, modified: new Date("2024-01-02T03:04:06Z") }));
  const editor = new DocumentArchiveEditor({ members, comment: new Uint8Array() });
  const xml = editor.xml("word/document.xml");
  expect(editor.xml("word/document.xml")).toBe(xml);
  expect(editor.dirtyParts).toEqual([]);
  expect(editor.snapshot().members.map(m => m.bytes)).toEqual(members.map(m => m.bytes));
  xml.setText(xml.root.children[0]!.content[0]!, " Revised ");
  expect(editor.dirtyParts).toEqual(["word/document.xml"]);
  const staged = editor.snapshot();
  const fs = Volume.fromJSON({ "/output": "" });
  await writeArchive(staged, { async write(bytes) { fs.appendFileSync("/output", bytes); } }, { order: "name", compression }, context);
  const reopened = await readArchive(new Uint8Array(fs.readFileSync("/output") as Uint8Array), context);
  for (const original of members) {
    const actual = reopened.members.find(m => m.name === original.name)!;
    expect(actual.bytes).toEqual(original.name === "word/document.xml" ? utf8(source.replace(" A &amp; ", " Revised ")) : original.bytes);
  }
  members[1]!.bytes.fill(0);
  staged.members[1]!.bytes.fill(0);
  expect(editor.snapshot().members[1]!.bytes).toEqual(utf8('<s>\r\n<!--unchanged--></s>'));
  expect(() => editor.xml("custom/opaque.xml")).toThrow(InvalidXmlError);
  expect(() => editor.xml("missing.xml")).toThrow(RangeError);
});

it("preserves processing-instruction target and rejects normalized-away leading data", () => {
  const editor = new DocumentXmlEditor(utf8('<?before?><r><?inside\t?>x</r><?after?>'));
  editor.setText(editor.root.prolog![0]!, "ready");
  editor.setText(editor.root.content[0]!, "keep");
  editor.setText(editor.root.epilog![0]!, "done");
  expect(editor.serialize()).toEqual(utf8('<?before ready?><r><?inside\tkeep?>x</r><?after done?>'));
  expect(() => editor.setText(editor.root.content[0]!, " leading")).toThrow(UnsupportedEditError);
});

it("rejects attributes masquerading as text nodes and retains namespace scopes", () => {
  const editor = new DocumentXmlEditor(utf8('<a:r xmlns:a="urn:first" a:flag="yes"><a:r xmlns:a="urn:second" a:flag="keep"/></a:r>'));
  expect(() => editor.setText(editor.root.attributes[1]! as never, 'bad" extra="changed')).toThrow(UnsupportedEditError);
  editor.setAttribute(editor.root.children[0]!, "a:flag", "updated");
  const root = parseDocumentXml(editor.serialize()).root;
  expect(root.namespace).toBe("urn:first");
  expect(root.children[0]!.namespace).toBe("urn:second");
  expect(root.attributes[1]!.value).toBe("yes");
  expect(root.children[0]!.attributes[1]!.value).toBe("updated");
});

it("rejects cumulative escaped-byte and text limits without losing earlier edits", () => {
  const editor = new DocumentXmlEditor(utf8('<r a="1">old</r>'), { maxBytes: 25, maxTextLength: 8 });
  editor.setAttribute(editor.root, "a", "23");
  for (const text of ["<&<&", "abcdefgh", "😀😀😀😀"])
    expect(() => editor.setText(editor.root.content[0]!, text)).toThrow(ResourceLimitError);
  expect(editor.serialize()).toEqual(utf8('<r a="23">old</r>'));
});

it.each([null, 1, true, [], "limits", { maxBytes: 0 }, { resolver: () => {} }])("validates archive-editor XML configuration before copying members", config => {
  expect(() => new DocumentArchiveEditor({ members: [], comment: new Uint8Array() }, config as never)).toThrow(RangeError);
});

it("allows empty text and restores original lexical tokens after multiple edits", () => {
  const editor = new DocumentXmlEditor(utf8('<r a="&#49;" b=\'two\'>one<!--keep-->two</r>'));
  const [first, , second] = editor.root.content;
  editor.setText(first!, "");
  editor.setText(second!, "");
  editor.setAttribute(editor.root, "a", "2");
  editor.setAttribute(editor.root, "b", "3");
  expect(editor.serialize()).toEqual(utf8('<r a="2" b=\'3\'><!--keep--></r>'));
  editor.setText(first!, "one");
  editor.setText(second!, "two");
  editor.setAttribute(editor.root, "a", "1");
  editor.setAttribute(editor.root, "b", "two");
  expect(editor.dirtyNodes).toEqual([]);
  expect(editor.serialize()).toEqual(utf8('<r a="&#49;" b=\'two\'>one<!--keep-->two</r>'));
});

it("uses the shared unsupported-edit error for a preserve-only mutation", () => {
  const editor = new DocumentXmlEditor(utf8('<r><opaque>keep</opaque></r>'));
  expect(() => editor.setText(editor.root, "flatten")).toThrow(expect.objectContaining({ code: "unsupported-edit" }));
});

it.each(["valid", "strict", "template"] as const)("retains every admitted %s package payload on no-op and beside compatibility markup", async variant => {
  const fixture = await createDocumentFixture("equipment", variant);
  const admitted = await readDocumentArchive(fixture.bytes, context);
  const editor = new DocumentArchiveEditor(admitted);
  const xml = editor.xml(admitted.mainPart);
  const paragraph = xml.root.children[0]!.children.filter(node => node.localName === "p")[1]!;
  const text = paragraph.children.find(node => node.localName === "r")!.children[0]!.content[0]!;
  const fs = Volume.fromJSON({ "/roundtrip": "" });
  for (const changed of [false, true]) {
    if (changed) xml.setText(text, "Reserve keys");
    fs.writeFileSync("/roundtrip", "");
    await writeArchive(editor.snapshot(), { async write(bytes) { fs.appendFileSync("/roundtrip", bytes); } }, { order: "name", compression: "deflate" }, context);
    const reopened = await readDocumentArchive(new Uint8Array(fs.readFileSync("/roundtrip") as Uint8Array), context);
    expect(reopened.kind).toBe(admitted.kind);
    expect(reopened.dialect).toBe(admitted.dialect);
    expect(reopened.members.map(member => member.name)).toEqual(admitted.members.map(member => member.name));
    for (const member of reopened.members) {
      const original = fixture.parts.get(member.name)!;
      expect(member.bytes).toEqual(changed && member.name === admitted.mainPart
        ? utf8(new TextDecoder().decode(original).replace("Spare keys", "Reserve keys"))
        : original);
    }
  }
  xml.setText(text, "Spare keys");
  expect(editor.dirtyParts).toEqual([]);
});
