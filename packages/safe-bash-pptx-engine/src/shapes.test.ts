import { MSO_COLOR_TYPE } from "./color-enums.js";
import { expect, it } from "vitest";
import { PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
import {
  Shape,
  createShapeXml,
  applyShapeUpdate,
  readShape,
  MSO_SHAPE_TYPE,
  validateShapeOptions,
  MSO_AUTO_SHAPE_TYPE
} from "./shapes.js";
import { parseXmlPart } from "./xml.js";
import { RGBColor } from "./text-run-color.js";
import { Inches, Pt } from "./length.js";
const limits = { maxBytes: 50000, maxNodes: 1000, maxDepth: 32 };
const parse = (xml: string) => parseXmlPart(new TextEncoder().encode(xml), limits);
function original(properties = "", nv = "") {
  return parse(
    `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="17" name="Orchard"/><p:cNvSpPr/><p:nvPr>${nv}</p:nvPr></p:nvSpPr><p:spPr>${properties}</p:spPr><p:extLst/></p:sp>`
  );
}
it("creates a preset with explicit units and schema ordered properties", () => {
  const xml = parse(
    createShapeXml(MSO_AUTO_SHAPE_TYPE.CHEVRON, 8, {
      left: new Inches(-1),
      top: new Pt(2),
      width: new Inches(3),
      height: new Inches(1),
      fill: "12ABEF",
      lineColor: "987654",
      lineWidth: new Pt(2),
      text: "Meadow & sky"
    })
  );
  expect(xml.root.children.map((n) => n.name.localName)).toEqual(["nvSpPr", "spPr", "txBody"]);
  const props = xml.root.children[1]!;
  expect(props.children.map((n) => n.name.localName)).toEqual([
    "xfrm",
    "prstGeom",
    "solidFill",
    "ln"
  ]);
  expect(readShape(xml.root)).toMatchObject({
    shapeId: 8,
    kind: "CHEVRON",
    left: -914400,
    top: 25400,
    width: 2743200,
    height: 914400,
    fill: "12ABEF",
    lineColor: "987654",
    lineWidth: 25400
  });
  expect(xml.markup(xml.root)).toContain("Meadow &amp; sky");
});
it("reads absent properties without creating or guessing geometry", () => {
  const xml = original();
  const before = xml.bytes();
  expect(readShape(xml.root)).toMatchObject({
    left: null,
    top: null,
    width: null,
    height: null,
    rotation: 0,
    fill: null,
    lineColor: null,
    lineWidth: null,
    locked: null,
    title: null,
    description: null,
    placeholder: null
  });
  expect(xml.bytes()).toEqual(before);
});
it.each([true, false, null])("updates locks with explicit three-state value %s", (locked) => {
  const xml = original();
  const changed = applyShapeUpdate(xml, xml.root, {
    locked,
    name: "Grove",
    title: "Canopy",
    description: "Leaves",
    left: new Pt(0)
  });
  expect(readShape(changed.root)).toMatchObject({
    locked,
    name: "Grove",
    title: "Canopy",
    description: "Leaves",
    left: 0,
    top: 0
  });
});
it.each([NaN, Infinity, -1, 1.5, 4294967296])("rejects invalid shape identity %s", (id) =>
  expect(() =>
    createShapeXml("text-box", id, {
      left: new Pt(0),
      top: new Pt(0),
      width: new Pt(1),
      height: new Pt(1)
    })
  ).toThrow()
);
it.each([
  { width: new Pt(-1) },
  { left: 3 },
  { width: { value: 1, unit: "px" } },
  { lineWidth: new Pt(-1) },
  { rotation: Infinity },
  { fill: "not-color" },
  { kind: "UNKNOWN" }
])("rejects invalid mutation without editing %j", (options) => {
  const xml = original();
  const bytes = xml.bytes();
  expect(() => applyShapeUpdate(xml, xml.root, options as never)).toThrow();
  expect(xml.bytes()).toEqual(bytes);
});
it("preserves unknown geometry and effects on unrelated updates", () => {
  const xml = original(
    '<a:prstGeom prst="futureGeometry"><a:avLst><a:gd name="adjust" fmla="val 31"/></a:avLst></a:prstGeom><a:gradFill/><a:effectLst/><a:scene3d/>'
  );
  const out = applyShapeUpdate(xml, xml.root, { name: "Updated", lineColor: "ABCDEF" });
  expect(out.markup(out.root)).toContain('prst="futureGeometry"');
  expect(out.root.children[1]!.children.map((n) => n.name.localName)).toEqual([
    "prstGeom",
    "gradFill",
    "ln",
    "effectLst",
    "scene3d"
  ]);
  expect(readShape(out.root).unsupported).toContain("preset:futureGeometry");
});
it.each([
  ["", 0, "obj"],
  ['idx="42" type="pic"', 42, "pic"]
] as const)("reads sparse placeholder metadata %s", (attrs, idx, type) => {
  const shape = new Shape(original("", `<p:ph ${attrs}/>`));
  expect(shape.is_placeholder).toBe(true);
  expect(shape.placeholder_format).toMatchObject({ idx, type: type === "pic" ? 18 : 7 });
});
it("exposes neutral shape properties and rejects absent placeholder or preset access", () => {
  const shape = new Shape(original());
  expect(shape.shape_id).toBe(17);
  expect(shape.name).toBe("Orchard");
  expect(shape.left).toBeNull();
  expect(() => shape.placeholder_format).toThrow();
  expect(() => shape.auto_shape_type).toThrow();
  shape.name = "Forest";
  shape.left = new Inches(2);
  shape.rotation = -450;
  expect(shape.name).toBe("Forest");
  expect(shape.left?.emu).toBe(1828800);
  expect(shape.rotation).toBe(270);
});
it("creates a text box and changes its text without losing the shape identity", () => {
  const shape = new Shape(
    parse(
      createShapeXml("text-box", 5, {
        left: new Pt(0),
        top: new Pt(0),
        width: new Pt(10),
        height: new Pt(10)
      })
    )
  );
  expect(shape.has_text_frame).toBe(true);
  shape.text = "River\nDelta";
  expect(shape.text).toBe("River\nDelta");
  expect(shape.shape_id).toBe(5);
  expect(() => shape.auto_shape_type).toThrow();
});
it.each([
  { width: new Pt(0) },
  { height: new Pt(0) },
  { width: { value: 0.000001, unit: "pt" } },
  { rotation: 360001 },
  { rotation: -360001 }
])("rejects out-of-contract geometry %j", (options) => {
  const xml = original();
  expect(() => applyShapeUpdate(xml, xml.root, options as never)).toThrow();
});
it("rounds fractional EMU symmetrically and creates required coordinate pairs", () => {
  const xml = original();
  const out = applyShapeUpdate(xml, xml.root, { left: { value: -0.5, unit: "emu" } });
  expect(out.markup(out.root)).toContain('x="-1"');
  expect(out.markup(out.root)).toContain('y="0"');
});
it("rejects missing dimension companions instead of emitting invalid extents", () => {
  const xml = original();
  expect(() => applyShapeUpdate(xml, xml.root, { width: new Pt(1) })).toThrow();
});
it("exposes immutable preset metadata and XML conversion", () => {
  expect(MSO_AUTO_SHAPE_TYPE.metadata(MSO_AUTO_SHAPE_TYPE.CHEVRON)).toEqual({
    name: "CHEVRON",
    value: 52,
    xml_value: "chevron"
  });
  expect(MSO_AUTO_SHAPE_TYPE.from_xml("rect")).toBe(1);
  expect(MSO_AUTO_SHAPE_TYPE.to_xml(9)).toBe("ellipse");
  expect(Object.isFrozen(MSO_AUTO_SHAPE_TYPE)).toBe(true);
  expect(() => MSO_AUTO_SHAPE_TYPE.from_xml("missing")).toThrow();
});
it("uses independent literal XML expectations for geometry and color", () => {
  const xml = parse(
    createShapeXml("RECTANGLE", 4, {
      left: new Pt(1),
      top: new Pt(2),
      width: new Pt(3),
      height: new Pt(4),
      fill: "A1B2C3",
      lineWidth: new Pt(1)
    })
  );
  const pr = xml.root.children[1]!;
  expect(pr.children[0]!.children[0]!.attributes.map((a) => [a.name.localName, a.value])).toEqual([
    ["x", "12700"],
    ["y", "25400"]
  ]);
  expect(pr.children[0]!.children[1]!.attributes.map((a) => [a.name.localName, a.value])).toEqual([
    ["cx", "38100"],
    ["cy", "50800"]
  ]);
  expect(pr.children[1]!.attributes.map((a) => a.value)).toEqual(["rect"]);
  expect(pr.children[2]!.children[0]!.attributes.map((a) => a.value)).toEqual(["A1B2C3"]);
});
it("edits basic live fill and line properties with explicit absent states", () => {
  const shape = new Shape(original());
  expect(shape.fill.type).toBeNull();
  expect(shape.line.width.emu).toBe(0);
  expect(() => shape.fill.fore_color).toThrow();
  shape.fill.solid();
  shape.fill.fore_color.rgb = RGBColor.from_string("123456");
  shape.line.color.rgb = RGBColor.from_string("ABCDEF");
  shape.line.width = new Pt(2);
  expect(shape.fill.fore_color.rgb?.toString()).toBe("123456");
  expect(shape.line.color.rgb?.toString()).toBe("ABCDEF");
  expect(shape.line.width.emu).toBe(25400);
  shape.fill.background();
  expect(shape.fill.type).toBe(5);
  expect(() => shape.fill.fore_color).toThrow();
});
it.each([
  ['<a:prstGeom prst="rect"/>', 1],
  ["<a:custGeom/>", 5]
] as const)("classifies supported shape categories %s", (geometry, kind) =>
  expect(new Shape(original(geometry)).shape_type).toBe(kind)
);
it("creates solid line fill on color access and rejects unavailable RGB", () => {
  const shape = new Shape(original('<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>'));
  expect(shape.fill.fore_color.type).toBe(MSO_COLOR_TYPE.SCHEME);
  expect(() => shape.fill.fore_color.rgb).toThrow();
  const color = shape.line.color;
  expect(shape.line.fill.type).toBe(1);
  expect(color.type).toBeNull();
});
it("creates a live text frame and keeps previously returned handles attached", () => {
  const shape = new Shape(original());
  const frame = shape.text_frame;
  expect(shape.xml.root.children.map((n) => n.name.localName)).toEqual([
    "nvSpPr",
    "spPr",
    "txBody",
    "extLst"
  ]);
  frame.text = "First";
  expect(shape.text).toBe("First");
  shape.text = "Second";
  expect(frame.text).toBe("Second");
  frame.margin_left = new Pt(5);
  expect(shape.text_frame.margin_left.emu).toBe(63500);
});
it("rejects return-only placeholder values during XML conversion", () => {
  expect(PP_PLACEHOLDER_TYPE.metadata(PP_PLACEHOLDER_TYPE.MIXED).xml_value).toBeNull();
  expect(() => PP_PLACEHOLDER_TYPE.to_xml(PP_PLACEHOLDER_TYPE.MIXED)).toThrow();
  expect(() => PP_PLACEHOLDER_TYPE.from_xml("")).toThrow();
  expect(() => PP_PLACEHOLDER_TYPE.validate(PP_PLACEHOLDER_TYPE.VERTICAL_BODY)).toThrow();
});
it("retains an existing solid theme color when selecting solid fill again", () => {
  const shape = new Shape(
    original(
      '<a:solidFill><a:schemeClr val="accent3"><a:lumMod val="85000"/></a:schemeClr></a:solidFill>'
    )
  );
  const bytes = shape.xml.bytes();
  shape.fill.solid();
  expect(shape.xml.bytes()).toEqual(bytes);
});
it("reports unsupported local color choices separately from absent fills", () => {
  const xml = original('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>');
  expect(readShape(xml.root)).toMatchObject({ fill: null, fillType: "solidFill" });
  expect(readShape(xml.root).unsupported).toContain("fill:schemeClr");
});
it("requires a shape kind before accepting creation options", () => {
  expect(() =>
    validateShapeOptions(
      { left: new Pt(0), top: new Pt(0), width: new Pt(1), height: new Pt(1) },
      true
    )
  ).toThrow();
});
it("rejects null extents while allowing line width inheritance", () => {
  expect(() => validateShapeOptions({ width: null } as never)).toThrow();
  expect(() => validateShapeOptions({ lineWidth: null })).not.toThrow();
});
it("exposes immutable documented shape category symbols", () => {
  expect(MSO_SHAPE_TYPE.AUTO_SHAPE).toBe(1);
  expect(MSO_SHAPE_TYPE.FREEFORM).toBe(5);
  expect(MSO_SHAPE_TYPE.PLACEHOLDER).toBe(14);
  expect(MSO_SHAPE_TYPE.TEXT_BOX).toBe(17);
  expect(MSO_SHAPE_TYPE.metadata(17)).toEqual({ name: "TEXT_BOX", value: 17 });
  expect(Object.isFrozen(MSO_SHAPE_TYPE)).toBe(true);
});
