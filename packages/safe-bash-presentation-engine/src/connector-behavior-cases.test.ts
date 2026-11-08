import { expect, it } from "vitest";
import {
  applyConnectorUpdate,
  createConnectorXml,
  readConnector,
  MSO_CONNECTOR_TYPE,
  MSO_CONNECTOR
} from "./connectors.js";
import { Connector } from "./connectors-model.js";
import { Emu } from "./length.js";
import { parseXmlPart, type XmlElement } from "./xml.js";
import { nodeFor } from "./shape-operations.js";

const modelCoordinates = {
  beginX: "begin_x",
  beginY: "begin_y",
  endX: "end_x",
  endY: "end_y"
} as const;

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
function drawing(body: string) {
  return parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 50000, maxNodes: 1000, maxDepth: 30 }
  );
}
function connector(
  x: number,
  y: number,
  width: number,
  height: number,
  flipH = false,
  flipV = false,
  connections = ""
) {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="71" name="Route"/><p:cNvCxnSpPr>${connections}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipH="${Number(flipH)}" flipV="${Number(flipV)}"><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`;
}
function attributes(node: XmlElement) {
  return Object.fromEntries(
    node.attributes.map((attribute) => [attribute.name.localName, attribute.value])
  );
}

it.each([
  ["beginX", 42, 6, 24, 32, false, false, 42],
  ["beginX", 24, 6, 42, 32, true, false, 66],
  ["beginY", 6, 40, 32, 60, false, false, 40],
  ["beginY", 6, 50, 32, 42, false, true, 92],
  ["endX", 21, 6, 32, 60, false, false, 53],
  ["endX", 43, 6, 54, 60, true, false, 43],
  ["endY", 6, 31, 32, 42, false, false, 73],
  ["endY", 6, 53, 32, 14, false, true, 53]
] as const)(
  "reads %s from box %s,%s,%s,%s with flips %s,%s",
  (key, x, y, width, height, flipH, flipV, expected) => {
    const xml = drawing(connector(x, y, width, height, flipH, flipV));
    expect(readConnector(nodeFor(xml.root, "71"))[key]).toBe(expected);
    expect(new Connector(xml, 71)[modelCoordinates[key]].emu).toBe(expected);
  }
);

it.each([
  ["beginX", false, 5, 5, 15, false],
  ["beginX", false, 15, 15, 5, false],
  ["beginX", false, 25, 20, 5, true],
  ["beginX", true, 25, 10, 15, true],
  ["beginX", true, 15, 10, 5, true],
  ["beginX", true, 5, 5, 5, false],
  ["beginY", false, 5, 5, 15, false],
  ["beginY", false, 15, 15, 5, false],
  ["beginY", false, 25, 20, 5, true],
  ["beginY", true, 30, 10, 20, true],
  ["beginY", true, 15, 10, 5, true],
  ["beginY", true, 5, 5, 5, false],
  ["endX", false, 32, 10, 22, false],
  ["endX", false, 15, 10, 5, false],
  ["endX", false, 5, 5, 5, true],
  ["endX", true, 5, 5, 15, true],
  ["endX", true, 15, 15, 5, true],
  ["endX", true, 28, 20, 8, false],
  ["endY", false, 28, 10, 18, false],
  ["endY", false, 13, 10, 3, false],
  ["endY", false, 4, 4, 6, true],
  ["endY", true, 6, 6, 14, true],
  ["endY", true, 12, 12, 8, true],
  ["endY", true, 27, 20, 7, false]
] as const)(
  "serializes %s with prior flip %s assigned %s",
  (key, flipped, value, offset, extent, nextFlip) => {
    const horizontal = key.endsWith("X");
    const xml = drawing(
      connector(
        horizontal ? 10 : 1,
        horizontal ? 1 : 10,
        horizontal ? 10 : 1,
        horizontal ? 1 : 10,
        horizontal && flipped,
        !horizontal && flipped
      )
    );
    const model = new Connector(xml, 71);
    model[modelCoordinates[key]] = new Emu(value);
    const result = model.xml;
    const props = nodeFor(result.root, "71").children[1]!;
    const transform = props.children[0]!;
    expect(attributes(transform)).toEqual({
      flipH: String(Number(horizontal && nextFlip)),
      flipV: String(Number(!horizontal && nextFlip))
    });
    expect(attributes(transform.children[0]!)).toEqual(
      horizontal ? { x: String(offset), y: "1" } : { x: "1", y: String(offset) }
    );
    expect(attributes(transform.children[1]!)).toEqual(
      horizontal ? { cx: String(extent), cy: "1" } : { cx: "1", cy: String(extent) }
    );
    expect(result.markup(props.children[1]!)).toBe(
      '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
    );
  }
);

it.each([
  [1, 2, 3, 5, 1, 2, 2, 3, "0", "0"],
  [8, 3, 4, 9, 4, 3, 4, 6, "1", "0"],
  [1, 6, 5, 2, 1, 2, 4, 4, "0", "1"],
  [9, 8, 2, 3, 2, 3, 7, 5, "1", "1"]
] as const)(
  "creates independent endpoint quadrant %s,%s to %s,%s",
  (bx, by, ex, ey, x, y, width, height, h, v) => {
    const xml = drawing(
      createConnectorXml(71, {
        kind: "STRAIGHT",
        beginX: new Emu(bx),
        beginY: new Emu(by),
        endX: new Emu(ex),
        endY: new Emu(ey)
      })
    );
    const node = nodeFor(xml.root, "71");
    const transform = node.children[1]!.children[0]!;
    expect(attributes(transform)).toEqual({ flipH: h, flipV: v });
    expect(attributes(transform.children[0]!)).toEqual({ x: String(x), y: String(y) });
    expect(attributes(transform.children[1]!)).toEqual({ cx: String(width), cy: String(height) });
    expect(attributes(node.children[0]!.children[0]!)).toMatchObject({ id: "71" });
  }
);

function picture(id: number) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Tile"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
it.each(["begin", "end"] as const)(
  "attaches and rebinds the %s endpoint to a picture site",
  (end) => {
    const xml = drawing(picture(19) + picture(23) + connector(100, 200, 300, 400));
    const first = applyConnectorUpdate(
      xml,
      nodeFor(xml.root, "71"),
      { site: 3 },
      { [end]: nodeFor(xml.root, "19") }
    );
    const second = applyConnectorUpdate(
      first,
      nodeFor(first.root, "71"),
      { site: 3 },
      { [end]: nodeFor(first.root, "23") }
    );
    for (const [document, id] of [
      [first, "19"],
      [second, "23"]
    ] as const) {
      const node = nodeFor(document.root, "71");
      expect(
        node.children[0]!.children[1]!.children.map((entry) => ({
          name: entry.name.localName,
          attributes: attributes(entry)
        }))
      ).toEqual([{ name: end === "begin" ? "stCxn" : "endCxn", attributes: { id, idx: "3" } }]);
      expect(readConnector(node)).toMatchObject(
        end === "begin"
          ? { beginX: 914400, beginY: 457200, endX: 400, endY: 600 }
          : { beginX: 100, beginY: 200, endX: 914400, endY: 457200 }
      );
    }
  }
);

it.each([
  ["beginX", 914400, 914400, 1828800],
  ["beginY", 914400, 914400, 1828800],
  ["endX", 1828800, 1828800, 914400],
  ["endY", 1828800, 1828800, 914400]
] as const)("round trips whole-inch %s assignment", (key, x, y, value) => {
  const xml = drawing(connector(x, y, 0, 0));
  expect(readConnector(nodeFor(xml.root, "71"))).toMatchObject({
    beginX: x,
    beginY: y,
    endX: x,
    endY: y
  });
  const result = applyConnectorUpdate(xml, nodeFor(xml.root, "71"), { [key]: new Emu(value) });
  const reopened = parseXmlPart(result.bytes(), { maxBytes: 50000, maxNodes: 1000, maxDepth: 30 });
  expect(readConnector(nodeFor(reopened.root, "71"))[key]).toBe(value);
});

it("rounds a grouped connection site after projecting its midpoint", () => {
  const target =
    '<p:sp><p:nvSpPr><p:cNvPr id="23" name="Marker"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="2"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>';
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="18" name="Grid"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6" cy="6"/><a:chOff x="0" y="0"/><a:chExt cx="10" cy="10"/></a:xfrm></p:grpSpPr>${target}</p:grpSp>`;
  const xml = drawing(group + connector(4, 5, 6, 7));
  const result = applyConnectorUpdate(
    xml,
    nodeFor(xml.root, "71"),
    { site: 0 },
    { begin: nodeFor(xml.root, "23") }
  );
  const transform = nodeFor(result.root, "71").children[1]!.children[0]!;
  expect(attributes(transform.children[0]!)).toEqual({ x: "0", y: "0" });
  expect(attributes(transform.children[1]!)).toEqual({ cx: "10", cy: "12" });
});

it.each([
  ["begin", 0, 25, 15, 74, 123],
  ["begin", 1, 10, 33, 89, 105],
  ["begin", 2, 25, 51, 74, 87],
  ["begin", 3, 40, 33, 59, 105],
  ["end", 0, 10, 15, 50, 10],
  ["end", 1, 10, 15, 40, 19],
  ["end", 2, 10, 15, 50, 28],
  ["end", 3, 10, 15, 60, 19]
] as const)("serializes %s attachment at cardinal site %s", (end, site, x, y, width, height) => {
  const targetBox =
    end === "begin"
      ? '<a:off x="10" y="15"/><a:ext cx="30" cy="36"/>'
      : '<a:off x="50" y="25"/><a:ext cx="20" cy="18"/>';
  const target = `<p:sp><p:nvSpPr><p:cNvPr id="23" name="Marker"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm>${targetBox}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
  const xml = drawing(
    target + (end === "begin" ? connector(66, 99, 33, 39) : connector(10, 15, 10, 5))
  );
  const result = applyConnectorUpdate(
    xml,
    nodeFor(xml.root, "71"),
    { site },
    { [end]: nodeFor(xml.root, "23") }
  );
  const node = nodeFor(result.root, "71");
  expect(attributes(node.children[0]!.children[1]!.children[0]!)).toEqual({
    id: "23",
    idx: String(site)
  });
  const transform = node.children[1]!.children[0]!;
  expect(attributes(transform.children[0]!)).toEqual({ x: String(x), y: String(y) });
  expect(attributes(transform.children[1]!)).toEqual({ cx: String(width), cy: String(height) });
});

it("keeps an alternate straight preset byte-identical during line coloring", () => {
  const xml = drawing(
    connector(13, 27, 84, 96).replace('prst="line"', 'prst="straightConnector1"')
  );
  const before = nodeFor(xml.root, "71").children[1]!.children[1]!;
  const result = applyConnectorUpdate(xml, nodeFor(xml.root, "71"), { lineColor: "2563EB" });
  const after = nodeFor(result.root, "71").children[1]!.children[1]!;
  expect(result.markup(after)).toBe(xml.markup(before));
  expect(result.markup(after)).toBe(
    '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>'
  );
});

it.each([
  ["STRAIGHT", 1, "line"],
  ["ELBOW", 2, "bentConnector3"],
  ["CURVE", 3, "curvedConnector3"],
  ["MIXED", -2, null]
] as const)("keeps connector enum %s metadata and conversion boundaries", (name, value, xml) => {
  expect(MSO_CONNECTOR).toBe(MSO_CONNECTOR_TYPE);
  expect(MSO_CONNECTOR_TYPE[name]).toBe(value);
  const metadata = MSO_CONNECTOR_TYPE.metadata(value);
  expect(metadata).toEqual({ name, value, xml_value: xml });
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(() => Object.assign(metadata, { xml_value: "changed" })).toThrow(TypeError);
  if (xml === null) {
    expect(() => MSO_CONNECTOR_TYPE.to_xml(value)).toThrow();
    expect(() => MSO_CONNECTOR_TYPE.validate(value)).toThrow();
  } else {
    expect(MSO_CONNECTOR_TYPE.from_xml(xml)).toBe(value);
    expect(MSO_CONNECTOR_TYPE.to_xml(value)).toBe(xml);
    expect(MSO_CONNECTOR_TYPE.validate(value)).toBeUndefined();
  }
});

it("reads connector identity and inherited shape flags from an owned view", () => {
  const model = new Connector(drawing(connector(123, 456, 78, 90)), 71);
  expect(model.name).toBe("Route");
  expect(model.shape_id).toBe(71);
  expect(model.shape_type).toBe(9);
  expect(model.has_chart).toBe(false);
  expect(model.has_table).toBe(false);
  expect(model.has_text_frame).toBe(false);
  expect(model.is_placeholder).toBe(false);
  expect([
    model.left.emu,
    model.top.emu,
    model.width.emu,
    model.height.emu,
    model.rotation
  ]).toEqual([123, 456, 78, 90, 0]);
});

it.each(["begin", "end"] as const)(
  "binds the neutral %s method to the one-inch picture midpoint",
  (end) => {
    const model = new Connector(drawing(picture(19) + connector(100, 200, 300, 400)), 71);
    model[end === "begin" ? "begin_connect" : "end_connect"](
      { element: nodeFor(model.xml.root, "19") },
      3
    );
    expect([
      model[end === "begin" ? "begin_x" : "end_x"].emu,
      model[end === "begin" ? "begin_y" : "end_y"].emu
    ]).toEqual([914400, 457200]);
  }
);
