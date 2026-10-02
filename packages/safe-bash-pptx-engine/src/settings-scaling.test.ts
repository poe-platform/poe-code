import { describe, expect, it } from "vitest";
import { parseXmlPart } from "./xml.js";
import { scaleDrawingCanvas } from "./settings-scaling.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const limits = { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 };
function drawing(content: string) {
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${content}</p:spTree></p:cSld></p:sld>`
    ),
    limits
  );
}
describe("explicit drawing canvas scaling", () => {
  it("scales a shape outer geometry with nearest integer rounding", () => {
    const result = scaleDrawingCanvas(
      drawing(
        '<p:sp><p:spPr><a:xfrm><a:off x="-3" y="5"/><a:ext cx="101" cy="203"/></a:xfrm></p:spPr></p:sp>'
      ),
      1.5,
      2
    );
    expect(new TextDecoder().decode(result.bytes())).toContain(
      '<a:off x="-5" y="10"/><a:ext cx="152" cy="406"/>'
    );
  });
  it("scales group outer geometry while preserving its child coordinate system", () => {
    const child =
      '<p:sp><p:spPr><a:xfrm><a:off x="7" y="8"/><a:ext cx="9" cy="10"/></a:xfrm></p:spPr></p:sp>';
    const result = scaleDrawingCanvas(
      drawing(
        `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/><a:chOff x="30" y="40"/><a:chExt cx="500" cy="600"/></a:xfrm></p:grpSpPr>${child}</p:grpSp>`
      ),
      2,
      3
    );
    const xml = new TextDecoder().decode(result.bytes());
    expect(xml).toContain(
      '<a:off x="20" y="60"/><a:ext cx="200" cy="600"/><a:chOff x="30" y="40"/><a:chExt cx="500" cy="600"/>'
    );
    expect(xml).toContain(child);
  });
  it.each([
    "<p:sp><p:spPr/></p:sp>",
    "<p:graphicFrame/>",
    '<p:sp><p:spPr><a:xfrm rot="300"><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr></p:sp>'
  ])("rejects unsupported transform %s", (content) => {
    expect(() => scaleDrawingCanvas(drawing(content), 2, 2)).toThrowError(
      expect.objectContaining({ code: "unsupported-edit" })
    );
  });
});

describe("group child coordinate validation", () => {
  it.each([
    '<a:chOff x="0" y="0"/><a:chExt cx="Infinity" cy="100"/>',
    '<a:chOff x="0" y="0"/><a:chExt cx="1e2" cy="100"/>',
    '<a:chOff x="0" y="0"/><a:chExt cx="9007199254740992" cy="100"/>',
    '<a:chOff x="0" y="0"/><a:chExt cx="27273042316901" cy="100"/>',
    '<a:chOff x="0"/><a:chExt cx="100" cy="100"/>',
    '<a:chOff x="NaN" y="0"/><a:chExt cx="100" cy="100"/>',
    '<a:chOff x="1e2" y="0"/><a:chExt cx="100" cy="100"/>',
    '<a:chOff x="-27273042316901" y="0"/><a:chExt cx="100" cy="100"/>'
  ])("rejects malformed child coordinates %s", (coordinates) => {
    const input = drawing(
      `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/>${coordinates}</a:xfrm></p:grpSpPr></p:grpSp>`
    );
    expect(() => scaleDrawingCanvas(input, 2, 3)).toThrowError(
      expect.objectContaining({ code: "unsupported-edit" })
    );
  });
});
