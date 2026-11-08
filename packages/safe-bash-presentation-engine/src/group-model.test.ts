import { expect, it } from "vitest";
import { Shape } from "./shapes.js";
import { Emu } from "./length.js";
import { parseXmlPart } from "./xml.js";

function groupXml() {
  return parseXmlPart(
    new TextEncoder().encode(
      '<p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGrpSpPr><p:cNvPr id="5" name="Assembly"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="100" cy="200"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="200"/></a:xfrm></p:grpSpPr></p:grpSp>'
    ),
    { maxBytes: 10000, maxNodes: 100, maxDepth: 20 }
  );
}

it("keeps inherited shape mutations on the current owner", () => {
  let xml = groupXml();
  const owner = {
    read: () => xml,
    write: (value: typeof xml) => {
      xml = value;
    }
  };
  const first = new Shape(xml, owner),
    second = new Shape(xml, owner);
  first.name = "Changed assembly";
  second.left = new Emu(30);
  expect(first.left?.emu).toBe(30);
  expect(second.name).toBe("Changed assembly");
});

it("exposes stable group children and inherited geometry without a text or click target", async () => {
  const { GroupShape } = await import("./group-model.js");
  const children = { length: 0 };
  const group = new GroupShape(groupXml(), children);
  expect(group.shapes).toBe(children);
  expect(group.shapes).toBe(group.shapes);
  expect(group.shape_type).toBe(6);
  expect(group.shape_id).toBe(5);
  expect(group.name).toBe("Assembly");
  expect(group.has_text_frame).toBe(false);
  expect(group.has_chart).toBe(false);
  expect(group.has_table).toBe(false);
  expect(group.is_placeholder).toBe(false);
  expect(() => group.placeholder_format).toThrow();
  expect(() => group.click_action).toThrow();
  expect(() => group.text_frame).toThrow();
  group.left = new Emu(40);
  group.top = new Emu(50);
  group.width = new Emu(60);
  group.height = new Emu(70);
  group.rotation = 25;
  expect([
    group.left?.emu,
    group.top?.emu,
    group.width?.emu,
    group.height?.emu,
    group.rotation
  ]).toEqual([40, 50, 60, 70, 25]);
  expect(group.element).toBe(group.xml.root);
  const shadow = group.shadow;
  expect(shadow.inherit).toBe(true);
  shadow.inherit = false;
  expect(shadow.inherit).toBe(false);
});

it("updates nonvisual group metadata and rejects an invalid constructor root", async () => {
  const { GroupShape } = await import("./group-model.js");
  const group = new GroupShape(groupXml(), []);
  group.title = "Overview";
  group.description = "Three stages";
  expect(group.title).toBe("Overview");
  expect(group.description).toBe("Three stages");
  group.title = null;
  group.description = null;
  expect(group.title).toBeNull();
  expect(group.description).toBeNull();
  expect(() => new GroupShape(group.xml.subtree(group.element.children[0]!), [])).toThrow();
});
