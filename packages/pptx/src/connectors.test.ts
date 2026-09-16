import { expect, it } from "vitest";
import {
  applyConnectorUpdate,
  createConnectorXml,
  readConnector,
  MSO_CONNECTOR_TYPE,
  removeDrawingObjects
} from "./connectors.js";
import { parseXmlPart } from "./xml.js";
import { nodeFor } from "./shape-operations.js";
import { Length } from "./length.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const doc = (body: string) =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 100000, maxNodes: 3000, maxDepth: 40 }
  );
const panel = (id: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="40" cy="60"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`;
const line = () =>
  createConnectorXml(3, {
    kind: MSO_CONNECTOR_TYPE.STRAIGHT,
    beginX: new Length(10),
    beginY: new Length(20),
    endX: new Length(30),
    endY: new Length(40)
  });
it.each([MSO_CONNECTOR_TYPE.STRAIGHT, MSO_CONNECTOR_TYPE.ELBOW, MSO_CONNECTOR_TYPE.CURVE])(
  "creates declared connector kind %s",
  (kind) => {
    const x = doc(
      createConnectorXml(3, {
        kind,
        beginX: new Length(30),
        beginY: new Length(40),
        endX: new Length(10),
        endY: new Length(20)
      })
    );
    expect(readConnector(nodeFor(x.root, "3"))).toMatchObject({
      kind,
      beginX: 30,
      beginY: 40,
      endX: 10,
      endY: 20,
      beginTarget: null,
      endTarget: null
    });
  }
);
it.each(["beginX", "beginY", "endX", "endY"] as const)(
  "updates %s across the opposing endpoint",
  (key) => {
    for (const value of [-10, 20, 70]) {
      const x = doc(line());
      const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), { [key]: new Length(value) });
      expect(readConnector(nodeFor(y.root, "3"))).toMatchObject({
        beginX: 10,
        beginY: 20,
        endX: 30,
        endY: 40,
        [key]: value
      });
    }
  }
);
it.each([0, 1, 2, 3])("attaches both ends to existing cardinal site %s", (site) => {
  const x = doc(panel(1) + line());
  const y = applyConnectorUpdate(
    x,
    nodeFor(x.root, "3"),
    { site },
    { begin: nodeFor(x.root, "1"), end: nodeFor(x.root, "1") }
  );
  const coords = [
    [120, 200],
    [100, 230],
    [120, 260],
    [140, 230]
  ][site]!;
  expect(readConnector(nodeFor(y.root, "3"))).toMatchObject({
    beginX: coords[0],
    beginY: coords[1],
    endX: coords[0],
    endY: coords[1],
    beginTarget: { objectId: 1, site },
    endTarget: { objectId: 1, site }
  });
});
it("requires explicit detach/remove before deleting referenced targets", () => {
  let x = doc(panel(1) + line());
  x = applyConnectorUpdate(x, nodeFor(x.root, "3"), { site: 0 }, { begin: nodeFor(x.root, "1") });
  expect(() => removeDrawingObjects(x, ["1"])).toThrow();
  const detached = removeDrawingObjects(x, ["1"], "detach");
  expect(readConnector(nodeFor(detached.root, "3"))).toMatchObject({
    beginTarget: null,
    beginX: 120,
    beginY: 200
  });
  expect(() => nodeFor(removeDrawingObjects(x, ["1"], "remove").root, "3")).toThrow();
});
it("rejects missing sites and colliding numeric object identities", () => {
  const x = doc(panel(1) + line());
  expect(() =>
    applyConnectorUpdate(x, nodeFor(x.root, "3"), { site: 4 }, { begin: nodeFor(x.root, "1") })
  ).toThrow();
  const collision = doc(panel(1) + panel(1) + line());
  expect(() =>
    applyConnectorUpdate(
      collision,
      nodeFor(collision.root, "3"),
      { site: 0 },
      { begin: nodeFor(collision.root, "1") }
    )
  ).toThrow();
});
it("preserves unsupported connector geometry for attachment and style edits", () => {
  const x = doc(panel(1) + line().replace('prst="line"', 'prst="bentConnector5"'));
  const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), { lineColor: "123456" });
  expect(y.markup(y.root, true)).toContain('prst="bentConnector5"');
  expect(() =>
    applyConnectorUpdate(x, nodeFor(x.root, "3"), { kind: MSO_CONNECTOR_TYPE.ELBOW })
  ).toThrow();
});
it("rejects coercive length data and rotated endpoint edits", () => {
  const x = doc(line());
  for (const length of [
    { value: "1", unit: "emu" },
    { value: 1, unit: "emu", extra: 1 }
  ])
    expect(() =>
      applyConnectorUpdate(x, nodeFor(x.root, "3"), { beginX: length as never })
    ).toThrow();
  const rotated = doc(line().replace("<a:xfrm ", '<a:xfrm rot="5400000" '));
  expect(() =>
    applyConnectorUpdate(rotated, nodeFor(rotated.root, "3"), { beginX: new Length(90) })
  ).toThrow();
});
it("guards timing on connectors deleted through policy closure", () => {
  let x = doc(panel(1) + line());
  x = applyConnectorUpdate(x, nodeFor(x.root, "3"), { site: 0 }, { begin: nodeFor(x.root, "1") });
  const timed = parseXmlPart(
    new TextEncoder().encode(
      x.markup(x.root, true).replace("</p:sld>", '<p:timing><p:spTgt spid="3"/></p:timing></p:sld>')
    ),
    { maxBytes: 100000, maxNodes: 3000, maxDepth: 40 }
  );
  expect(() => removeDrawingObjects(timed, ["1"], "remove")).toThrow();
});
it("replaces competing line color choices while retaining line ends", () => {
  const x = doc(
    line().replace(
      "</p:spPr>",
      '<a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:headEnd type="triangle"/></a:ln></p:spPr>'
    )
  );
  const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), { lineColor: "ABCDEF" });
  const xml = y.markup(y.root, true);
  expect(xml).toContain('val="ABCDEF"');
  expect(xml).toContain('type="triangle"');
  expect(xml).not.toContain("schemeClr");
});
it("rejects missing coordinate geometry and malformed attachment identities", () => {
  for (const source of [
    line().replace('<a:off x="10" y="20"/>', ""),
    line().replace("<p:cNvCxnSpPr/>", '<p:cNvCxnSpPr><a:stCxn id="0" idx="-1"/></p:cNvCxnSpPr>')
  ]) {
    const x = doc(source);
    expect(() => readConnector(nodeFor(x.root, "3"))).toThrow();
  }
});
it("resolves numeric object identities independently of their XML lexical spelling", () => {
  const x = doc(panel(1).replace('id="1"', 'id="001"') + line());
  expect(readConnector(nodeFor(x.root, "003"))).toMatchObject({ shapeId: 3 });
  expect(nodeFor(x.root, "1").name.localName).toBe("sp");
});
it("retains zero-valued tree identity and recognizes alternate straight geometry", () => {
  const x = doc(
    '<p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      line().replace('prst="line"', 'prst="straightConnector1"')
  );
  expect(readConnector(nodeFor(x.root, "3")).kind).toBe(1);
  const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), { lineColor: "000000" });
  expect(y.markup(y.root, true)).toContain('prst="straightConnector1"');
});
it("exposes immutable connector enum conversions and rejects mixed writes", () => {
  expect(MSO_CONNECTOR_TYPE.from_xml("line")).toBe(1);
  expect(MSO_CONNECTOR_TYPE.to_xml(2)).toBe("bentConnector3");
  expect(MSO_CONNECTOR_TYPE.metadata(3)).toEqual({
    name: "CURVE",
    value: 3,
    xml_value: "curvedConnector3"
  });
  expect(Object.isFrozen(MSO_CONNECTOR_TYPE)).toBe(true);
  expect(() => MSO_CONNECTOR_TYPE.validate(-2)).toThrow();
});
it("rejects removal closure with relationship-bearing or indirectly timed connectors", () => {
  const attached = line().replace(
    "<p:cNvCxnSpPr/>",
    '<p:cNvCxnSpPr><a:stCxn id="1" idx="0"/></p:cNvCxnSpPr>'
  );
  const linked = doc(
    panel(1) +
      attached.replace(
        'name="Connector 3"/>',
        'name="Connector 3"><a:hlinkClick xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId9"/></p:cNvPr>'
      )
  );
  expect(() => removeDrawingObjects(linked, ["1"], "remove")).toThrow();
  const chained = line()
    .replaceAll('id="3"', 'id="4"')
    .replace("<p:cNvCxnSpPr/>", '<p:cNvCxnSpPr><a:stCxn id="3" idx="0"/></p:cNvCxnSpPr>');
  const x = doc(panel(1) + chained + attached);
  const timed = parseXmlPart(
    new TextEncoder().encode(
      x.markup(x.root, true).replace("</p:sld>", '<p:timing><p:spTgt spid="4"/></p:timing></p:sld>')
    ),
    { maxBytes: 100000, maxNodes: 3000, maxDepth: 40 }
  );
  expect(() => removeDrawingObjects(timed, ["1"], "remove")).toThrow();
});
it("requires drawing context for attached creation and validates XML identity inputs", () => {
  const update = {
    kind: 1 as const,
    beginX: new Length(0),
    beginY: new Length(0),
    endX: new Length(1),
    endY: new Length(1)
  };
  expect(() =>
    createConnectorXml(1, {
      ...update,
      beginTarget: {
        fingerprint: "x",
        scope: "slides",
        owner: "/slide",
        objectId: "2",
        coordinateSystem: "identity"
      },
      site: 0
    })
  ).toThrow();
  expect(() => createConnectorXml('1" malformed="true' as never, update)).toThrow();
  expect(() => createConnectorXml(1, update, "urn:other")).toThrow();
});
it("sets and clears explicit line widths while preserving dash and arrow metadata", () => {
  const x = doc(
    line().replace(
      "</p:spPr>",
      '<a:ln><a:prstDash val="dash"/><a:headEnd type="triangle"/></a:ln></p:spPr>'
    )
  );
  const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), {
    lineWidth: { value: 2, unit: "pt" },
    lineColor: "123456"
  });
  expect(y.markup(y.root, true)).toContain('w="25400"');
  expect(y.markup(y.root, true)).toContain('val="dash"');
  const z = applyConnectorUpdate(y, nodeFor(y.root, "3"), { lineWidth: null });
  expect(z.markup(z.root, true)).not.toContain('w="25400"');
  expect(() =>
    applyConnectorUpdate(x, nodeFor(x.root, "3"), { lineWidth: new Length(-1) })
  ).toThrow();
});
it("selects solid line fill without replacing existing color and updates connector names", () => {
  const x = doc(
    line().replace(
      "</p:spPr>",
      '<a:ln><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln></p:spPr>'
    )
  );
  const y = applyConnectorUpdate(x, nodeFor(x.root, "3"), {
    lineColor: "solid",
    name: 'Route & "A"'
  });
  expect(y.markup(y.root, true)).toContain('val="accent2"');
  expect(readConnector(nodeFor(y.root, "3")).name).toBe('Route & "A"');
});
it("rejects unresolved attachment locations in structured connector edits", () => {
  const x = doc(line());
  expect(() =>
    applyConnectorUpdate(x, nodeFor(x.root, "3"), {
      beginTarget: {
        fingerprint: "x",
        scope: "slides",
        owner: "/slide",
        objectId: "2",
        coordinateSystem: "identity"
      }
    })
  ).toThrow();
});
