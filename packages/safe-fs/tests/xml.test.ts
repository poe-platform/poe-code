import { expect, it } from "vitest";
import { parseXml, parseXmlSteps } from "../src/xml.js";

it("retains ordered content, expanded attributes and namespace declarations", () => {
  const root = parseXml('<r xmlns:p="urn:p" p:a="&amp;">one<b>two</b><![CDATA[three]]><!--four--><?pi five?>six</r>');
  expect(root.text).toBe("onethreesix");
  expect(root.children.map(child => child.localName)).toEqual(["b"]);
  expect(root.content.map(node => node.kind)).toEqual(["text", "element", "cdata", "comment", "processing-instruction", "text"]);
  expect(root.attributes).toContainEqual({ name: "p:a", namespace: "urn:p", localName: "a", value: "&" });
  expect(root.namespaces.get("p")).toBe("urn:p");
});

it("bounds all retained nodes independently of element count and input bytes", () => {
  expect(() => parseXml('<r>a<!--b--><![CDATA[c]]></r>', { maxContentNodes: 3 })).toThrow("content node limit");
  expect(parseXml('<r>a<!--b--><![CDATA[c]]></r>', { maxContentNodes: 4 }).content).toHaveLength(3);
});

it.each([
  '<r>' + 'a'.repeat(20000) + '</r>',
  '<r a="' + 'x'.repeat(20000) + '"/>',
  '<' + 'n'.repeat(20000) + '/>',
  '<r>' + '&#0000000000000000000000000000000065;'.repeat(500) + '</r>',
  '<r' + ' '.repeat(20000) + '/>',
  '<r><!--' + 'x'.repeat(20000) + '--></r>',
  '<r><![CDATA[' + 'x'.repeat(20000) + ']]></r>'
])("offers bounded scanning checkpoints for a long token", source => {
  const iterator = parseXmlSteps(source);
  let checkpoints = 0;
  let result = iterator.next();
  while (!result.done) {
    expect(result.value).toBeGreaterThan(0);
    expect(result.value).toBeLessThanOrEqual(1024);
    checkpoints++;
    result = iterator.next();
  }
  expect(checkpoints).toBeGreaterThan(20);
  expect(result.value.localName).toBeTruthy();
});

it("admits an element before allocating or scanning its descendants", () => {
  const seen: string[] = [];
  expect(() => parseXml('<r><a/><b><broken></b></r>', { onElement(info, parent, depth) {
    seen.push(info.name);
    if (info.name === "b") {
      expect(parent?.name).toBe("r");
      expect(depth).toBe(2);
      throw new Error("admission stopped");
    }
  } })).toThrow("admission stopped");
  expect(seen).toEqual(["r", "a", "b"]);
});

it("lets an asynchronous consumer cancel during a long token after initial validation", async () => {
  const source = '<r a="' + 'x'.repeat(20000) + '"/>';
  const parser = parseXmlSteps(source);
  const controller = new AbortController();
  const reason = Object.freeze({ stopped: "during attribute scanning" });
  let work = 0;
  let scheduled = false;
  const consume = async () => {
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const result = parser.next();
        if (result.done) return result.value;
        work += result.value;
        if (work > source.length && !scheduled) {
          scheduled = true;
          await new Promise<void>(resolve => setTimeout(() => { controller.abort(reason); resolve(); }, 0));
        }
      }
    } finally { parser.return(undefined as never); }
  };
  await expect(consume()).rejects.toBe(reason);
  expect(scheduled).toBe(true);
  expect(work).toBeLessThan(source.length + 1024);
});

it("preserves the XML declaration without treating it as element content", () => {
  const root = parseXml('<?xml version="1.0"?><r/>');
  expect(root.declaration).toBe('<?xml version="1.0"?>');
  expect(root.content).toEqual([]);
});

it("omits rich retained objects in legacy mode while preserving validation and scalar text", () => {
  const source = '<r xmlns:p="urn:p" p:a="v">one<b/>two<!--comment--><?pi data?><![CDATA[three]]></r>';
  const root = parseXml(source, { retainContent: false, maxNodes: 2, maxContentNodes: 2 });
  expect(root.text).toBe("onetwothree");
  expect(root.children).toHaveLength(1);
  for (const node of [root, root.children[0]!]) {
    expect(node.content).toEqual([]);
    expect(node.attributes).toEqual([]);
    expect(node.namespaces.size).toBe(0);
  }
  expect(() => parseXml('<r p:a="v"/>', { retainContent: false })).toThrow("unbound attribute prefix");
  expect(() => parseXml('<r a="&unknown;"/>', { retainContent: false })).toThrow("undeclared entity");
  expect(() => parseXml(source, { retainContent: false, maxContentNodes: 1 })).toThrow("content node limit");
});

it("charges retained attributes independently against both node and attribute limits", () => {
  expect(() => parseXml('<r a="v"/>', { maxContentNodes: 1 })).toThrow("content node limit");
  expect(parseXml('<r a="v"/>', { maxContentNodes: 2 }).attributes).toHaveLength(1);
  expect(() => parseXml('<r a="v" b="v"/>', { maxAttributes: 1 })).toThrow("attribute limit");
});

it("shares unchanged namespace scopes and isolates a declared child scope", () => {
  const root = parseXml('<r xmlns:p="urn:parent"><a/><b xmlns:p="urn:child"><c/></b><d/></r>');
  expect(root.children[0]!.namespaces).toBe(root.namespaces);
  expect(root.children[2]!.namespaces).toBe(root.namespaces);
  expect(root.children[1]!.namespaces).not.toBe(root.namespaces);
  expect(root.children[1]!.children[0]!.namespaces).toBe(root.children[1]!.namespaces);
  expect(root.children[1]!.namespaces.get("p")).toBe("urn:child");
  expect(root.namespaces.get("p")).toBe("urn:parent");
});

it("preserves non-XML whitespace as processing-instruction data", () => {
  const root = parseXml('<r><?go \u00a0data?></r>');
  expect(root.content[0]).toEqual({ kind: "processing-instruction", target: "go", text: "\u00a0data" });
});

it("rejects non-XML whitespace inside declarations", () => {
  expect(() => parseXml('<?xml version\u00a0="1.0"?><r/>')).toThrow("unsupported XML declaration");
});

it("enforces an explicitly UTF-8 decoded input profile without changing DAV encoding support", () => {
  const utf16 = '<?xml version="1.0" encoding="UTF-16"?><r/>';
  expect(() => parseXml(utf16, { expectedEncoding: "UTF-8" })).toThrow("unsupported XML declaration");
  expect(parseXml(utf16).localName).toBe("r");
  expect(parseXml('<?xml version="1.0" encoding="utf-8"?><r/>', { expectedEncoding: "UTF-8" }).localName).toBe("r");
  expect(parseXml('<r/>', { expectedEncoding: "UTF-8" }).localName).toBe("r");
});
