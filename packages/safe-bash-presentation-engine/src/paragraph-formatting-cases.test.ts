import { describe, expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { paragraphPropertiesMerge, readParagraphFormatting } from "./text-paragraphs.js";

const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (body: string) =>
  parseXmlPart(new TextEncoder().encode(`<a:p xmlns:a="${ns}">${body}</a:p>`), {
    maxBytes: 8192,
    maxNodes: 100,
    maxDepth: 12
  });

describe("paragraph spacing value cases", () => {
  it.each([
    ["missing properties", "", null],
    ["empty properties", "<a:pPr/>", null],
    [
      "absolute eighteen",
      '<a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr>',
      { unit: "pt", value: 18 }
    ],
    [
      "fractional multiple",
      '<a:pPr><a:lnSpc><a:spcPct val="142000"/></a:lnSpc></a:pPr>',
      { unit: "multiple", value: 1.42 }
    ],
    [
      "percentage lexical form",
      '<a:pPr><a:lnSpc><a:spcPct val="124.64%"/></a:lnSpc></a:pPr>',
      { unit: "multiple", value: 1.2464 }
    ],
    [
      "one and a half",
      '<a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>',
      { unit: "multiple", value: 1.5 }
    ],
    [
      "absolute twenty",
      '<a:pPr><a:lnSpc><a:spcPts val="2000"/></a:lnSpc></a:pPr>',
      { unit: "pt", value: 20 }
    ]
  ] as const)("reads %s without measuring glyphs", (_name, xml, expected) => {
    expect(readParagraphFormatting(parse(xml).root).lineSpacing).toEqual(expected);
  });

  it.each([
    ["create multiple", "", "multiple", 1.42, "spcPct", "142000"],
    ["create absolute", "", "pt", 42, "spcPts", "4200"],
    ["replace multiple", '<a:spcPct val="110000"/>', "multiple", 0.875, "spcPct", "87500"],
    ["replace absolute", '<a:spcPts val="600"/>', "pt", 42, "spcPts", "4200"],
    ["absolute to multiple", '<a:spcPts val="1900"/>', "multiple", 0.925, "spcPct", "92500"],
    ["multiple to absolute", '<a:spcPct val="150000"/>', "pt", 24, "spcPts", "2400"],
    ["create one and a half", "", "multiple", 1.5, "spcPct", "150000"],
    ["double multiple", '<a:spcPct val="150000"/>', "multiple", 2, "spcPct", "200000"],
    ["create twenty points", "", "pt", 20, "spcPts", "2000"],
    ["twenty to twenty four", '<a:spcPts val="2000"/>', "pt", 24, "spcPts", "2400"],
    ["explicit zero", '<a:spcPts val="2000"/>', "pt", 0, "spcPts", "0"]
  ] as const)(
    "writes %s using literal schema units",
    (_name, initial, unit, value, child, expected) => {
      const doc = parse(initial ? `<a:pPr><a:lnSpc>${initial}</a:lnSpc></a:pPr>` : "<a:pPr/>");
      const result = doc.merge(
        doc.root.children[0]!,
        paragraphPropertiesMerge({ lineSpacing: { unit, value } }, ns)
      );
      const spacing = result.root.children[0]!.children.find((n) => n.name.localName === "lnSpc")!;
      expect(
        spacing.children.map((n) => [
          n.name.localName,
          n.attributes.find((a) => a.name.localName === "val")?.value
        ])
      ).toEqual([[child, expected]]);
    }
  );

  it.each(["spcPts", "spcPct"])(
    "clears %s line spacing while retaining inline content",
    (choice) => {
      const doc = parse(
        `<a:pPr><a:lnSpc><a:${choice} val="600"/></a:lnSpc></a:pPr><a:r><a:rPr b="1"/><a:t>North</a:t></a:r><a:br/><a:r><a:rPr i="1"/><a:t>South</a:t></a:r>`
      );
      const result = doc.merge(
        doc.root.children[0]!,
        paragraphPropertiesMerge({ lineSpacing: null }, ns)
      );
      expect(result.root.children[0]!.children).toEqual([]);
      expect(result.root.children.slice(1)).toEqual(doc.root.children.slice(1));
    }
  );

  for (const [key, tag] of [
    ["spaceBefore", "spcBef"],
    ["spaceAfter", "spcAft"]
  ] as const) {
    it.each([
      ["missing", "", null],
      ["empty", "<a:pPr/>", null],
      ["percentage", `<a:pPr><a:${tag}><a:spcPct val="150000"/></a:${tag}></a:pPr>`, null],
      ["six points", `<a:pPr><a:${tag}><a:spcPts val="600"/></a:${tag}></a:pPr>`, 6]
    ] as const)(`reads ${key} %s`, (_name, xml, expected) => {
      expect(readParagraphFormatting(parse(xml).root)[key]).toBe(expected);
    });
    it.each([
      ["create fractional", "", 8.333, "833"],
      ["replace points", '<a:spcPts val="600"/>', 42, "4200"],
      ["replace percentage", '<a:spcPct val="150000"/>', 24, "2400"],
      ["create six", "", 6, "600"],
      ["six to three", '<a:spcPts val="600"/>', 3, "300"],
      ["explicit zero", '<a:spcPts val="600"/>', 0, "0"]
    ] as const)(`writes ${key} %s`, (_name, initial, value, expected) => {
      const doc = parse(`<a:pPr>${initial ? `<a:${tag}>${initial}</a:${tag}>` : ""}</a:pPr>`);
      const result = doc.merge(
        doc.root.children[0]!,
        paragraphPropertiesMerge({ [key]: value }, ns)
      );
      const child = result.root.children[0]!.children.find((n) => n.name.localName === tag)!;
      expect(
        child.children.map((n) => [
          n.name.localName,
          n.attributes.find((a) => a.name.localName === "val")?.value
        ])
      ).toEqual([["spcPts", expected]]);
    });
    it(`clears ${key} instead of writing zero`, () => {
      const doc = parse(`<a:pPr><a:${tag}><a:spcPts val="600"/></a:${tag}></a:pPr>`);
      const result = doc.merge(
        doc.root.children[0]!,
        paragraphPropertiesMerge({ [key]: null }, ns)
      );
      expect(result.root.children[0]!.children).toEqual([]);
    });
  }
});

describe("paragraph alignment and indentation value cases", () => {
  it.each([
    ["left", "l"],
    ["center", "ctr"],
    ["right", "r"],
    ["justify", "just"],
    ["justifyLow", "justLow"],
    ["distributed", "dist"],
    ["thaiDistributed", "thaiDist"]
  ] as const)(
    "reads and writes %s alignment with an independent XML value",
    (alignment, xmlValue) => {
      expect(readParagraphFormatting(parse(`<a:pPr algn="${xmlValue}"/>`).root).alignment).toBe(
        alignment
      );
      const doc = parse('<a:pPr algn="l"/>');
      const result = doc.merge(doc.root.children[0]!, paragraphPropertiesMerge({ alignment }, ns));
      expect(
        result.root.children[0]!.attributes.find((a) => a.name.localName === "algn")?.value
      ).toBe(xmlValue);
    }
  );
  it("keeps absent alignment inherited and removes an explicit override", () => {
    expect(readParagraphFormatting(parse("").root).alignment).toBeNull();
    const doc = parse('<a:pPr algn="just"/>');
    const result = doc.merge(
      doc.root.children[0]!,
      paragraphPropertiesMerge({ alignment: null }, ns)
    );
    expect(
      result.root.children[0]!.attributes.find((a) => a.name.localName === "algn")
    ).toBeUndefined();
  });
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])("writes explicit indentation level %i", (level) => {
    const doc = parse('<a:pPr lvl="2"/>');
    const result = doc.merge(doc.root.children[0]!, paragraphPropertiesMerge({ level }, ns));
    expect(result.root.children[0]!.attributes.find((a) => a.name.localName === "lvl")?.value).toBe(
      String(level)
    );
    expect(readParagraphFormatting(result.root).level).toBe(level);
  });
  it("distinguishes absent indentation from explicit zero", () => {
    expect(readParagraphFormatting(parse("").root).level).toBeNull();
    expect(readParagraphFormatting(parse('<a:pPr lvl="0"/>').root).level).toBe(0);
  });
});

it("creates left alignment on an unformatted paragraph", () => {
  const doc = parse("<a:pPr/>");
  const result = doc.merge(
    doc.root.children[0]!,
    paragraphPropertiesMerge({ alignment: "left" }, ns)
  );
  expect(result.root.children[0]!.attributes.find((a) => a.name.localName === "algn")?.value).toBe(
    "l"
  );
});
it.each([
  ["first indentation", "", 1],
  ["next indentation", 'lvl="1"', 2],
  ["reset indentation", 'lvl="2"', 0]
] as const)("applies %s from its prior state", (_name, attributes, level) => {
  const doc = parse(`<a:pPr ${attributes}/>`);
  const result = doc.merge(doc.root.children[0]!, paragraphPropertiesMerge({ level }, ns));
  expect(result.root.children[0]!.attributes.find((a) => a.name.localName === "lvl")?.value).toBe(
    String(level)
  );
});
it("reads level two without a preceding mutation", () => {
  expect(readParagraphFormatting(parse('<a:pPr lvl="2"/>').root).level).toBe(2);
});

it("exports stable numeric alignment symbols and their alias", async () => {
  const { PP_ALIGN, PP_PARAGRAPH_ALIGNMENT } = await import("./text-paragraphs.js");
  expect(PP_ALIGN).toBe(PP_PARAGRAPH_ALIGNMENT);
  expect([
    PP_ALIGN.LEFT,
    PP_ALIGN.CENTER,
    PP_ALIGN.RIGHT,
    PP_ALIGN.JUSTIFY,
    PP_ALIGN.DISTRIBUTE,
    PP_ALIGN.THAI_DISTRIBUTE,
    PP_ALIGN.JUSTIFY_LOW,
    PP_ALIGN.MIXED
  ]).toEqual([1, 2, 3, 4, 5, 6, 7, -2]);
});

it("narrows nullable line multiples and absolute lengths on the model", async () => {
  const { Paragraph } = await import("./text-paragraphs.js");
  const { Length, Pt } = await import("./length.js");
  const model = new Paragraph(parse(""));
  expect(model.line_spacing).toBeNull();
  expect(() => (model.line_spacing as unknown as { pt: number }).pt).toThrow(TypeError);
  model.line_spacing = 1.5;
  expect(model.line_spacing).toBe(1.5);
  expect((model.line_spacing as unknown as { pt?: number }).pt).toBeUndefined();
  model.line_spacing = new Pt(20);
  const value = model.line_spacing;
  expect(value).toBeInstanceOf(Length);
  if (!(value instanceof Length)) throw new Error("Expected an absolute length.");
  expect(value.pt).toBe(20);
  expect(value.emu).toBe(254000);
  model.line_spacing = null;
  expect(model.line_spacing).toBeNull();
});
it.each(["space_before", "space_after"] as const)(
  "retains Length semantics for model %s",
  async (key) => {
    const { Paragraph } = await import("./text-paragraphs.js");
    const { Pt } = await import("./length.js");
    const model = new Paragraph(parse(""));
    expect(model[key]).toBeNull();
    model[key] = new Pt(6);
    expect(model[key]?.emu).toBe(76200);
    expect(model[key]?.pt).toBe(6);
    model[key] = new Pt(3);
    expect(model[key]?.emu).toBe(38100);
    model[key] = new Pt(0);
    expect(model[key]?.emu).toBe(0);
    model[key] = null;
    expect(model[key]).toBeNull();
  }
);
