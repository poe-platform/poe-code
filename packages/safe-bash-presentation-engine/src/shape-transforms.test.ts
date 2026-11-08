import { describe, expect, it } from "vitest";
import { Shape, applyShapeUpdate, readShape } from "./shapes.js";
import { Emu } from "./length.js";
import { parseXmlPart } from "./xml.js";
import { readShapeGeometry } from "./shape-transforms.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const limits = { maxBytes: 65536, maxNodes: 500, maxDepth: 32 };
const shape = (rotation = 0) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="7" name="Panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="${rotation}"><a:off x="-10" y="20"/><a:ext cx="40" cy="20"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>`;
function doc(content: string) {
  return parseXmlPart(
    new TextEncoder().encode(`<p:root xmlns:p="${p}" xmlns:a="${a}">${content}</p:root>`),
    limits
  );
}
function group(
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  childWidth: number,
  childHeight: number,
  rotation = 0,
  flip = false
) {
  return `<p:grpSp><p:grpSpPr><a:xfrm rot="${rotation}" flipH="${flip ? 1 : 0}"><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/><a:chOff x="0" y="0"/><a:chExt cx="${childWidth}" cy="${childHeight}"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`;
}
describe("shape coordinate transforms", () => {
  it("inserts a missing frame transform before its drawing payload", () => {
    const xml = doc(
      '<p:graphicFrame><p:nvGraphicFramePr/><a:graphic><a:graphicData uri="urn:original:payload"/></a:graphic><p:extLst/></p:graphicFrame>'
    );
    const changed = applyShapeUpdate(xml, xml.root.children[0]!, {
      left: new Emu(-3),
      top: new Emu(4),
      width: new Emu(5),
      height: new Emu(6)
    });
    expect(changed.root.children[0]!.children.map((x) => x.name.localName)).toEqual([
      "nvGraphicFramePr",
      "xfrm",
      "graphic",
      "extLst"
    ]);
    expect(new TextDecoder().decode(changed.bytes())).toContain(
      '<a:graphic><a:graphicData uri="urn:original:payload"/></a:graphic>'
    );
  });
  it("keeps fractional intermediate group coordinates until the final EMU conversion", () => {
    const xml = doc(group(group(shape(), 0, 0, 1, 1, 3, 3), 0, 0, 3, 3, 1, 1));
    const node = xml.root.children[0]!.children[1]!.children[1]!;
    expect(readShapeGeometry(xml.root, node)?.corners).toEqual([
      { x: -10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: -10, y: 40 }
    ]);
  });
  it("subtracts group child origins before scale and retains strict namespaces", () => {
    const content = group(shape(), -50, 10, 200, 300, 100, 100).replace(
      'a:chOff x="0" y="0"',
      'a:chOff x="10" y="20"'
    );
    const xml = parseXmlPart(
      new TextEncoder().encode(
        `<p:root xmlns:p="http://purl.oclc.org/ooxml/presentationml/main" xmlns:a="http://purl.oclc.org/ooxml/drawingml/main">${content}</p:root>`
      ),
      limits
    );
    const node = xml.root.children[0]!.children[1]!;
    expect(readShapeGeometry(xml.root, node)?.corners).toEqual([
      { x: -90, y: 10 },
      { x: -10, y: 10 },
      { x: -10, y: 70 },
      { x: -90, y: 70 }
    ]);
    const changed = applyShapeUpdate(xml, node, { flipVertical: true, left: new Emu(-10.5) });
    expect(readShape(changed.root.children[0]!.children[1]!)).toMatchObject({
      left: -11,
      flipVertical: true
    });
    expect(new TextDecoder().decode(changed.bytes())).not.toContain("schemas.openxmlformats.org");
  });
  it.each([NaN, Infinity, -Infinity, 360001, -360001, null, "90"])(
    "rejects invalid angle %s",
    (rotation) => {
      const xml = doc(shape());
      expect(() =>
        applyShapeUpdate(xml, xml.root.children[0]!, { rotation: rotation as never })
      ).toThrow();
    }
  );
  it.each(["left", "top", "width", "height"] as const)(
    "rejects out-of-range %s before mutation",
    (key) => {
      const xml = doc(shape());
      expect(() =>
        applyShapeUpdate(xml, xml.root.children[0]!, { [key]: new Emu(27273042316901) })
      ).toThrow();
    }
  );
  it("edits group placement without changing its child coordinate system", () => {
    const xml = doc(group(shape(), 30, -20, 200, 100, 100, 100));
    const changed = applyShapeUpdate(xml, xml.root.children[0]!, {
      left: new Emu(-5),
      width: new Emu(400),
      rotation: 90,
      flipVertical: true
    });
    const node = changed.root.children[0]!;
    expect(readShape(node)).toMatchObject({
      left: -5,
      top: -20,
      width: 400,
      height: 100,
      rotation: 90,
      flipVertical: true
    });
    expect(node.children[0]!.children[0]!.children[3]!.attributes.map((x) => x.value)).toEqual([
      "100",
      "100"
    ]);
    expect(new TextDecoder().decode(changed.bytes())).toContain(shape());
  });
  it.each(["pic", "cxnSp", "graphicFrame"])("edits transform-only geometry on %s", (kind) => {
    const content =
      kind === "graphicFrame"
        ? `<p:graphicFrame><p:xfrm><a:off x="3" y="-4"/><a:ext cx="10" cy="20"/></p:xfrm><a:graphic/></p:graphicFrame>`
        : `<p:${kind}><p:spPr><a:xfrm><a:off x="3" y="-4"/><a:ext cx="10" cy="20"/></a:xfrm></p:spPr></p:${kind}>`;
    const xml = doc(content),
      node = xml.root.children[0]!;
    const changed = applyShapeUpdate(xml, node, {
      top: new Emu(-9),
      rotation: 270,
      flipHorizontal: true
    });
    expect(readShape(changed.root.children[0]!)).toMatchObject({
      left: 3,
      top: -9,
      width: 10,
      height: 20,
      rotation: 270,
      flipHorizontal: true
    });
    expect(() => applyShapeUpdate(xml, node, { text: "Invalid" })).toThrow();
  });
  it("rejects singular group coordinates and missing ownership", () => {
    const xml = doc(group(shape(), 0, 0, 100, 100, 0, 100));
    expect(() => readShapeGeometry(xml.root, xml.root.children[0]!.children[1]!)).toThrow();
    expect(() => readShapeGeometry(xml.root, doc(shape()).root.children[0]!)).toThrow();
  });
  it("rotates around the box center and flips before rotation", () => {
    const xml = doc(shape(5400000));
    const node = xml.root.children[0]!;
    expect(readShapeGeometry(xml.root, node)).toEqual({
      coordinateSystem: "slide",
      unit: "emu",
      groupPath: [],
      corners: [
        { x: 20, y: 10 },
        { x: 20, y: 50 },
        { x: 0, y: 50 },
        { x: 0, y: 10 }
      ]
    });
    const changed = applyShapeUpdate(xml, node, { flipHorizontal: true });
    expect(readShapeGeometry(changed.root, changed.root.children[0]!)?.corners).toEqual([
      { x: 20, y: 50 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 50 }
    ]);
  });
  it("composes nested anisotropic scales, flips and center rotations without intermediate rounding", () => {
    const xml = doc(
      group(
        group(shape(), 30, -20, 200, 100, 100, 100, 5400000, true),
        1000,
        2000,
        300,
        600,
        300,
        300,
        10800000
      )
    );
    const outer = xml.root.children[0]!,
      inner = outer.children[1]!,
      node = inner.children[1]!;
    // Inner scaled TL=(10,0), center=(130,30); flipped TL=(250,0), rotated TL=(160,150).
    // Inner corners: (160,150),(160,70),(140,70),(140,150).
    // Outer map: (x,y) -> (1300-x,2600-2*y).
    expect(readShapeGeometry(xml.root, node)).toEqual({
      coordinateSystem: "group",
      unit: "emu",
      groupPath: [null, null],
      corners: [
        { x: 1140, y: 2300 },
        { x: 1140, y: 2460 },
        { x: 1160, y: 2460 },
        { x: 1160, y: 2300 }
      ]
    });
  });
  it.each([-0.5 / 60000, 0.5 / 60000, 359.999999, -360000, 360000])(
    "rounds signed angle %s before normalization",
    (rotation) => {
      const xml = doc(shape());
      const next = applyShapeUpdate(xml, xml.root.children[0]!, { rotation });
      const expected = rotation === -0.5 / 60000 ? 21599999 : rotation === 0.5 / 60000 ? 1 : 0;
      const transform = next.root.children[0]!.children[1]!.children[0]!;
      expect(transform.attributes.find((x) => x.name.localName === "rot")?.value).toBe(
        String(expected)
      );
    }
  );
  it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid dimension %s", (value) => {
    const xml = doc(shape());
    expect(() =>
      applyShapeUpdate(xml, xml.root.children[0]!, { width: { value, unit: "emu" } })
    ).toThrow();
  });
  it("preserves signed rounded positions and exposes neutral model flip properties", () => {
    const xml = parseXmlPart(
      new TextEncoder().encode(shape().replace("<p:sp>", `<p:sp xmlns:p="${p}" xmlns:a="${a}">`)),
      limits
    );
    const model = new Shape(xml);
    model.left = new Emu(-2.5);
    model.flip_horizontal = true;
    model.flip_vertical = true;
    model.flip_horizontal = false;
    expect(readShape(model.element)).toMatchObject({
      left: -3,
      top: 20,
      width: 40,
      height: 20,
      flipHorizontal: false,
      flipVertical: true
    });
    expect(() => {
      model.flip_vertical = "false" as never;
    }).toThrow();
  });
});
