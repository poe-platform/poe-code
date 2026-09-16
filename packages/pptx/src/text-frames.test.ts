import { expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import {
  applyFrameFormatting,
  readFrameFormatting,
  TextFrame,
  MSO_AUTO_SIZE,
  MSO_ANCHOR
} from "./text-frames.js";
import { Pt } from "./length.js";
const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
function source() {
  return parseXmlPart(
    new TextEncoder().encode(
      `<a:txBody xmlns:a="${ns}"><a:bodyPr rtlCol="1"><a:normAutofit fontScale="85000" lnSpcReduction="5000"/><a:extLst/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="1700"><a:latin typeface="Orchard"/><a:cs typeface="Garden"/></a:rPr><a:t>Green</a:t></a:r></a:p></a:txBody>`
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
}
it("changes frame layout without measuring or modifying fonts", () => {
  const xml = source();
  const result = applyFrameFormatting(xml, xml.root, {
    marginLeft: 2,
    marginTop: 0,
    verticalAnchor: "middle",
    columns: 16,
    wrap: false,
    verticalText: "vert270",
    rotation: -90,
    autofit: "text"
  });
  expect(readFrameFormatting(result.root)).toMatchObject({
    marginLeft: 2,
    marginTop: 0,
    verticalAnchor: "middle",
    columns: 16,
    wrap: false,
    verticalText: "vert270",
    rotation: -90,
    autofit: "text"
  });
  const raw = new TextDecoder().decode(result.bytes());
  expect(raw).toContain('fontScale="85000" lnSpcReduction="5000"');
  expect(raw).toContain('rtlCol="1"');
  expect(raw).toContain(
    '<a:rPr sz="1700"><a:latin typeface="Orchard"/><a:cs typeface="Garden"/></a:rPr>'
  );
  expect(raw).toContain('rot="-5400000"');
});
it("exposes neutral frame properties and explicit metadata removal", () => {
  const frame = new TextFrame(source());
  frame.margin_left = new Pt(0);
  frame.word_wrap = null;
  frame.auto_size = MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT;
  frame.vertical_anchor = MSO_ANCHOR.BOTTOM;
  expect(frame.margin_left.emu).toBe(0);
  expect(frame.word_wrap).toBeNull();
  expect(frame.auto_size).toBe(1);
  expect(frame.vertical_anchor).toBe(4);
  frame.auto_size = null;
  expect(readFrameFormatting(frame.xml.root).autofit).toBeNull();
});
it("assigns Unicode paragraphs and line breaks while retaining frame metadata", () => {
  const frame = new TextFrame(source());
  frame.text = "Rain & snow\n東\vWest";
  expect(frame.text).toBe("Rain & snow\n東\vWest");
  expect(frame.xml.root.children.filter((n) => n.name.localName === "p")).toHaveLength(2);
  expect(new TextDecoder().decode(frame.xml.bytes())).toContain('fontScale="85000"');
});
it.each(["0x10", "1e2", "1.0"])("rejects nondecimal frame attribute %s", (value) => {
  const xml = source();
  const broken = xml.merge(xml.root.children[0]!, {
    attributes: [{ namespace: "", localName: "numCol", value }]
  });
  expect(() => readFrameFormatting(broken.root)).toThrow();
});
it.each([{ autofit: "0" }, { verticalAnchor: "1" }])("rejects coerced frame enum %j", (value) => {
  const xml = source();
  expect(() => applyFrameFormatting(xml, xml.root, value as never)).toThrow();
});
it("escapes control text into portable literal sequences", () => {
  const f = new TextFrame(source());
  f.text = "A\x1bB";
  expect(f.text).toBe("A_x001B_B");
});
it.each([
  ["margin_left", 7.2, "lIns"],
  ["margin_right", 7.2, "rIns"],
  ["margin_top", 3.6, "tIns"],
  ["margin_bottom", 3.6, "bIns"]
] as const)("removes default model inset %s", (key, points, attribute) => {
  const f = new TextFrame(source());
  f[key] = new Pt(points);
  expect(f.xml.root.children[0]!.attributes.some((a) => a.name.localName === attribute)).toBe(
    false
  );
});
it.each([-2147483648, 2147483647])("retains signed layout boundary %s", (value) => {
  const xml = source();
  const result = applyFrameFormatting(xml, xml.root, {
    marginLeft: value / 12700,
    rotation: value / 60000
  });
  expect(result.root.children[0]!.attributes.find((a) => a.name.localName === "lIns")?.value).toBe(
    String(value)
  );
  expect(result.root.children[0]!.attributes.find((a) => a.name.localName === "rot")?.value).toBe(
    String(value)
  );
});
it.each(["just", "dist"])("preserves legal extended anchor %s during unrelated edits", (value) => {
  const xml = source();
  const extended = xml.merge(xml.root.children[0]!, {
    attributes: [{ namespace: "", localName: "anchor", value }]
  });
  expect(readFrameFormatting(extended.root).verticalAnchor).toBe(value);
  const result = applyFrameFormatting(extended, extended.root, { wrap: true });
  expect(
    result.root.children[0]!.attributes.find((a) => a.name.localName === "anchor")?.value
  ).toBe(value);
  const f = new TextFrame(result);
  expect(() => f.vertical_anchor).toThrow(expect.objectContaining({ code: "unsupported-profile" }));
});
