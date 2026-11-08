import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { Inches } from "./length.js";
import { TextFrame, MSO_AUTO_SIZE, MSO_VERTICAL_ANCHOR } from "./text-frames.js";

function frame(attributes = "", children = "") {
  return new TextFrame(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:txBody xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr ${attributes}>${children}</a:bodyPr><a:p><a:r><a:rPr lang="ar-SA" sz="1700" b="1"><a:ea typeface="Cedar East"/><a:cs typeface="Cedar Complex"/></a:rPr><a:t>River</a:t></a:r></a:p></p:txBody>`
      ),
      { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
    )
  );
}

it.each([
  ["", null],
  ["<a:noAutofit/>", MSO_AUTO_SIZE.NONE],
  ["<a:spAutoFit/>", MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT],
  ["<a:normAutofit/>", MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE]
] as const)("reads frame sizing state %s", (xml, expected) => {
  expect(frame("", xml).auto_size).toBe(expected);
});
it.each([
  [MSO_AUTO_SIZE.NONE, "noAutofit"],
  [MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT, "spAutoFit"],
  [MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE, "normAutofit"],
  [null, null]
] as const)("assigns frame sizing state %s", (value, expected) => {
  const f = frame("", "<a:normAutofit/>");
  f.auto_size = value;
  expect(f.auto_size).toBe(value);
  expect(f.xml.root.children[0]!.children.map((n) => n.name.localName)).toEqual(
    expected ? [expected] : []
  );
});
it.each([
  ["margin_left", "", "emu", 91440],
  ["margin_top", "", "emu", 45720],
  ["margin_right", "", "emu", 91440],
  ["margin_bottom", "", "emu", 45720],
  ["margin_left", 'lIns="9144"', "cm", 0.0254],
  ["margin_top", 'tIns="18288"', "mm", 0.508],
  ["margin_right", 'rIns="76200"', "pt", 6],
  ["margin_bottom", 'bIns="36576"', "inches", 0.04]
] as const)("reads %s from %s in %s", (side, attr, unit, expected) => {
  expect(frame(attr)[side][unit]).toBeCloseTo(expected, 10);
});
it.each([
  ["margin_left", 0.11, 100584],
  ["margin_top", 0.12, 109728],
  ["margin_right", 0.13, 118872],
  ["margin_bottom", 0.14, 128016],
  ["margin_left", 0.1, 91440],
  ["margin_top", 0.05, 45720],
  ["margin_right", 0.1, 91440],
  ["margin_bottom", 0.05, 45720],
  ["margin_top", 0.2, 182880],
  ["margin_right", 0.3, 274320],
  ["margin_bottom", 0.4, 365760]
] as const)("assigns %s at %s inches", (side, inches, emu) => {
  const f = frame();
  f[side] = new Inches(inches);
  expect(f[side].emu).toBe(emu);
});
it.each([
  ["", null],
  ['anchor="t"', MSO_VERTICAL_ANCHOR.TOP],
  ['anchor="ctr"', MSO_VERTICAL_ANCHOR.MIDDLE],
  ['anchor="b"', MSO_VERTICAL_ANCHOR.BOTTOM]
] as const)("reads anchor %s", (attr, expected) => {
  expect(frame(attr).vertical_anchor).toBe(expected);
});
it.each([MSO_VERTICAL_ANCHOR.TOP, MSO_VERTICAL_ANCHOR.MIDDLE, MSO_VERTICAL_ANCHOR.BOTTOM, null])(
  "assigns anchor %s",
  (value) => {
    const f = frame('anchor="b"');
    f.vertical_anchor = value;
    expect(f.vertical_anchor).toBe(value);
  }
);
it.each([
  ["", null],
  ['wrap="square"', true],
  ['wrap="none"', false]
] as const)("reads wrapping %s", (attr, expected) => {
  expect(frame(attr).word_wrap).toBe(expected);
});
it.each([true, false, null])("assigns wrapping %s", (value) => {
  const f = frame('wrap="square"');
  f.word_wrap = value;
  expect(f.word_wrap).toBe(value);
});
it("rejects a string inset without changing the frame", () => {
  const f = frame();
  expect(() => {
    f.margin_bottom = "0.1" as unknown as Inches;
  }).toThrow();
  expect(f.margin_bottom.emu).toBe(45720);
});

it.each([
  ["", "Meadow", ["Meadow"]],
  ["River", "Meadow", ["Meadow"]],
  ["River", "Meadow\nCoast", ["Meadow", "Coast"]],
  ["River\nForest", "Coast", ["Coast"]],
  ["River", "", [""]],
  ["", "M\vN", ["M\vN"]]
] as const)("replaces frame text from %s to %s", (before, next, paragraphs) => {
  const f = frame('anchor="ctr"');
  f.text = before;
  f.text = next;
  expect(f.text).toBe(next);
  const nodes = f.xml.root.children.filter((n) => n.name.localName === "p");
  expect(nodes).toHaveLength(paragraphs.length);
  expect(nodes.map((n) => n.children.map((c) => c.name.localName))).toEqual(
    paragraphs.map((p) => (p === "" ? [] : p.includes("\v") ? ["r", "br", "r"] : ["r"]))
  );
  expect(f.vertical_anchor).toBe(MSO_VERTICAL_ANCHOR.MIDDLE);
});
it("preserves script fonts and layout metadata while changing autofit", () => {
  const f = frame(
    'rtlCol="1" spcCol="25000" anchorCtr="1"',
    '<a:normAutofit fontScale="74000" lnSpcReduction="12000"/>'
  );
  const paragraph = f.xml.markup(f.xml.root.children[1]!);
  f.word_wrap = false;
  expect(f.xml.markup(f.xml.root.children[1]!)).toBe(paragraph);
  expect(new TextDecoder().decode(f.xml.bytes())).toContain(
    'fontScale="74000" lnSpcReduction="12000"'
  );
  f.auto_size = MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT;
  expect(f.xml.markup(f.xml.root.children[1]!)).toBe(paragraph);
  const xml = new TextDecoder().decode(f.xml.bytes());
  for (const metadata of ['rtlCol="1"', 'spcCol="25000"', 'anchorCtr="1"'])
    expect(xml).toContain(metadata);
  expect(xml).not.toContain("fontScale=");
});

it.each([
  ["", null],
  ["<a:noAutofit/>", MSO_AUTO_SIZE.NONE],
  ["<a:spAutoFit/>", MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT],
  ["<a:normAutofit/>", MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE]
] as const)("accepts saved frame sizing %s", (xml, expected) => {
  expect(frame("", xml).auto_size).toBe(expected);
});
it.each([
  null,
  MSO_AUTO_SIZE.NONE,
  MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT,
  MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
])("accepts assigned frame sizing %s", (value) => {
  const f = frame();
  f.auto_size = value;
  expect(f.auto_size).toBe(value);
});
it.each([
  ["margin_left", 0.1],
  ["margin_top", 0.2],
  ["margin_right", 0.3],
  ["margin_bottom", 0.4]
] as const)("accepts frame %s of %s inches", (side, amount) => {
  const f = frame();
  f[side] = new Inches(amount);
  expect(f[side].inches).toBe(amount);
});
it.each([true, false, null])("accepts frame wrapping %s", (value) => {
  const f = frame();
  f.word_wrap = value;
  expect(f.word_wrap).toBe(value);
});
it.each(["Oak", "O\na\nk"])("accepts frame text assignment %s", (value) => {
  const f = frame();
  f.text = value;
  expect(f.text).toBe(value);
});
it.each(["Oak", "O\na\nk"])("accepts persisted frame text %s", (value) => {
  const f = frame();
  f.text = value;
  const reopened = new TextFrame(
    parseXmlPart(f.xml.bytes(), { maxBytes: 10000, maxNodes: 100, maxDepth: 20 })
  );
  expect(reopened.text).toBe(value);
});

it.each(["Forest", "Sand\nStone\nSea"])("reads paragraph boundaries as frame text %s", (value) => {
  const paragraphs = value
    .split("\n")
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join("");
  const xml = `<p:txBody xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/>${paragraphs}</p:txBody>`;
  const f = new TextFrame(
    parseXmlPart(new TextEncoder().encode(xml), { maxBytes: 10000, maxNodes: 100, maxDepth: 20 })
  );
  expect(f.text).toBe(value);
});
