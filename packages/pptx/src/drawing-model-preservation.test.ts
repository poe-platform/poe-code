import { expect, it } from "vitest";
import { Shape } from "./shapes.js";
import { parseXmlPart } from "./xml.js";

const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
function shape(body: string) {
  return new Shape(
    parseXmlPart(
      new TextEncoder().encode(
        `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}" xmlns:x="urn:drawing-metadata"><p:spPr>${body}</p:spPr></p:sp>`
      ),
      { maxBytes: 16000, maxNodes: 200, maxDepth: 16 }
    )
  );
}

it.each(["gradient", "patterned"] as const)(
  "inserts %s after geometry and before line and effects",
  (method) => {
    const payload =
      '<a:xfrm/><a:prstGeom prst="rect"/><a:ln/><a:effectDag name="retained"/><a:scene3d/><a:sp3d prstMaterial="metal"/>';
    const model = shape(payload);
    model.fill[method]();
    expect(model.xml.root.children[0]!.children.map((n) => n.name.localName)).toEqual([
      "xfrm",
      "prstGeom",
      method === "gradient" ? "gradFill" : "pattFill",
      "ln",
      "effectDag",
      "scene3d",
      "sp3d"
    ]);
  }
);

it("counts and edits only drawing gradient stops while retaining foreign children", () => {
  const foreign = '<x:gs pos="45000" marker="retained"/>';
  const model = shape(
    `<a:gradFill><a:gsLst>${foreign}<a:gs pos="0"><a:schemeClr val="accent3"/></a:gs><x:metadata/><a:gs pos="100000"><a:srgbClr val="123456"/></a:gs></a:gsLst></a:gradFill>`
  );
  const stops = model.fill.gradient_stops;
  expect(stops.length).toBe(2);
  expect([...stops].map((s) => s.position)).toEqual([0, 1]);
  expect(stops.at(-1).color.rgb.toString()).toBe("123456");
  stops.at(0).position = 0.25;
  stops.at(0).color.opacity = 0.5;
  expect(model.xml.markup(model.xml.root)).toContain(foreign);
  const list = model.xml.root.children[0]!.children[0]!.children[0]!;
  expect(list.children[1]!.attributes.find((at) => at.name.localName === "pos")?.value).toBe(
    "25000"
  );
  expect(list.children[1]!.children[0]!.name.localName).toBe("schemeClr");
  expect(list.children[1]!.children[0]!.children[0]!.attributes[0]!.value).toBe("50000");
  expect(() => stops.at(2)).toThrowError(expect.objectContaining({ code: "index-out-of-range" }));
});
