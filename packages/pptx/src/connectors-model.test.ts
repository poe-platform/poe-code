import { expect, it } from "vitest";
import { Connector } from "./connectors-model.js";
import { createConnectorXml } from "./connectors.js";
import { Emu } from "./length.js";
import { parseXmlPart } from "./xml.js";

function drawing() {
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Target"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="80" cy="40"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>${createConnectorXml(3, { kind: "STRAIGHT", beginX: new Emu(10), beginY: new Emu(20), endX: new Emu(70), endY: new Emu(80) })}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 10000, maxNodes: 200, maxDepth: 20 }
  );
}

it("retains neutral connector coordinates and inherited geometry in an owned XML view", () => {
  const connector = new Connector(drawing(), 3);
  expect([
    connector.begin_x.emu,
    connector.begin_y.emu,
    connector.end_x.emu,
    connector.end_y.emu
  ]).toEqual([10, 20, 70, 80]);
  connector.begin_x = new Emu(90);
  expect([
    connector.begin_x.emu,
    connector.end_x.emu,
    connector.left.emu,
    connector.width.emu
  ]).toEqual([90, 70, 70, 20]);
  connector.top = new Emu(30);
  expect(connector.begin_y.emu).toBe(30);
  expect(connector.shape_id).toBe(3);
  expect(connector.shape_type).toBe(9);
  expect(connector.has_text_frame).toBe(false);
  connector.width = new Emu(0);
  connector.height = new Emu(0);
  expect([
    connector.begin_x.emu,
    connector.end_x.emu,
    connector.begin_y.emu,
    connector.end_y.emu
  ]).toEqual([70, 70, 30, 30]);
});

it("connects both ends to valid sites and rejects foreign or stale target views", () => {
  const connector = new Connector(drawing(), 3);
  const target = connector.xml.root.children[0]!.children[0]!.children[0]!;
  connector.begin_connect({ element: target }, 3);
  expect([connector.begin_x.emu, connector.begin_y.emu]).toEqual([180, 220]);
  expect(connector.xml.markup(connector.element)).toContain('id="2" idx="3"');
  expect(() => connector.end_connect({ element: target }, 0)).toThrow();
  const refreshed = connector.xml.root.children[0]!.children[0]!.children[0]!;
  connector.end_connect({ element: refreshed }, 0);
  expect([connector.end_x.emu, connector.end_y.emu]).toEqual([140, 200]);
  expect(() =>
    connector.begin_connect({ element: drawing().root.children[0]!.children[0]!.children[0]! }, 0)
  ).toThrow();
  expect(() =>
    connector.end_connect({ element: connector.xml.root.children[0]!.children[0]!.children[0]! }, 4)
  ).toThrow();
});

it("retains a live line format and mutable connector name in drawing XML", () => {
  const connector = new Connector(drawing(), 3);
  connector.name = "Flow";
  const line = connector.line;
  line.width = new Emu(91440);
  expect(connector.name).toBe("Flow");
  expect(line.width.emu).toBe(91440);
  expect(connector.xml.markup(connector.element)).toContain('w="91440"');
  line.width = null;
  expect(line.width.emu).toBe(0);
});
