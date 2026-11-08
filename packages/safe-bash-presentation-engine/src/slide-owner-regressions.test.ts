import { expect, it } from "vitest";
import { SlideShapes, SlidePlaceholders, SlidePlaceholder } from "./slide-model.js";
import { Length } from "./length.js";
import { parseXmlPart } from "./xml.js";

function fixture(content = "") {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 100000, maxNodes: 1000, maxDepth: 32 }
  );
  const owner = {
    read: () => xml,
    write: (next: typeof xml) => {
      xml = next;
    }
  };
  return { owner, shapes: new SlideShapes(owner) };
}
it("binds a connector to sibling live shape handles and keeps both ends current", () => {
  const { shapes } = fixture();
  const target = shapes.add_shape(
    "RECTANGLE",
    new Length(100),
    new Length(200),
    new Length(80),
    new Length(40)
  );
  const connector = shapes.add_connector(
    "STRAIGHT",
    new Length(0),
    new Length(0),
    new Length(10),
    new Length(10)
  );
  connector.begin_connect(target, 0);
  connector.end_connect(target, 3);
  expect([
    connector.begin_x.emu,
    connector.begin_y.emu,
    connector.end_x.emu,
    connector.end_y.emu
  ]).toEqual([140, 200, 180, 220]);
});
it("sizes inserted placeholder tables by row count rather than inherited height", () => {
  const content =
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Table slot"/><p:cNvSpPr/><p:nvPr><p:ph idx="7" type="tbl"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="800" cy="900"/></a:xfrm></p:spPr></p:sp>';
  const one = fixture(content),
    three = fixture(content);
  const first = (new SlidePlaceholders(one.owner).get(7) as SlidePlaceholder).insert_table(1, 2);
  const frame = (new SlidePlaceholders(three.owner).get(7) as SlidePlaceholder).insert_table(3, 2);
  expect([frame.left?.emu, frame.top?.emu, frame.width?.emu]).toEqual([100, 200, 800]);
  expect(frame.height?.emu).toBe(first.height!.emu * 3);
});
it("rejects connector bindings to foreign live handles with the same drawing ID", () => {
  const local = fixture(),
    foreign = fixture();
  const target = foreign.shapes.add_shape(
    "RECTANGLE",
    new Length(100),
    new Length(200),
    new Length(80),
    new Length(40)
  );
  local.shapes.add_shape(
    "RECTANGLE",
    new Length(100),
    new Length(200),
    new Length(80),
    new Length(40)
  );
  const connector = local.shapes.add_connector(
    "STRAIGHT",
    new Length(0),
    new Length(0),
    new Length(10),
    new Length(10)
  );
  const before = local.owner.read();
  expect(() => connector.begin_connect(target, 0)).toThrow();
  expect(() => connector.end_connect(target, 0)).toThrow();
  expect(local.owner.read()).toBe(before);
});
it("updates ancestor bounds when adding children to nested groups", () => {
  const { shapes } = fixture();
  const outer = shapes.add_group_shape(),
    inner = outer.shapes.add_group_shape();
  inner.shapes.add_shape(
    "RECTANGLE",
    new Length(100),
    new Length(200),
    new Length(80),
    new Length(40)
  );
  expect([outer.left?.emu, outer.top?.emu, outer.width?.emu, outer.height?.emu]).toEqual([
    100, 200, 80, 40
  ]);
});
it("preserves group rotation when child insertion recalculates its bounds", () => {
  const { shapes } = fixture();
  const group = shapes.add_group_shape();
  group.rotation = 90;
  group.shapes.add_shape(
    "RECTANGLE",
    new Length(100),
    new Length(200),
    new Length(80),
    new Length(40)
  );
  expect(group.rotation).toBe(90);
});
