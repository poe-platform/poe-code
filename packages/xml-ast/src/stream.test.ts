import { describe, expect, it } from "vitest";
import { parseXml, parseXmlStream, XmlLimitError } from "./index.js";

async function* chunks(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
describe("incremental XML trees", () => {
  const fixtures = [
    '<?xml version="1.0" encoding="UTF-8"?>\r\n<!--pre--><x xmlns="urn:x" xmlns:a="urn:a" a:key="a\tb&#10;c">hello😀&amp;\r\n<a:y/>tail<![CDATA[c\rdata]]><?p  value ?></x>\n',
    '<x><y xmlns="urn:y"/><y/><z xmlns:p="urn:p" p:x="v"/></x>',
    '<x><![CDATA[]]><!-- --><?empty?></x>',
    '<x a="&#13;"/>',
  ];
  for (const [index, xml] of fixtures.entries()) for (const size of [1, 2, 7, 512]) {
    it(`matches buffered tree ${index} in ${size}-unit chunks`, async () => {
      expect(await parseXmlStream(chunks(xml, size))).toEqual(parseXml(xml));
    });
  }
  it("preserves admission and element observations", async () => {
    const xml = '<x xmlns="urn:x" a="value"><y/>text</x>';
    for (const limits of [{ maxNodes: 1 }, { maxDepth: 1 }, { maxAttributes: 1 },
      { maxAttributesPerElement: 1 }, { maxNamespaces: 1 }, { maxContentNodes: 2 }, { maxTextLength: 4 }]) {
      await expect(parseXmlStream(chunks(xml, 1), limits)).rejects.toBeInstanceOf(XmlLimitError);
    }
    expect(await parseXmlStream(chunks(xml, 1), { retainContent: false })).toEqual(parseXml(xml, { retainContent: false }));
  });
  it("closes the producer on syntax, limit and callback failures", async () => {
    for (const xml of ['<!DOCTYPE x><x/>', '<x><y/></x>', '<x>']) {
      let closed = false;
      async function* source() { try { yield* chunks(xml, 1); } finally { closed = true; } }
      await expect(parseXmlStream(source(), { maxNodes: 1 })).rejects.toThrow();
      expect(closed).toBe(true);
    }
    const failure = { opaque: true };
    await expect(parseXmlStream(chunks('<x/>', 1), { onElement() { throw failure; } })).rejects.toBe(failure);
  });
  it("rejects DTDs and encoding mismatches", async () => {
    await expect(parseXmlStream(chunks('<!DOCTYPE x><x/>', 1))).rejects.toThrow('Invalid XML: DTD and entity declarations are forbidden');
    await expect(parseXmlStream(chunks('<?xml version="1.0" encoding="UTF-16"?><x/>', 1), { expectedEncoding: 'UTF-8' })).rejects.toThrow();
  });
});

it.each([
  '\ufeff\ufeff<x/>', '<x>\u0000</x>', '<x a="\u0000"/>', '<x><!--\u0000--></x>',
  '<x><![CDATA[\u0000]]></x>', '<x><?p \u0000?></x>', '<x>&#0;</x>',
  '<x xmlns:p=""/>', '<x xmlns:xml="urn:bad"/>', '<x xmlns="http://www.w3.org/2000/xmlns/"/>',
  '<x xmlns:a="urn:p" xmlns:b="urn:p" a:x="1" b:x="2"/>', '<?xml version="1.1"?><x/>',
  '<x/>text', '<x><y></x>', '<x/> <y/>', '<x a="a" a="b"/>', '<!ENTITY x "v"><x/>',
  '<x><?a:b:c?></x>', '<x><!--a--b--></x>', '<x>]]></x>'
])("rejects buffered-parser-invalid XML %j", async xml => {
  expect(() => parseXml(xml)).toThrow();
  await expect(parseXmlStream(chunks(xml, 1))).rejects.toThrow();
});

it("honors asynchronous checkpoints before pulling and releases the source on cancellation", async () => {
  const failure = { cancelled: true };
  let pulls = 0, closed = false, units = 0;
  async function* source() { try { pulls++; yield '<x>' + 'a'.repeat(4096) + '</x>'; } finally { closed = true; } }
  await expect(parseXmlStream(source(), {}, () => { throw failure; })).rejects.toBe(failure);
  expect(pulls).toBe(0);
  await expect(parseXmlStream(source(), {}, async amount => {
    await Promise.resolve(); units += amount; if (units >= 1024) throw failure;
  })).rejects.toBe(failure);
  expect(pulls).toBe(1); expect(closed).toBe(true); expect(units).toBe(1024);
});

it("validates a stream without retaining descendants, text, attributes or document content", async () => {
  let observed = 0, closed = false;
  async function* source() {
    try {
      yield '<?xml version="1.0"?><!--prolog--><x xmlns="urn:x" attr="value">';
      for (let i = 0; i < 1000; i++) yield '<y>first<![CDATA[second]]><!--third--><?p fourth?><z/></y>';
      yield '</x><!--epilog-->';
    } finally { closed = true; }
  }
  const root = await parseXmlStream(source(), { retainTree: false, onElement(_element, parent, depth) {
    observed++;
    if (parent) {
      expect(parent).toMatchObject({ children: [], content: [], text: '', attributes: [] });
      expect(depth).toBeGreaterThan(1);
    }
  } });
  expect(root).toEqual({ kind: 'element', name: 'x', namespace: 'urn:x', localName: 'x', children: [], content: [], attributes: [], text: '', namespaces: new Map() });
  expect(observed).toBe(2001); expect(closed).toBe(true);
});

it("keeps complete-document validation and admission when tree retention is disabled", async () => {
  const xml = '<x xmlns="urn:x" attr="value"><y/>text</x>';
  for (const limits of [{ maxNodes: 1 }, { maxDepth: 1 }, { maxAttributes: 1 }, { maxAttributesPerElement: 1 },
    { maxNamespaces: 1 }, { maxContentNodes: 2 }, { maxTextLength: 4 }])
    await expect(parseXmlStream(chunks(xml, 1), { ...limits, retainTree: false })).rejects.toBeInstanceOf(XmlLimitError);
  for (const suffix of ['<x/>', 'text', '<!--unclosed'])
    await expect(parseXmlStream(chunks(xml + suffix, 1), { retainTree: false })).rejects.toBeInstanceOf(SyntaxError);
});

it("awaits detached complete subtrees with bounded read-ahead and preserves their mixed content", async () => {
  let consumed = 0, pulled = 0, outstanding = 0;
  const xml = '<item xmlns:q="urn:q" q:a="v">before<item>nested</item><![CDATA[after]]></item>';
  const expected = parseXml(xml);
  async function* source() {
    yield '<root>';
    for (let i = 0; i < 1000; i++) { expect(outstanding).toBe(0); pulled++; yield xml; }
    yield '<kept/>tail</root>';
  }
  const root = await parseXmlStream(source(), { streamElements: {
    matches(element) { return element.localName === 'item'; },
    async consume(element, parent) {
      expect(++outstanding).toBe(1); expect(pulled - consumed).toBe(1);
      expect(parent!.children).toEqual([]);
      expect({ ...element, prolog: [], epilog: [] }).toEqual(expected);
      await Promise.resolve(); consumed++; outstanding--;
    }
  } });
  expect(consumed).toBe(1000);
  expect(root.children.map(n => n.localName)).toEqual(['kept']);
  expect(root.text).toBe('tail');
});

it("closes subtree producers on asynchronous storage failures and rejects incompatible modes", async () => {
  const failure = { storage: true }; let closed = false;
  async function* source() { try { yield '<root><item/></root>'; } finally { closed = true; } }
  const streamElements = { matches: () => true, async consume() { throw failure; } };
  await expect(parseXmlStream(source(), { streamElements: { ...streamElements, matches: (_n, _p, depth) => depth > 1 } })).rejects.toBe(failure);
  expect(closed).toBe(true);
  await expect(parseXmlStream(['<root/>'], { streamElements })).rejects.toBeInstanceOf(TypeError);
  for (const limits of [{ retainTree: false }, { retainContent: false }])
    await expect(parseXmlStream(['<root/>'], { ...limits, streamElements })).rejects.toBeInstanceOf(TypeError);
});

it("bounds queued subtrees even when a producer supplies one large chunk", async () => {
  let matched = 0, consumed = 0, maximum = 0;
  const root = await parseXmlStream(['<root>' + '<x/>'.repeat(10000) + '</root>'], { streamElements: {
    matches(_element, _parent, depth) { if (depth !== 2) return false; matched++; maximum = Math.max(maximum, matched - consumed); return true; },
    async consume() { await Promise.resolve(); consumed++; }
  } });
  expect(consumed).toBe(10000); expect(maximum).toBeLessThanOrEqual(128); expect(root.children).toEqual([]);
});

it('captures preceding sibling content at selection time within one parser window', async () => {
  const seen: [string, string][] = [];
  const root = await parseXmlStream(['<root>before<a/>between<![CDATA[mid]]><!--note--><b/>after</root>'], { streamElements: {
    captureBefore: true,
    matches: (_node, _parent, depth) => depth === 2,
    async consume(node, _parent, before = []) {
      await Promise.resolve();
      seen.push([node.localName, before.map(item => item.kind === 'element' ? item.name : item.text).join('|')]);
    }
  } });
  expect(seen).toEqual([['a', 'before'], ['b', 'between|mid|note']]);
  expect(root.children).toEqual([]); expect(root.text).toBe('after');
  expect(root.content).toEqual([{ kind: 'text', text: 'after' }]);
});

it.each([1, 512])('streams nested selections in closing order with %i-unit chunks', async size => {
  const seen: [string, string, string][] = [];
  const root = await parseXmlStream(chunks('<root>start<group>before<row/>between<group>inner<row/>end</group>tail</group>finish</root>', size), { streamElements: {
    includeNested: true,
    captureBefore: true,
    matches: (_node, _parent, depth) => depth > 1,
    async consume(node, parent, before = []) {
      await Promise.resolve();
      expect(node.children).toEqual([]);
      seen.push([node.localName, before.map(item => item.kind === 'element' ? item.name : item.text).join(''), node.text]);
      expect(parent.children).toEqual([]);
    }
  } });
  expect(seen).toEqual([['row', 'before', ''], ['row', 'inner', ''], ['group', 'between', 'end'], ['group', 'start', 'tail']]);
  expect(root.children).toEqual([]); expect(root.text).toBe('finish');
});
