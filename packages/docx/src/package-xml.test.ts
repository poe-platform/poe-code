import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseDocumentXml, InvalidXmlError, ResourceLimitError, InvalidValueError } from "./index.js";
import { xml } from "./package-xml.js";

const utf8 = (text: string) => new TextEncoder().encode(text);
function utf16(text: string, little: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
  return bytes;
}

it("rejects declaration and byte-order disagreement during package inspection", () => {
  expect(() => xml(utf8('<?xml version="1.0" encoding="UTF-16"?><r/>'), () => {})).toThrow(InvalidXmlError);
});

it("retains namespaced attributes and ordered mixed and document content", () => {
  const source = '<?xml version="1.0"?>\n<!--cover--><?review open?><d:document xmlns:d="urn:document" xmlns:z="urn:extra" z:flag="yes"><d:p xml:space="preserve"> A &amp; <z:mark/> B <![CDATA[<raw>&]]><?mark keep?><!--note--> C </d:p></d:document><?review closed?>';
  const parsed = parseDocumentXml(utf8(source));
  expect(parsed.encoding).toBe("UTF-8");
  expect(parsed.bom).toBe(false);
  expect(parsed.root).toMatchObject({ name: "d:document", namespace: "urn:document", localName: "document" });
  expect(parsed.root.prolog?.map(node => node.kind)).toEqual(["text", "comment", "processing-instruction"]);
  expect(parsed.root.epilog).toEqual([{ kind: "processing-instruction", target: "review", text: "closed" }]);
  const paragraph = parsed.root.children[0]!;
  expect(paragraph.attributes).toContainEqual({ name: "xml:space", localName: "space", namespace: "http://www.w3.org/XML/1998/namespace", value: "preserve" });
  expect(paragraph.text).toBe(" A &  B <raw>& C ");
  expect(paragraph.content.map(node => node.kind)).toEqual(["text", "element", "text", "cdata", "processing-instruction", "comment", "text"]);
  expect(paragraph.children[0]!.namespace).toBe("urn:extra");
});

it.each(["UTF-8", "UTF-16LE", "UTF-16BE"] as const)("preserves owned bytes and admits %s BOM", encoding => {
  const declaration = encoding === "UTF-8" ? encoding : "UTF-16";
  const source = `<?xml version="1.0" encoding="${declaration}"?><r>雪 😀 é\r\n&#13;</r>`;
  const bytes = encoding === "UTF-8" ? new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(source)]) : utf16(source, encoding === "UTF-16LE");
  const fs = createFsFromVolume(new Volume());
  fs.writeFileSync("/part.xml", bytes);
  const input = new Uint8Array(fs.readFileSync("/part.xml") as Buffer);
  const parsed = parseDocumentXml(input);
  input.fill(0);
  expect(parsed.bytes).toEqual(bytes);
  expect(parsed.encoding).toBe(encoding);
  expect(parsed.bom).toBe(true);
  expect(parsed.root.text).toBe("雪 😀 é\n\r");
  expect(fs.readFileSync("/part.xml")).toEqual(Buffer.from(bytes));
});

it.each([true, false])("admits explicit UTF-16 byte order declarations", little => {
  const encoding = little ? "UTF-16LE" : "UTF-16BE";
  expect(parseDocumentXml(utf16(`<?xml version="1.0" encoding="${encoding}"?><r/>`, little)).encoding).toBe(encoding);
});

it("decodes multibyte and surrogate pairs split across decoder chunks", () => {
  const text = "x".repeat(4092) + "😀雪";
  expect(parseDocumentXml(utf8(`<r>${text}</r>`)).root.text).toBe(text);
  for (const little of [true, false]) {
    const text = "x".repeat(2043) + "😀雪";
    expect(parseDocumentXml(utf16(`<r>${text}</r>`, little)).root.text).toBe(text);
  }
});

it.each([
  new Uint8Array([0xc0, 0xaf]), new Uint8Array([0xef, 0xbb, 0xbf, 0xff]),
  new Uint8Array([0xff, 0xfe, 0x3c]), utf16('<r>\ud800</r>', true),
  utf16('<r>\udc00</r>', false), utf16('<r/>', true).subarray(2),
  utf8('<?xml version="1.0" encoding="windows-1252"?><r/>'),
  utf16('<?xml version="1.0" encoding="UTF-8"?><r/>', true),
  utf16('<?xml version="1.0" encoding="UTF-16BE"?><r/>', true)
])("rejects invalid bytes and unsupported or mismatched encoding", bytes => {
  expect(() => parseDocumentXml(bytes)).toThrow(InvalidXmlError);
});

it.each([
  '<r p:a="v"/>', '<p:r/>', '<r xmlns:p="urn:a" xmlns:q="urn:a" p:x="1" q:x="2"/>',
  '<r>&unknown;</r>', '<r>&#0;</r>', '<r>\u0000</r>',
  '<!DOCTYPE r SYSTEM "https://example.invalid/a.dtd"><r/>',
  '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///secret">]><r>&x;</r>',
  '<!DOCTYPE r [<!ENTITY % x SYSTEM "https://example.invalid/x">%x;]><r/>',
  '<!DOCTYPE r [<!ENTITY x "large">]><r>&x;</r>'
])("rejects malformed namespaces and prohibited entity inputs without resolution", source => {
  const fetch = vi.fn(() => { throw new Error("unexpected network access"); });
  vi.stubGlobal("fetch", fetch);
  try {
    expect(() => parseDocumentXml(utf8(source))).toThrow(InvalidXmlError);
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it("keeps external-looking attributes and instructions inert", () => {
  const parsed = parseDocumentXml(utf8('<?xml-stylesheet href="https://example.invalid/style"?><r xmlns:i="http://www.w3.org/2001/XInclude"><i:include href="file:///secret"/></r>'));
  expect(parsed.root.children[0]!.attributes[0]!.value).toBe("file:///secret");
  expect(parsed.root.prolog?.[0]?.kind).toBe("processing-instruction");
});

describe("XML budgets", () => {
  it.each([
    ["maxBytes", 3, '<r/>'], ["maxDepth", 1, '<r><a/></r>'],
    ["maxNodes", 1, '<r><a/></r>'], ["maxContentNodes", 2, '<r>a<!--b--></r>'],
    ["maxAttributes", 1, '<r a="1"><a b="2"/></r>'],
    ["maxAttributesPerElement", 1, '<r a="1" b="2"/>'],
    ["maxNamespaces", 1, '<r xmlns:p="urn:p"/>'],
    ["maxTextLength", 3, '<r>abcd</r>'], ["maxWork", 20, '<r>' + 'x'.repeat(100) + '</r>']
  ] as const)("enforces %s", (key, value, source) => {
    expect(() => parseDocumentXml(utf8(source), { [key]: value })).toThrow(ResourceLimitError);
  });
  it("checks work beyond byte decoding and validates numeric configuration", () => {
    const bytes = utf8('<r a="value">&#65;</r>');
    expect(() => parseDocumentXml(bytes, { maxWork: bytes.length })).toThrow(ResourceLimitError);
    for (const value of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => parseDocumentXml(bytes, { maxWork: value })).toThrow(InvalidValueError);
    }
    expect(() => parseDocumentXml(bytes, { unknown: 1 } as never)).toThrow(InvalidValueError);
  });
});

it("rejects a second byte-order mark instead of discarding document text", () => {
  expect(() => parseDocumentXml(utf8('\ufeff\ufeff<r/>'))).toThrow(InvalidXmlError);
});

it("resolves alternate prefixes, scoped rebinding and default namespace removal", () => {
  const root = parseDocumentXml(utf8('<a:page xmlns:a="urn:page" xmlns="urn:default" xmlns:z="urn:page"><z:p plain="" z:flag="on"/><a:p xmlns:a="urn:other"/><p xmlns=""/></a:page>')).root;
  expect(root.children.map(child => [child.name, child.namespace, child.localName])).toEqual([
    ["z:p", "urn:page", "p"], ["a:p", "urn:other", "p"], ["p", "", "p"]
  ]);
  expect(root.children[0]!.attributes).toContainEqual({ name: "plain", namespace: "", localName: "plain", value: "" });
  expect(root.children[0]!.attributes.find(attribute => attribute.name === "missing")).toBeUndefined();
  expect(root.children[0]!.namespaces.get("a")).toBe("urn:page");
  expect(root.children[1]!.namespaces.get("a")).toBe("urn:other");
});

it("retains inter-element whitespace, inherited space policy and XML normalization", () => {
  const root = parseDocumentXml(utf8('<r xml:space="preserve" a=" a\t\r\nb&#9;&#10;&#13; ">\n <a> </a>\n <b xml:space="default"> </b>\n</r>')).root;
  expect(root.text).toBe("\n \n \n");
  expect(root.content.map(node => node.kind)).toEqual(["text", "element", "text", "element", "text"]);
  expect(root.children.map(child => child.text)).toEqual([" ", " "]);
  expect(root.attributes.find(attribute => attribute.name === "a")!.value).toBe(" a  b\t\n\r ");
  expect(root.children[0]!.attributes).toEqual([]);
  expect(root.children[1]!.attributes[0]!.value).toBe("default");
});

it("requires byte input and rejects arbitrary parser hooks", () => {
  expect(() => parseDocumentXml('<r/>' as never)).toThrow(TypeError);
  const callback = vi.fn();
  expect(() => parseDocumentXml(utf8('<r/>'), { onElement: callback } as never)).toThrow(InvalidValueError);
  expect(callback).not.toHaveBeenCalled();
});

it.each([null, 1, true, [], "limits"])("rejects non-object XML configuration", options => {
  expect(() => parseDocumentXml(utf8('<r/>'), options as never)).toThrow(InvalidValueError);
});

it("applies defaults for explicitly undefined optional limits", () => {
  expect(parseDocumentXml(utf8('<r/>'), { maxDepth: undefined, maxWork: undefined } as never).root.name).toBe("r");
});
