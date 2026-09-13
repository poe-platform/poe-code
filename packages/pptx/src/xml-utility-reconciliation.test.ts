import { describe, expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { readXmlInteger } from "./xml-scalars.js";

const limits = { maxBytes: 8192, maxNodes: 100, maxDepth: 12 };
const parse = (text: string) => parseXmlPart(new TextEncoder().encode(text), limits);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const name = (localName: string) => ({ namespace: "", localName });
const container = (children: string) =>
  parse(`<list>${[...children].map((c) => `<${c}/>`).join("")}</list>`);

describe("XML utility behavior accounting", () => {
  it.each([
    ["abc", "bc", "b"],
    ["ac", "bc", "c"],
    ["ab", "c", null],
    ["a", "bc", null],
    ["bc", "abc", "b"],
    ["", "abc", null]
  ] as const)("finds child from %s matching %s", (present, matching, expected) => {
    const xml = container(present);
    expect(
      xml.root.children.find((child) => matching.includes(child.name.localName))?.name.localName ??
        null
    ).toBe(expected);
  });
  it.each([
    ["bc", "a", 0, "abc"],
    ["c", "a", 0, "ac"],
    ["", "a", 0, "a"],
    ["ac", "b", 1, "abc"],
    ["ab", "c", 2, "abc"]
  ] as const)("inserts %s child %s at %s", (present, added, index, expected) => {
    const xml = container(present);
    const result = xml.spliceChildren(xml.root, index, 0, [`<${added}/>`]);
    expect(result.root.children.map((c) => c.name.localName).join("")).toBe(expected);
    expect(text(xml.bytes())).toBe(`<list>${[...present].map((c) => `<${c}/>`).join("")}</list>`);
  });
  it.each([
    ["abc", "a", "bc"],
    ["abc", "ab", "c"],
    ["aabbcc", "b", "aacc"],
    ["abc", "b", "ac"],
    ["abc", "ac", "b"],
    ["aabbcc", "", "aabbcc"],
    ["abc", "c", "ab"],
    ["abc", "cb", "a"],
    ["aabbcc", "ab", "cc"],
    ["ac", "b", "ac"],
    ["", "cb", ""]
  ] as const)("removes %s children matching %s", (present, removed, expected) => {
    let xml = container(present);
    for (let index = xml.root.children.length - 1; index >= 0; index--)
      if (removed.includes(xml.root.children[index]!.name.localName))
        xml = xml.spliceChildren(xml.root, index, 1, []);
    expect(xml.root.children.map((c) => c.name.localName).join("")).toBe(expected);
  });
  it.each(["selected", null, "alternate"])("switches selection from %s", (state) => {
    const xml = parse(`<list>${state ? `<${state}/>` : ""}<tail/></list>`);
    expect(
      xml.root.children.find((c) => ["selected", "alternate"].includes(c.name.localName))?.name
        .localName ?? null
    ).toBe(state);
    const result = xml.merge(xml.root, {
      children: {
        sequence: [name("selected"), name("alternate"), name("tail")],
        remove: [name("alternate")],
        upsert: [{ name: name("selected"), merge: {} }]
      }
    });
    expect(result.root.children.map((c) => c.name.localName)).toEqual(["selected", "tail"]);
  });
  it.each([true, false])("reads inserts and removes optional singleton present=%s", (present) => {
    const xml = parse(`<list>${present ? "<optional/>" : ""}</list>`);
    expect(xml.root.children.length).toBe(present ? 1 : 0);
    const added = xml.merge(xml.root, {
      children: { sequence: [name("optional")], upsert: [{ name: name("optional"), merge: {} }] }
    });
    expect(added.root.children.map((c) => c.name.localName)).toEqual(["optional"]);
    const removed = xml.merge(xml.root, {
      children: { sequence: [name("optional")], remove: [name("optional")], upsert: [] }
    });
    expect(text(removed.bytes())).toBe("<list></list>");
  });
  it.each(["selected", "required", "repeated", "optional"])(
    "creates and inserts qualified %s children",
    (local) => {
      const fragment = `<q:${local} xmlns:q="urn:collection"/>`;
      const detached = parse(fragment);
      expect(detached.root.name).toEqual({ namespace: "urn:collection", localName: local });
      const xml = parse("<list><tail/></list>");
      const result = xml.spliceChildren(xml.root, 0, 0, [fragment]);
      expect(text(result.bytes())).toBe(`<list>${fragment}<tail/></list>`);
      expect(result.root.children[0]!.name).toEqual(detached.root.name);
    }
  );
  it.each([24, 36, 42, -42, 0, 0x2a])("explicitly encodes integer attribute %s", (value) => {
    const xml = parse('<list count="42"/>');
    const result = xml.merge(xml.root, {
      attributes: [{ ...name("count"), value: String(value) }]
    });
    expect(readXmlInteger(result.root.attributes[0]!.value)).toBe(value);
    expect(text(result.bytes())).toBe(`<list count="${value}"/>`);
  });
  it.each([null, -4, "2"])("keeps generic attribute boundary distinct for %s", (value) => {
    const xml = parse('<list count="1"/>');
    if (typeof value === "number") {
      expect(() =>
        xml.merge(xml.root, { attributes: [{ ...name("count"), value: value as never }] })
      ).toThrow();
      expect(text(xml.bytes())).toBe('<list count="1"/>');
    } else {
      const result = xml.merge(xml.root, { attributes: [{ ...name("count"), value }] });
      expect(result.root.attributes[0]?.value ?? null).toBe(value);
    }
  });
  it("reports raw missing attributes without inventing schema defaults", () => {
    expect(parse("<list/>").root.attributes).toEqual([]);
  });
  it.each(["word", "", " spaced "])("retains string attribute %s", (value) => {
    const xml = parse("<list/>");
    const result = xml.merge(xml.root, { attributes: [{ ...name("label"), value }] });
    expect(result.root.attributes[0]!.value).toBe(value);
  });
  it.each([["word"], 42, undefined, 42.42])("rejects nonstring attribute %s", (value) => {
    const xml = parse("<list/>");
    expect(() =>
      xml.merge(xml.root, { attributes: [{ ...name("label"), value: value as never }] })
    ).toThrow();
  });
  it.each(["42", "-42", "-0042"])("reads decimal integer %s", (value) => {
    expect(readXmlInteger(value)).toBe(value === "42" ? 42 : -42);
  });
  it.each(["", "word", "42.42", "0x0a3", null])("rejects invalid integer input %s", (value) => {
    expect(() => readXmlInteger(value as never)).toThrow();
  });
  it("preserves Unicode whitespace and resolves namespace records without parser callbacks", () => {
    const source = '<q:étude xmlns:q="urn:notes">\n  <q:ligne q:label="été"/>\n</q:étude>';
    const xml = parse(source);
    expect(text(xml.bytes())).toBe(source);
    expect(xml.root.name).toEqual({ namespace: "urn:notes", localName: "étude" });
    expect(xml.root.children[0]!.attributes[0]).toEqual({
      name: { namespace: "urn:notes", localName: "label" },
      value: "été"
    });
    expect(xml.resolveNamespace(xml.root, "q")).toBe("urn:notes");
    expect(xml.markup(xml.root)).toBe(source);
    expect(Object.isFrozen(xml.root)).toBe(true);
    expect(Object.keys(xml.root)).toEqual(["name", "attributes", "children"]);
    expect(() => parseXmlPart(source as never, limits)).toThrow();
  });
  it.each([
    "<item>text</item>",
    '<q:item xmlns:q="urn:notes"/>',
    '<q:item xmlns:q="urn:notes" label="value"/>',
    '<q:item xmlns:q="urn:notes">text</q:item>',
    '<q:created xmlns:q="urn:notes" kind="date">2020-01-02T03:04:05Z</q:created>'
  ])("preserves structured markup %s", (source) => {
    const xml = parse(source);
    expect(xml.markup(xml.root)).toBe(source);
    expect(text(xml.bytes())).toBe(source);
  });
  it.each(["<item>", "<q:item/>", "</q:item>"])(
    "rejects incomplete or unbound fragments %s",
    (source) => {
      expect(() => parse(source)).toThrow();
    }
  );
  it("retains attribute order and namespace declarations as bytes while exposing their meanings", () => {
    const left = parse('<item a="1" b="2" xmlns:q="urn:q" xmlns:r="urn:r"/>');
    const right = parse('<item b="2" a="1" xmlns:r="urn:r" xmlns:q="urn:q"/>');
    expect(left.bytes()).not.toEqual(right.bytes());
    expect(
      [...left.root.attributes].sort((a, b) => a.name.localName.localeCompare(b.name.localName))
    ).toEqual(
      [...right.root.attributes].sort((a, b) => a.name.localName.localeCompare(b.name.localName))
    );
    expect(left.resolveNamespace(left.root, "q")).toBe("urn:q");
    expect(right.resolveNamespace(right.root, "q")).toBe("urn:q");
  });
});

it.each([42, 0, -42, "42", null, 42.42])(
  "requires explicit string serialization for raw scalar %s",
  (value) => {
    const xml = parse('<list count="1"/>');
    if (typeof value === "number") {
      expect(() =>
        xml.merge(xml.root, { attributes: [{ ...name("count"), value: value as never }] })
      ).toThrow();
      expect(text(xml.bytes())).toBe('<list count="1"/>');
    } else {
      const result = xml.merge(xml.root, { attributes: [{ ...name("count"), value }] });
      expect(result.root.attributes[0]?.value ?? null).toBe(value);
    }
  }
);
it.each([
  ["empty", "<item/>", "<item/>", "<different/>"],
  [
    "qualified",
    '<q:item xmlns:q="urn:q"/>',
    '<q:item xmlns:q="urn:q"/>',
    '<q:item xmlns:q="urn:r"/>'
  ],
  ["indent", "  <item/>", "  <item/>", "<item/>"],
  ["attribute order", '<item a="1" b="2"/>', '<item b="2" a="1"/>', '<item c="1" b="2"/>'],
  [
    "declaration order",
    '<item xmlns:a="urn:a" xmlns:b="urn:b"/>',
    '<item xmlns:b="urn:b" xmlns:a="urn:a"/>',
    '<item xmlns:a="urn:a" xmlns:b="urn:c"/>'
  ],
  ["paired tags", "<item></item>", "<item></item>", "<item/>"]
])("compares lexical XML conservatively for %s", (_label, first, second, different) => {
  expect(text(parse(first!).bytes())).toBe(first);
  expect(text(parse(second!).bytes())).toBe(second);
  expect(parse(first!).bytes()).not.toEqual(parse(different!).bytes());
});

it("uses typed failure for absent integer lexical input", () => {
  expect(() => readXmlInteger(null as never)).toThrowError(
    expect.objectContaining({ code: "invalid-type" })
  );
});

it.each([
  ["selected", "<many/><anchor/>", 0, "<selected/><many/><anchor/>"],
  ["many", "<anchor/><extra/><last/>", 0, "<many/><anchor/><extra/><last/>"],
  ["extra", "<many/><anchor/><last/>", 2, "<many/><anchor/><extra/><last/>"],
  ["last", "<many/><anchor/><extra/>", 3, "<many/><anchor/><extra/><last/>"]
] as const)("inserts schema child %s among successors", (local, before, index, expected) => {
  const xml = parse(`<list>${before}</list>`);
  expect(text(xml.spliceChildren(xml.root, index, 0, [`<${local}/>`]).bytes())).toBe(
    `<list>${expected}</list>`
  );
});
it.each(["24", "36", "42", null])("preserves qualified scalar attribute %s", (value) => {
  const xml = parse('<list xmlns:q="urn:values" q:count="42"/>');
  const result = xml.merge(xml.root, {
    attributes: [{ namespace: "urn:values", localName: "count", value }]
  });
  expect(result.root.attributes).toEqual(
    value === null ? [] : [{ name: { namespace: "urn:values", localName: "count" }, value }]
  );
  expect(text(result.bytes())).toBe(
    value === null
      ? '<list xmlns:q="urn:values" />'
      : `<list xmlns:q="urn:values" q:count="${value}"/>`
  );
});
