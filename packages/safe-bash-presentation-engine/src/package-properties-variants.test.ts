import { expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { CoreProperties } from "./properties.js";
import { parseXmlPart } from "./xml.js";

const strings = [
  ["author", "dc:creator", "Maple Studio"],
  ["category", "cp:category", ""],
  ["comments", "dc:description", ""],
  ["content_status", "cp:contentStatus", "REVIEW"],
  ["identifier", "dc:identifier", "MAP-4.7"],
  ["keywords", "cp:keywords", "leaf moss fern"],
  ["language", "dc:language", "en-GB"],
  ["last_modified_by", "cp:lastModifiedBy", "Avery Green"],
  ["subject", "dc:subject", "Woodland"],
  ["title", "dc:title", "Field Notes"],
  ["version", "cp:version", "2.8.4"]
] as const;
function properties(children: string) {
  let document = parseXmlPart(
    new TextEncoder().encode(
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${children}</cp:coreProperties>`
    ),
    { maxBytes: 8192, maxNodes: 100, maxDepth: 10 }
  );
  return {
    model: new CoreProperties(
      () => document,
      (next) => {
        document = next;
      }
    ),
    xml: () => new TextDecoder().decode(document.bytes())
  };
}
function values(xml: string) {
  const result: { namespace: string; local: string; value: string }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("opentag", (tag) => {
    depth++;
    if (depth === 2) result.push({ namespace: tag.uri, local: tag.local, value: "" });
  });
  parser.on("text", (text) => {
    if (depth === 2) result.at(-1)!.value += text;
  });
  parser.on("closetag", () => {
    depth--;
  });
  parser.write(xml).close();
  return result;
}
const namespaces: Record<string, string> = {
  dc: "http://purl.org/dc/elements/1.1/",
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  dcterms: "http://purl.org/dc/terms/"
};
it.each(strings)("reads original package string field %s", (name, tag, value) => {
  expect(Reflect.get(properties(`<${tag}>${value}</${tag}>`).model, name)).toBe(value);
});
it.each(strings)("writes original package string field %s", (name, tag) => {
  const part = properties("");
  Reflect.set(part.model, name, "New field value");
  expect(values(part.xml())).toEqual([
    {
      namespace: namespaces[tag.split(":")[0]!],
      local: tag.split(":")[1],
      value: "New field value"
    }
  ]);
  expect(Reflect.get(part.model, name)).toBe("New field value");
});
it.each([
  ["created", "dcterms:created", "2012-11-17T11:07:40-05:30", "2012-11-17T16:37:40.000Z"],
  ["last_printed", "cp:lastPrinted", "2014-06-04T04:28:00Z", "2014-06-04T04:28:00.000Z"],
  ["modified", "dcterms:modified", null, null]
] as const)("reads date package field %s", (name, tag, raw, expected) => {
  const value = Reflect.get(
    properties(raw === null ? "" : `<${tag}>${raw}</${tag}>`).model,
    name
  ) as Date | null;
  expect(value?.toISOString() ?? null).toBe(expected);
});
it.each([
  ["created", "dcterms:created", "2001-02-03T04:05:00Z"],
  ["last_printed", "cp:lastPrinted", "2014-06-04T04:00:00Z"],
  ["modified", "dcterms:modified", "2005-04-03T02:01:00Z"]
] as const)("writes explicit UTC date package field %s", (name, tag, expected) => {
  const part = properties("");
  Reflect.set(part.model, name, new Date(expected));
  expect(values(part.xml())).toEqual([
    { namespace: namespaces[tag.split(":")[0]!], local: tag.split(":")[1], value: expected }
  ]);
  if (name !== "last_printed") expect(part.xml()).toContain('xsi:type="dcterms:W3CDTF"');
  else expect(part.xml()).not.toContain("xsi:type=");
});
it.each([
  ["42", 42],
  [null, 0],
  ["unknown count", 0],
  ["-17", 0],
  ["32.7", 0]
] as const)("reads revision lexical package value %s", (raw, expected) => {
  expect(properties(raw === null ? "" : `<cp:revision>${raw}</cp:revision>`).model.revision).toBe(
    expected
  );
});
it("writes an integral package revision", () => {
  const part = properties("");
  part.model.revision = 42;
  expect(values(part.xml())).toEqual([
    { namespace: namespaces.cp, local: "revision", value: "42" }
  ]);
});
