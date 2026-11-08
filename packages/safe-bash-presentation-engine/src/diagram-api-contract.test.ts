import { describe, expect, it } from "vitest";
import { MSO_SHAPE_TYPE, PP_PLACEHOLDER_TYPE, Shape, readShape } from "./index.js";
import { parseXmlPart } from "./xml.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";

describe("diagram public boundaries", () => {
  it("retains diagram category values without implying an editable diagram model", () => {
    expect(MSO_SHAPE_TYPE.DIAGRAM).toBe(21);
    expect(MSO_SHAPE_TYPE.IGX_GRAPHIC).toBe(24);
    expect(MSO_SHAPE_TYPE.metadata(21)).toEqual({ name: "DIAGRAM", value: 21 });
    expect(MSO_SHAPE_TYPE.metadata(24)).toEqual({ name: "IGX_GRAPHIC", value: 24 });
  });

  it("retains the diagram placeholder value and XML token", () => {
    expect(PP_PLACEHOLDER_TYPE.ORG_CHART).toBe(11);
    expect(PP_PLACEHOLDER_TYPE.from_xml("dgm")).toBe(11);
    expect(PP_PLACEHOLDER_TYPE.to_xml(11)).toBe("dgm");
    expect(PP_PLACEHOLDER_TYPE.metadata(11)).toEqual({
      name: "ORG_CHART",
      value: 11,
      xml_value: "dgm"
    });
  });

  it.each([
    ["chart", "http://schemas.openxmlformats.org/drawingml/2006/chart", ""],
    ["table", "http://schemas.openxmlformats.org/drawingml/2006/table", ""],
    ["embedded object", "http://schemas.openxmlformats.org/presentationml/2006/ole", "embed"],
    ["linked object", "http://schemas.openxmlformats.org/presentationml/2006/ole", "link"],
    ["unknown content", "urn:orchard:unrecognized-content", ""],
    ["diagram", "http://schemas.openxmlformats.org/drawingml/2006/diagram", ""],
    ["fallback drawing", "http://schemas.microsoft.com/office/drawing/2008/diagram", ""]
  ])("keeps %s graphic frames outside the ordinary shape editor", (_label, uri, objectKind) => {
    const xml = parseXmlPart(
      new TextEncoder().encode(
        `<p:graphicFrame xmlns:p="${p}" xmlns:a="${a}"><p:nvGraphicFramePr><p:cNvPr id="23" name="Canopy"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="36" y="72"/><a:ext cx="108" cy="144"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${objectKind ? `<p:oleObj><p:${objectKind}/></p:oleObj>` : ""}</a:graphicData></a:graphic></p:graphicFrame>`
      ),
      { maxBytes: 8192, maxNodes: 100, maxDepth: 16 }
    );
    const before = xml.bytes();
    expect(readShape(xml.root)).toMatchObject({
      shapeId: 23,
      name: "Canopy",
      kind: null,
      left: 36,
      top: 72,
      width: 108,
      height: 144
    });
    expect(() => new Shape(xml)).toThrowError(expect.objectContaining({ code: "invalid-value" }));
    expect(xml.bytes()).toEqual(before);
  });
});
