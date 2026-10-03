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
