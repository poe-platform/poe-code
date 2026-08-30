import assert from "node:assert/strict";
import { test } from "vitest";
import { parseXml,text } from "../../../../../../src/fs/s3/http/xml.js";

test("bounded XML handles namespaces, comments, CDATA and numeric entities", () => {
  const root = parseXml(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Root xmlns="urn:s3"><!--note--><Value><![CDATA[<tag>]]>&amp;&#x96EA;&#32;&#37;</Value></Root>'));
  assert.equal(text(root, "Value"), "<tag>&雪 %");
});

for (const [name, xml] of [
  ["DTD", '<!DOCTYPE Root [<!ENTITY x SYSTEM "file:///etc/passwd">]><Root>&x;</Root>'],
  ["unknown entity", "<Root>&custom;</Root>"],
  ["bad numeric entity", "<Root>&#xD800;</Root>"],
  ["bad close tag", "<Root><Child></Root>"],
  ["duplicate attributes", '<Root value="a" value="b"/>'],
  ["multiple roots", "<Root/><Root/>"],
  ["deep nesting", "<Root>".repeat(33) + "</Root>".repeat(33)],
  ["node bound", "<Root>" + "<Item/>".repeat(32_768) + "</Root>"],
  ["literal control", "<Root>\u0000</Root>"],
  ["processing instruction", "<Root><?instruction?></Root>"],
  ["wrong encoding", '<?xml version="1.0" encoding="UTF-16"?><Root/>'],
] as const) test(`XML rejects ${name}`, () => assert.throws(() => parseXml(Buffer.from(xml)), { code: "InvalidResponse" }));

test("XML rejects invalid UTF-8", () => assert.throws(() => parseXml(new Uint8Array([0xff])), { code: "InvalidResponse" }));
