import assert from "node:assert/strict";
import test from "node:test";
import { parseXml, text } from "../../../../../src/fs/s3/http/xml.js";
import { serverFor } from "./helpers.js";

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

for (const [name, body] of [
  ["malformed", "<ListBucketResult>"],
  ["DTD", "<!DOCTYPE ListBucketResult><ListBucketResult/>"],
  ["duplicate state", "<ListBucketResult><IsTruncated>false</IsTruncated><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["missing token", "<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"],
  ["bad escaping", "<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>%xx</Prefix></CommonPrefixes></ListBucketResult>"],
] as const) test(`HTTP 200 LIST ${name} is not successful metadata`, async context => {
  const fixture = await serverFor(context, (_request, response) => { response.end(body); });
  await assert.rejects(fixture.transport().listObjectsV2({ Bucket: "testbucket" }), { code: "InvalidResponse" });
});
