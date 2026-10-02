import { expect, it } from "vitest";
import { applyDrawingUpdate, readDrawingFormat } from "./drawing-format.js";
import { FillFormat, LineFormat, Shape } from "./shapes.js";
import { parseXmlPart } from "./xml.js";

it.each([false, true])(
  "reuses drawing fills and line inspection on chart owners strict=%s",
  (strict) => {
    const a = strict
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const c = strict
      ? "http://purl.oclc.org/ooxml/drawingml/chart"
      : "http://schemas.openxmlformats.org/drawingml/2006/chart";
    let xml = parseXmlPart(
      new TextEncoder().encode(`<c:ser xmlns:c="${c}" xmlns:a="${a}"><c:spPr/></c:ser>`),
      { maxBytes: 20000, maxNodes: 300, maxDepth: 20 }
    );
    xml = applyDrawingUpdate(xml, xml.root, {
      line: { width: { value: 2, unit: "pt" }, dash: "dash" },
      fill: { kind: "solid", color: { theme: "accent2", brightness: 0.25 } },
      shadowInherit: false
    });
    const edit = (transform: (doc: typeof xml, node: typeof xml.root) => typeof xml) => {
      xml = transform(xml, xml.root);
    };
    const fill = new FillFormat(
      () => xml,
      undefined,
      false,
      edit,
      (node) => node.children[0]
    );
    expect(fill.fore_color.brightness).toBe(0.25);
    fill.gradient();
    fill.gradient_angle = 135;
    expect(fill.gradient_angle).toBe(135);
    const line = new LineFormat(
      () => xml,
      () => {
        throw new Error("unused");
      },
      edit
    );
    expect(line.width.emu).toBe(25400);
    expect(line.dash_style).toBe(4);
    expect(readDrawingFormat(xml.root).shadowInherit).toBe(false);
  }
);

it("exposes inherited gradient stop XML as an owner-bound view and compares stop identity", () => {
  const xml = parseXmlPart(
    new TextEncoder().encode(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr/></p:sp>'
    ),
    { maxBytes: 20000, maxNodes: 300, maxDepth: 20 }
  );
  const model = new Shape(xml);
  model.fill.gradient();
  const stop = model.fill.gradient_stops.at(0);
  expect(stop.equals(model.fill.gradient_stops.at(0))).toBe(true);
  expect(stop.equals(model.fill.gradient_stops.at(1))).toBe(false);
  expect(stop.equals(null)).toBe(false);
  const stops = model.fill.gradient_stops;
  expect(stops.includes(stop)).toBe(true);
  expect(stops.count(stop)).toBe(1);
  expect(stops.index(stop)).toBe(0);
  const element = stop.element;
  expect(element.tag.localName).toBe("gs");
  element.set({ namespace: "", localName: "pos" }, "25000");
  expect(stop.position).toBe(0.25);
});

it("preserves imported stop effects and foreign metadata while changing brightness and position", () => {
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}" xmlns:x="urn:retained"><p:spPr><a:gradFill><a:gsLst><a:gs pos="12345"><a:schemeClr val="accent3"><a:tint val="42000"/><a:alpha val="65000"/><a:lumMod val="75000"/><a:lumOff val="25000"/><x:payload keep="yes"/></a:schemeClr></a:gs><x:gs pos="90000"/><a:gs pos="87654"><a:srgbClr val="876543"/></a:gs></a:gsLst><a:lin ang="123000" scaled="0"/><a:tileRect l="7"/></a:gradFill><a:effectLst><a:glow rad="4"/></a:effectLst></p:spPr></p:sp>`
    ),
    { maxBytes: 20000, maxNodes: 300, maxDepth: 20 }
  );
  const model = new Shape(xml);
  const stop = model.fill.gradient_stops.at(0);
  stop.position = 0.2;
  stop.color.brightness = -0.4;
  expect(stop.color.brightness).toBe(-0.4);
  expect(stop.color.opacity).toBe(0.65);
  model.fill.gradient_angle = 77;
  const markup = model.xml.markup(model.xml.root);
  for (const retained of [
    '<a:tint val="42000"/>',
    '<x:payload keep="yes"/>',
    '<x:gs pos="90000"/>',
    '<a:tileRect l="7"/>',
    '<a:glow rad="4"/>',
    'scaled="0"'
  ])
    expect(markup).toContain(retained);
  expect(markup).not.toContain("lumOff");
  const before = model.xml.bytes();
  expect(() => {
    model.shadow.inherit = true;
  }).toThrow();
  expect(model.xml.bytes()).toEqual(before);
});

it("applies the same typed fill payload to an existing shape property container", () => {
  const xml = parseXmlPart(
    new TextEncoder().encode(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:spPr/></p:sp>'
    ),
    { maxBytes: 20000, maxNodes: 300, maxDepth: 20 }
  );
  const model = new Shape(xml);
  model.fill.apply({ kind: "solid", color: "AB1234" });
  expect(model.fill.fore_color.rgb.toString()).toBe("AB1234");
});
