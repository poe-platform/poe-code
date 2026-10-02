import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { readRunFormatting, runPropertiesMerge, validateTextRunOptions } from "./text-runs.js";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (body: string) =>
  parseXmlPart(
    new TextEncoder().encode(`<a:r xmlns:a="${a}">${body}<a:t>مَرْحَبًا 日本語 é 👩🏽‍🚀</a:t></a:r>`),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
const attrs = (node: ReturnType<typeof parse>["root"]) =>
  Object.fromEntries(
    node.attributes.filter((a) => !a.name.namespace).map((a) => [a.name.localName, a.value])
  );

it("extracts independent script fonts, alternate language and explicit run direction", () => {
  const doc = parse(
    '<a:rPr lang="ar-SA" altLang="ja-JP"><a:latin typeface="Grove Latin"/><a:ea typeface="Grove East" charset="-128"/><a:cs typeface="Grove Arabic" panose="020B0604020202020204"/><a:sym typeface="Grove Symbols"/><a:rtl val="0"/></a:rPr>'
  );
  expect(readRunFormatting(doc.root)).toMatchObject({
    font: "Grove Latin",
    eastAsiaFont: "Grove East",
    complexScriptFont: "Grove Arabic",
    symbolFont: "Grove Symbols",
    language: "ar-SA",
    alternateLanguage: "ja-JP",
    rtl: false
  });
});
it.each([true, false, null] as const)(
  "edits script fonts and run direction %s without discarding font attributes",
  (rtl) => {
    const options = {
      eastAsiaFont: "新しい字体",
      complexScriptFont: "خط جديد",
      symbolFont: null,
      alternateLanguage: "ko-KR",
      rtl
    };
    expect(() => validateTextRunOptions(options)).not.toThrow();
    const doc = parse(
      '<a:rPr lang="ar-SA" altLang="ja-JP"><a:latin typeface="Grove Latin"/><a:ea typeface="Old" pitchFamily="34" charset="-128"/><a:cs typeface="Old" panose="020B0604020202020204"/><a:sym typeface="Old"/><a:rtl val="1"/></a:rPr>'
    );
    const changed = doc.merge(
      doc.root.children[0]!,
      runPropertiesMerge(options, a, doc.root.children[0])
    );
    const properties = changed.root.children[0]!;
    expect(attrs(properties)).toEqual({ lang: "ar-SA", altLang: "ko-KR" });
    expect(properties.children.map((n) => n.name.localName)).toEqual(
      rtl === null ? ["latin", "ea", "cs"] : ["latin", "ea", "cs", "rtl"]
    );
    expect(attrs(properties.children[1]!)).toEqual({
      typeface: "新しい字体",
      pitchFamily: "34",
      charset: "-128"
    });
    expect(attrs(properties.children[2]!)).toEqual({
      typeface: "خط جديد",
      panose: "020B0604020202020204"
    });
    if (rtl !== null) expect(attrs(properties.children[3]!)).toEqual({ val: rtl ? "1" : "0" });
    expect(changed.markup(changed.root)).toContain("مَرْحَبًا 日本語 é 👩🏽‍🚀");
  }
);
it.each([
  { eastAsiaFont: "" },
  { complexScriptFont: "\ud800" },
  { symbolFont: 3 },
  { alternateLanguage: "\u0001" },
  { rtl: "true" }
])("rejects invalid script formatting %j before input admission", (options) => {
  expect(() => validateTextRunOptions(options as never)).toThrow();
});
it.each([
  ["", null],
  ["<a:rtl/>", false],
  ['<a:rtl val="true"/>', true],
  ['<a:rtl val="false"/>', false]
] as const)("reads direction default from %s", (child, expected) => {
  expect(readRunFormatting(parse(`<a:rPr>${child}</a:rPr>`).root).rtl).toBe(expected);
});
it("edits and extracts complex-script font classification independently", () => {
  const options = {
    complexScriptCharset: -128,
    complexScriptPitchFamily: 82,
    complexScriptPanose: "020b0604020202020204"
  };
  expect(() => validateTextRunOptions(options)).not.toThrow();
  const doc = parse(
    '<a:rPr><a:cs typeface="Grove Arabic" charset="1" pitchFamily="34" panose="00000000000000000000"/></a:rPr>'
  );
  const changed = doc.merge(
    doc.root.children[0]!,
    runPropertiesMerge(options, a, doc.root.children[0])
  );
  expect(attrs(changed.root.children[0]!.children[0]!)).toEqual({
    typeface: "Grove Arabic",
    charset: "-128",
    pitchFamily: "82",
    panose: "020B0604020202020204"
  });
  expect(readRunFormatting(changed.root)).toMatchObject({
    ...options,
    complexScriptPanose: "020B0604020202020204"
  });
});
it.each([
  { complexScriptCharset: -129 },
  { complexScriptCharset: 128 },
  { complexScriptCharset: 1.5 },
  { complexScriptPitchFamily: 3 },
  { complexScriptPanose: "00" },
  { complexScriptPanose: "GGGGGGGGGGGGGGGGGGGG" }
])("rejects invalid complex-script classification %j", (options) => {
  expect(() => validateTextRunOptions(options as never)).toThrow();
});
it.each(['charset="128"', 'charset="no"', 'pitchFamily="3"', 'panose="AB"'])(
  "rejects invalid existing complex-script classification %s",
  (attributes) => {
    expect(() =>
      readRunFormatting(parse(`<a:rPr><a:cs typeface="Grove" ${attributes}/></a:rPr>`).root)
    ).toThrow();
  }
);
it("clears classification overrides without creating a missing font", () => {
  const options = {
    complexScriptCharset: null,
    complexScriptPitchFamily: null,
    complexScriptPanose: null
  };
  const doc = parse(
    '<a:rPr><a:cs typeface="Grove" charset="1" pitchFamily="34" panose="020B0604020202020204"/></a:rPr>'
  );
  const changed = doc.merge(
    doc.root.children[0]!,
    runPropertiesMerge(options, a, doc.root.children[0])
  );
  expect(attrs(changed.root.children[0]!.children[0]!)).toEqual({ typeface: "Grove" });
  const bare = parse("<a:rPr/>");
  expect(
    bare.merge(bare.root.children[0]!, runPropertiesMerge(options, a, bare.root.children[0])).root
      .children[0]!.children
  ).toEqual([]);
  expect(() => runPropertiesMerge({ complexScriptCharset: 1 }, a)).toThrow();
});
it.each([
  ["on", true],
  ["off", false]
] as const)(
  "reads transitional direction %s without accepting it in strict XML",
  (value, expected) => {
    const xml = `<a:rPr><a:rtl val="${value}"/></a:rPr>`;
    expect(readRunFormatting(parse(xml).root).rtl).toBe(expected);
    const strict = parseXmlPart(
      new TextEncoder().encode(
        `<a:r xmlns:a="http://purl.oclc.org/ooxml/drawingml/main">${xml}<a:t>文字</a:t></a:r>`
      ),
      { maxBytes: 1000, maxNodes: 20, maxDepth: 10 }
    );
    expect(() => readRunFormatting(strict.root)).toThrow();
  }
);
it("requires a typeface when editing a malformed local complex-script font", () => {
  const doc = parse('<a:rPr><a:cs charset="1"/></a:rPr>');
  expect(() => runPropertiesMerge({ complexScriptCharset: 2 }, a, doc.root.children[0])).toThrow();
  const repaired = doc.merge(
    doc.root.children[0]!,
    runPropertiesMerge(
      { complexScriptCharset: 2, complexScriptFont: "Grove Arabic" },
      a,
      doc.root.children[0]
    )
  );
  expect(attrs(repaired.root.children[0]!.children[0]!)).toEqual({
    typeface: "Grove Arabic",
    charset: "2"
  });
});
