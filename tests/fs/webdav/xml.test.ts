import assert from "node:assert/strict";
import { test } from "node:test";
import { davChild, parseXml, scalar } from "../../../src/fs/webdav/xml.js";

test("namespace scopes, prefix rebinding and default namespace undeclaration", () => {
  const root = parseXml('<d:root xmlns:d="DAV:" xmlns="urn:default"><d:child/><child/><d:other xmlns:d="urn:other"/><child xmlns=""/></d:root>');
  assert.equal(root.namespace, "DAV:");
  assert.deepEqual(root.children.map((child) => child.namespace), ["DAV:", "urn:default", "urn:other", ""]);
  assert.equal(davChild(root, "child")!.namespace, "DAV:");
});

test("escaped text, numeric references, CDATA, comments and processing instructions", () => {
  const root = parseXml('<?xml version="1.0"?><root xml:lang="en" attr="&quot;&apos;&amp;">&amp;&lt;&gt;&quot;&apos;&#65;&#x1F600;<![CDATA[<raw>&]]><!----><!--ok--><?extra value?></root>');
  assert.equal(scalar(root), '&<>"\'A😀<raw>&');
  assert.equal(parseXml('<雪:名 xmlns:雪="DAV:"/>').localName, "名");
  assert.equal(parseXml('<root a="x>y"/>').localName, "root");
});

for (const xml of ["", "<root>", "<root></other>", "<a/><b/>", "text<root/>", "<root/>text", "<p:root/>",
  '<root p:a="value"/>', '<root a="1" a="2"/>', '<root xmlns:a="urn:x" xmlns:b="urn:x" a:key="1" b:key="2"/>',
  '<root xmlns:xml="urn:wrong"/>', '<root xmlns:p="http://www.w3.org/XML/1998/namespace"/>', '<root xmlns:xmlns="urn:x"/>',
  '<root xmlns:p=""/>', '<root xmlns="http://www.w3.org/2000/xmlns/"/>', '<xmlns:root/>',
  '<root>&unknown;</root>', '<root>&amp</root>', '<root>&#0;</root>', '<root>&#xD800;</root>', '<root>&#x110000;</root>',
  '<root>&#-1;</root>', '<root>&#NaN;</root>', '<root>\0</root>', '<root>\ud800</root>',
  '<!DOCTYPE root SYSTEM "file:///etc/passwd"><root/>', '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>',
  '<root a="bad<value"/>', '<root a=unquoted/>', '<root a="unterminated>', '<root a="1"b="2"/>', '<root>]]></root>',
  '<root><!-- bad -- comment --></root>', '<root><!--bad---></root>', '<root><![CDATA[bad</root>', '<![CDATA[outside]]><root/>',
  '<root><?xml version="1.0"?></root>', '<?xml version="1.1"?><root/>', '<?xml version="1.0" encoding="ISO-8859-1"?><root/>',
  '<root><a:b:c/></root>', '<root><1bad/></root>', '<root/>\u00a0']) {
  test(`rejects malformed or unsafe XML ${JSON.stringify(xml)}`, () => {
    assert.throws(() => parseXml(xml), SyntaxError);
  });
}

test("bounded nesting and node counts", () => {
  assert.throws(() => parseXml("<r>".repeat(65) + "</r>".repeat(65)), /resource limit/);
  assert.throws(() => parseXml("<root><a/><b/></root>", { maxNodes: 2 }), /resource limit/);
  assert.throws(() => parseXml("<root/>", { maxDepth: 0 }), RangeError);
  assert.throws(() => parseXml('<root first="1" second="2"/>', { maxAttributes: 1 }), /attribute limit/);
  assert.throws(() => parseXml(`<root ${Array.from({ length: 129 }, (_, index) => `attr${index}="value"`).join(" ")}/>`), /attribute limit/);
  const declarations = (start: number, count: number): string => Array.from({ length: count }, (_, index) => `xmlns:prefix${start + index}="urn:${start + index}"`).join(" ");
  assert.throws(() => parseXml(`<root ${declarations(0, 100)}><child ${declarations(100, 100)}><leaf ${declarations(200, 57)}/></child></root>`), /namespace scope limit/);
});

test("namespace budget is scoped, not consumed by independent sibling declarations", () => {
  const root = parseXml(`<root>${Array.from({ length: 1_000 }, (_, index) => `<child xmlns:prefix${index}="urn:${index}"/>`).join("")}</root>`);
  assert.equal(root.children.length, 1_000);
  const repeated = parseXml('<root xmlns:d="DAV:">' + '<d:child xmlns:d="DAV:"/>'.repeat(1_000) + '</root>');
  assert.equal(repeated.children.length, 1_000);
});

test("duplicate DAV children and mixed scalar content reject ambiguity", () => {
  assert.throws(() => davChild(parseXml('<root xmlns="DAV:"><href/><href/></root>'), "href"), SyntaxError);
  assert.throws(() => scalar(parseXml("<href>a<other/>b</href>")), SyntaxError);
});
