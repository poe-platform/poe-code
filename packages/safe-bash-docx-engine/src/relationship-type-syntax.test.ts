import { Volume } from "memfs";
import { expect, it } from "vitest";
import { parseDocumentXml } from "./package-xml.js";
import { relationshipXmlRows } from "./relationship-xml.js";

const values = [
  ["empty", "", false], ["relative", "relative", false], ["network reference", "//example.test/a", false],
  ["path reference", "/path", false], ["query reference", "?query", false], ["fragment reference", "#part", false],
  ["digit scheme", "1scheme:value", false], ["punctuation scheme", "a_b:value", false],
  ["scheme without colon", "scheme", false], ["empty scheme", ":value", false],
  ["absolute fragment", "urn:original:value#part", false], ["empty fragment", "custom:path#", false],
  ["bad escape", "custom:%GG", false], ["short escape", "custom:%A", false], ["bare escape", "custom:%", false],
  ["space", "custom:a b", false], ["backslash", "custom:a\\b", false], ["brace", "custom:a{b", false],
  ["bracket path", "custom:path[0]", false], ["double userinfo", "custom://a@b@c/p", false],
  ["port letters", "custom://example.test:port/a", false], ["port sign", "custom://example.test:-1/a", false],
  ["unbracketed IPv6", "custom://2001:db8::1/a", false], ["invalid bracket host", "custom://[invalid]/a", false],
  ["unclosed IPv6", "custom://[::1/a", false], ["IPv6 trailing junk", "custom://[::1]junk/a", false],
  ["IPv6 scope", "custom://[fe80::1%25scope]/a", false], ["bad IPvFuture version", "custom://[vZ.example]/a", false],
  ["empty IPvFuture", "custom://[v1.]/a", false], ["private path", "custom:\uE000", false],
  ["noncharacter", "custom:\uFDD0", false], ["unicode tag", "custom:\u{E0001}", false],
  ["URN", "urn:original:value", true], ["empty hierarchy", "custom:", true], ["empty authority", "custom://", true],
  ["relative-looking hierarchy", "custom:opaque:path", true], ["slash hierarchy", "custom:/path", true],
  ["case and escape spelling", "CUSTOM:a%2fB", true], ["scheme symbols", "A+b.c-d:value", true],
  ["IPv6", "custom://[2001:db8::1]/path", true], ["IPv4 tail", "custom://[::ffff:192.0.2.1]:80/a", true],
  ["IPvFuture", "custom://[vF.a:b!$&'()*+,;=]/a", true], ["empty port", "custom://example.test:/a", true],
  ["userinfo", "custom://user:password@example.test:65536/a", true], ["international host", "custom://例.example/海", true],
  ["Unicode query", "custom:path?海", true], ["private query", "custom:path?\uE000", true],
  ["supplementary private query", "custom:path?\u{F0000}", true], ["international plane", "custom:\u{E1000}", true],
  ["query delimiters", "custom:path?other/path?query", true], ["escaped delimiter", "custom:a%23b", true],
  ["escaped octet", "custom:a%FFb", true], ["empty query", "custom:opaque?", true]
] as const;
it.each(values)("enforces absolute-IRI relationship type grammar: %s", (_label, value, valid) => {
  const escaped = value.split("&").join("&amp;").split('"').join("&quot;");
  const volume = Volume.fromJSON({ "/rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="audit" Type="${escaped}" Target=""/></Relationships>` });
  const bytes = new Uint8Array(volume.readFileSync("/rels") as Buffer), root = parseDocumentXml(bytes).root;
  if (valid) expect(relationshipXmlRows(root)[0]?.reltype).toBe(value);
  else expect(() => relationshipXmlRows(root)).toThrowError(expect.objectContaining({ code: "invalid-package" }));
  expect(volume.readFileSync("/rels")).toEqual(Buffer.from(bytes));
});
