import { Pt } from "./length.js";
import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import {
  paragraphPropertiesMerge,
  readParagraphFormatting,
  validateTextParagraphOptions
} from "./text-paragraphs.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function part(attributes = "", children = "") {
  return parseXmlPart(
    new TextEncoder().encode(
      `<a:p xmlns:a="${ns}"><a:pPr ${attributes}>${children}</a:pPr><a:r><a:rPr b="1"/><a:t>River</a:t></a:r><a:br/><a:r><a:t>bank</a:t></a:r></a:p>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
}
function edit(
  options: Parameters<typeof paragraphPropertiesMerge>[0],
  attributes = "",
  children = ""
) {
  const p = part(attributes, children);
  return p.merge(p.root.children[0]!, paragraphPropertiesMerge(options, ns));
}
it.each([
  [0, "0"],
  [1, "12700"],
  [-2, "-25400"],
  [null, undefined]
] as const)("writes indent %s in EMU", (indent, expected) => {
  const p = edit({ indent }, 'indent="100" marL="99"');
  expect(p.root.children[0]!.attributes.find((a) => a.name.localName === "indent")?.value).toBe(
    expected
  );
  expect(new TextDecoder().decode(p.bytes())).toContain('marL="99"');
});
it("orders spacing bullets and tabs before default run properties and preserves mixed runs", () => {
  const p = edit(
    {
      lineSpacing: { unit: "multiple", value: 1.25 },
      spaceBefore: 0,
      spaceAfter: 3,
      bullet: { kind: "numbered", scheme: "arabicPeriod", startAt: 2 },
      rtl: true,
      level: 0
    },
    "",
    '<a:defRPr b="1"/><a:extLst/>'
  );
  expect(p.root.children[0]!.children.map((n) => n.name.localName)).toEqual([
    "lnSpc",
    "spcBef",
    "spcAft",
    "buAutoNum",
    "defRPr",
    "extLst"
  ]);
  expect(new TextDecoder().decode(p.bytes())).toContain('val="125000"');
  expect(new TextDecoder().decode(p.bytes())).toContain(
    '<a:r><a:rPr b="1"/><a:t>River</a:t></a:r><a:br/><a:r><a:t>bank</a:t></a:r>'
  );
  expect(readParagraphFormatting(p.root)).toMatchObject({
    rtl: true,
    level: 0,
    spaceBefore: 0,
    spaceAfter: 3,
    bullet: { kind: "numbered", scheme: "arabicPeriod", startAt: 2 }
  });
});
it.each([0, 12.5, 24])("writes absolute line spacing %s", (value) => {
  const p = edit(
    { lineSpacing: { unit: "pt", value } },
    "",
    '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>'
  );
  expect(p.root.children[0]!.children[0]!.children[0]!.name.localName).toBe("spcPts");
  expect(p.root.children[0]!.children[0]!.children[0]!.attributes[0]!.value).toBe(
    String(value * 100)
  );
});
it("clears local declarations without changing inherited list style or unrelated metadata", () => {
  const p = edit(
    { alignment: null, spaceAfter: null, bullet: null, lineSpacing: null, rtl: null },
    'algn="ctr" rtl="1" custom="retain"',
    '<a:lnSpc><a:spcPts val="900"/></a:lnSpc><a:spcAft><a:spcPts val="100"/></a:spcAft><a:buChar char="•"/><a:defRPr b="1"/>'
  );
  expect(readParagraphFormatting(p.root)).toMatchObject({
    alignment: null,
    lineSpacing: null,
    spaceAfter: null,
    bullet: null,
    rtl: null,
    level: null
  });
  expect(p.root.children[0]!.children.map((n) => n.name.localName)).toEqual(["defRPr"]);
});
it.each([
  { level: 9 },
  { level: -1 },
  { lineSpacing: { unit: "px", value: 2 } },
  { marginLeft: -1 },
  { tabs: [{ position: 0, alignment: "bad" }] },
  { bullet: { kind: "numbered", scheme: "invalid" } },
  { rtl: 1 },
  { unknown: 1 }
])("rejects invalid paragraph options %j", (options) =>
  expect(() => validateTextParagraphOptions(options as never)).toThrow()
);
it.each([
  { all: null, level: 0 },
  { allowEmpty: null, level: 0 },
  {
    tabs: [
      { position: 0, alignment: "left" },
      { position: 0.00001, alignment: "right" }
    ]
  }
])("rejects malformed controls or colliding serialized tabs %j", (options) =>
  expect(() => validateTextParagraphOptions(options as never)).toThrow()
);
it("accepts a supplementary Unicode bullet", () =>
  expect(() =>
    validateTextParagraphOptions({ bullet: { kind: "character", character: "🔷" } })
  ).not.toThrow());
it.each(['marL="NaN"', 'marL="Infinity"', 'rtl="no"', 'lvl=" "'])(
  "rejects invalid XML paragraph scalar %s",
  (attributes) => expect(() => readParagraphFormatting(part(attributes).root)).toThrow()
);
it("offers neutral formatting properties over an explicit owned paragraph", async () => {
  const { Paragraph, PP_ALIGN } = await import("./text-paragraphs.js");
  const view = new Paragraph(part());
  expect(view.level).toBe(0);
  expect(view.alignment).toBeNull();
  view.alignment = PP_ALIGN.RIGHT;
  view.level = 8;
  view.line_spacing = 1.75;
  view.space_before = new Pt(0);
  view.space_after = new Pt(12);
  expect(view.alignment).toBe(PP_ALIGN.RIGHT);
  expect(view.level).toBe(8);
  expect(view.line_spacing).toBe(1.75);
  expect(view.space_before?.pt).toBe(0);
  expect(view.space_after?.pt).toBe(12);
  view.line_spacing = new Pt(13.5);
  expect((view.line_spacing as Pt).pt).toBe(13.5);
  view.line_spacing = null;
  view.alignment = null;
  view.space_before = null;
  view.space_after = null;
  expect(readParagraphFormatting(view.xml.root)).toMatchObject({
    lineSpacing: null,
    alignment: null,
    spaceBefore: null,
    spaceAfter: null,
    level: 8
  });
});
it.each([
  '<a:lnSpc><a:spcPts val="NaN"/></a:lnSpc>',
  '<a:lnSpc><a:spcPct val="Infinity%"/></a:lnSpc>'
])("rejects invalid spacing scalars %s", (children) =>
  expect(() => readParagraphFormatting(part("", children).root)).toThrow()
);
it("inserts paragraph properties before mixed run content", async () => {
  const { applyParagraphFormatting } = await import("./text-paragraphs.js");
  const source = parseXmlPart(
    new TextEncoder().encode(
      `<a:p xmlns:a="${ns}"><a:r><a:t>East</a:t></a:r><a:br/><a:r><a:t>West</a:t></a:r></a:p>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
  const result = applyParagraphFormatting(source, source.root, { alignment: "center" });
  expect(result.root.children.map((n) => n.name.localName)).toEqual(["pPr", "r", "br", "r"]);
});
it("preserves extension children while replacing explicit tab stops", async () => {
  const { applyParagraphFormatting } = await import("./text-paragraphs.js");
  const source = part(
    "",
    '<a:tabLst custom="keep"><a:tab pos="12700" algn="l"/><meta xmlns="urn:custom">retained</meta></a:tabLst>'
  );
  const result = applyParagraphFormatting(source, source.root, {
    tabs: [{ position: 2, alignment: "right" }]
  });
  const xml = new TextDecoder().decode(result.bytes());
  expect(xml).toContain('<meta xmlns="urn:custom">retained</meta>');
  expect(xml).toContain('custom="keep"');
  expect(xml).toContain('pos="25400"');
  expect(xml).not.toContain('pos="12700"');
});
