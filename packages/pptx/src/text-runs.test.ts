import { describe, it, expect } from "vitest";
import { parseXmlPart } from "./xml.js";
import { runPropertiesMerge, validateTextRunOptions } from "./text-runs.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function edit(style: Parameters<typeof runPropertiesMerge>[0], attributes = "", children = "") {
  const part = parseXmlPart(
    new TextEncoder().encode(`<a:rPr xmlns:a="${ns}" ${attributes}>${children}</a:rPr>`),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  return part.merge(part.root, runPropertiesMerge(style, ns)).root;
}
function attrs(node: ReturnType<typeof edit>) {
  return Object.fromEntries(
    node.attributes.filter((a) => !a.name.namespace).map((a) => [a.name.localName, a.value])
  );
}
describe("run character formatting", () => {
  it.each([
    [true, "1"],
    [false, "0"],
    [null, undefined]
  ] as const)("distinguishes bold %s", (bold, expected) => {
    expect(attrs(edit({ bold }, 'b="1" i="0" custom="keep"'))).toEqual({
      ...(expected === undefined ? {} : { b: expected }),
      i: "0",
      custom: "keep"
    });
  });
  it.each([
    [true, "1"],
    [false, "0"],
    [null, undefined]
  ] as const)("distinguishes italic %s", (italic, expected) => {
    expect(attrs(edit({ italic }, 'i="1"'))).toEqual(expected === undefined ? {} : { i: expected });
  });
  it.each([
    [1, "100"],
    [12.25, "1225"],
    [4000, "400000"],
    [null, undefined]
  ] as const)("writes font size %s in centipoints", (size, expected) => {
    expect(attrs(edit({ size }, 'sz="2000"'))).toEqual(
      expected === undefined ? {} : { sz: expected }
    );
  });
  it("writes language, baseline, spacing, capitalization and strike independently", () => {
    expect(
      attrs(
        edit({
          language: "pl-PL",
          baseline: -25,
          spacing: 1.2,
          capitalization: "small",
          strike: "double"
        })
      )
    ).toEqual({ lang: "pl-PL", baseline: "-25000", spc: "120", cap: "small", strike: "dblStrike" });
  });
  it.each([
    ["NONE", "none"],
    ["WORDS", "words"],
    ["SINGLE_LINE", "sng"],
    ["DOUBLE_LINE", "dbl"],
    ["HEAVY_LINE", "heavy"],
    ["DOTTED_LINE", "dotted"],
    ["DOTTED_HEAVY_LINE", "dottedHeavy"],
    ["DASH_LINE", "dash"],
    ["DASH_HEAVY_LINE", "dashHeavy"],
    ["DASH_LONG_LINE", "dashLong"],
    ["DASH_LONG_HEAVY_LINE", "dashLongHeavy"],
    ["DOT_DASH_LINE", "dotDash"],
    ["DOT_DASH_HEAVY_LINE", "dotDashHeavy"],
    ["DOT_DOT_DASH_LINE", "dotDotDash"],
    ["DOT_DOT_DASH_HEAVY_LINE", "dotDotDashHeavy"],
    ["WAVY_LINE", "wavy"],
    ["WAVY_HEAVY_LINE", "wavyHeavy"],
    ["WAVY_DOUBLE_LINE", "wavyDbl"]
  ] as const)("writes underline %s", (underline, xml) => {
    expect(attrs(edit({ underline }))).toEqual({ u: xml });
  });
  it("preserves font metadata when replacing only the typeface", () => {
    const node = edit(
      { font: "Atlas & Sons" },
      'dirty="0"',
      '<a:latin typeface="Old" pitchFamily="34" charset="1"/><a:ea typeface="East"/>'
    );
    expect(attrs(node.children[0]!)).toEqual({
      typeface: "Atlas & Sons",
      pitchFamily: "34",
      charset: "1"
    });
    expect(attrs(node.children[1]!)).toEqual({ typeface: "East" });
  });
  it("clears only explicitly null fields", () => {
    expect(
      attrs(
        edit(
          {
            language: null,
            baseline: null,
            spacing: null,
            underline: null,
            strike: null,
            capitalization: null
          },
          'lang="en-US" baseline="0" spc="1" u="sng" strike="noStrike" cap="all" b="0"'
        )
      )
    ).toEqual({ b: "0" });
  });
  it.each([
    { size: 0 },
    { size: 4001 },
    { spacing: 4001 },
    { baseline: 101 },
    { bold: 1 },
    { language: 1 },
    { underline: "bogus" },
    { font: "" },
    { unknown: true }
  ])("rejects invalid formatting %j", (value) => {
    expect(() => validateTextRunOptions(value as never)).toThrow();
  });
});

it("reads absent, explicit false and explicit values without materializing inherited styles", async () => {
  const { readRunFormatting } = await import("./text-runs.js");
  const part = parseXmlPart(
    new TextEncoder().encode(
      `<a:r xmlns:a="${ns}"><a:rPr b="0" i="true" sz="1450" lang="el-GR" u="dbl" baseline="-12500" spc="-150" cap="all" strike="sngStrike"><a:latin typeface="Cedar"/></a:rPr><a:t>Sample</a:t></a:r>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  expect(readRunFormatting(part.root)).toEqual({
    bold: false,
    italic: true,
    size: 14.5,
    font: "Cedar",
    language: "el-GR",
    underline: "dbl",
    baseline: -12.5,
    spacing: -1.5,
    capitalization: "all",
    strike: "single",
    color: null,
    highlight: null
  });
  const bare = parseXmlPart(
    new TextEncoder().encode(`<a:r xmlns:a="${ns}"><a:t>Sample</a:t></a:r>`),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  expect(readRunFormatting(bare.root)).toEqual({
    bold: null,
    italic: null,
    size: null,
    font: null,
    language: null,
    underline: null,
    baseline: null,
    spacing: null,
    capitalization: null,
    strike: null,
    color: null,
    highlight: null
  });
});

it.each([
  [-0.005, "-1"],
  [0.005, "1"]
])("rounds signed spacing halfway away from zero %s", (spacing, expected) => {
  expect(attrs(edit({ spacing }))).toEqual({ spc: expected });
});

it.each([
  ['b="1"', "bold", true],
  ['b="false"', "bold", false],
  ['i="0"', "italic", false],
  ['i="1"', "italic", true],
  ['sz="100"', "size", 1],
  ['sz="400000"', "size", 4000],
  ['u="none"', "underline", "none"],
  ['u="sng"', "underline", "sng"],
  ['u="wavyDbl"', "underline", "wavyDbl"],
  ['lang="ja-JP"', "language", "ja-JP"],
  ['strike="noStrike"', "strike", "none"],
  ['strike="dblStrike"', "strike", "double"],
  ['cap="none"', "capitalization", "none"],
  ['baseline="100000"', "baseline", 100],
  ['spc="0"', "spacing", 0]
])("reads literal run property %s", async (attribute, key, expected) => {
  const { readRunFormatting } = await import("./text-runs.js");
  const part = parseXmlPart(
    new TextEncoder().encode(`<a:r xmlns:a="${ns}"><a:rPr ${attribute}/><a:t>Seed</a:t></a:r>`),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  expect(readRunFormatting(part.root)[key as keyof ReturnType<typeof readRunFormatting>]).toBe(
    expected
  );
});

it.each([
  ["", true, "1"],
  ["", false, "0"],
  ["", null, undefined],
  ['="1"', true, "1"],
  ['="1"', false, "0"],
  ['="1"', null, undefined],
  ['="0"', true, "1"],
  ['="0"', false, "0"],
  ['="0"', null, undefined]
] as const)("applies both emphasis state transitions from %s to %s", (suffix, value, expected) => {
  for (const [key, attribute] of [
    ["bold", "b"],
    ["italic", "i"]
  ] as const)
    expect(attrs(edit({ [key]: value }, suffix ? attribute + suffix : ""))).toEqual(
      expected === undefined ? {} : { [attribute]: expected }
    );
});
it.each([
  ["", "zu-ZA"],
  ['lang="zu-ZA"', "ur-PK"],
  ['lang="ur-PK"', null],
  ["", null],
  ["", "fr-FR"],
  ['lang="fr-FR"', "pl-PL"],
  ['lang="pl-PL"', null]
] as const)("updates a language declaration %s to %s", (before, language) => {
  expect(attrs(edit({ language }, before))).toEqual(language === null ? {} : { lang: language });
});
it.each([
  [24, "2400"],
  [42, "4200"]
] as const)("writes a point size %s", (size, expected) => {
  expect(attrs(edit({ size }))).toEqual({ sz: expected });
});
it.each([
  ["", null],
  ['lang="pl-PL"', "pl-PL"],
  ['lang="de-AT"', "de-AT"],
  ['lang="fr-FR"', "fr-FR"]
] as const)("reads regional language %s", async (attribute, expected) => {
  const { readRunFormatting } = await import("./text-runs.js");
  const part = parseXmlPart(
    new TextEncoder().encode(`<a:r xmlns:a="${ns}"><a:rPr ${attribute}/><a:t>Fern</a:t></a:r>`),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  expect(readRunFormatting(part.root).language).toBe(expected);
});
