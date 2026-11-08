import { describe, expect, it } from "vitest";
import {
  applyShapePath,
  readShapePath,
  validateShapePath,
  pathFromVertices,
  shapePathXml,
  type ShapePath
} from "./shape-paths.js";
import { parseXmlPart } from "./xml.js";
const path: ShapePath = {
  unit: "emu",
  width: 100,
  height: 80,
  commands: [
    { type: "move", x: 0, y: 0 },
    { type: "line", x: 100, y: 0 },
    { type: "quadratic", cx: 110, cy: 40, x: 100, y: 80 },
    { type: "cubic", cx1: 70, cy1: 90, cx2: 20, cy2: 90, x: 0, y: 80 },
    { type: "close" }
  ]
};
const xml = (geometry: string) =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr>${geometry}<a:solidFill><a:srgbClr val="123456"/></a:solidFill></p:spPr></p:sp>`
    ),
    { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 }
  );
const base =
  '<a:custGeom><a:pathLst><a:path w="100" h="80"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="80"/></a:lnTo></a:path></a:pathLst></a:custGeom>';
describe("bounded shape paths", () => {
  it("serializes explicit curve controls and closure independently", () => {
    const doc = xml(base);
    const updated = applyShapePath(doc, doc.root, path);
    const text = new TextDecoder().decode(updated.bytes());
    expect(text).toContain(
      '<a:quadBezTo><a:pt x="110" y="40"/><a:pt x="100" y="80"/></a:quadBezTo>'
    );
    expect(text).toContain(
      '<a:cubicBezTo><a:pt x="70" y="90"/><a:pt x="20" y="90"/><a:pt x="0" y="80"/></a:cubicBezTo><a:close/>'
    );
    expect(text).toContain('<a:solidFill><a:srgbClr val="123456"/></a:solidFill>');
    expect(readShapePath(updated, updated.root).path).toEqual(path);
  });
  it.each([
    null,
    {},
    { ...path, unit: "pt" },
    { ...path, width: 0 },
    { ...path, commands: [] },
    { ...path, commands: [{ type: "line", x: 0, y: 0 }] },
    { ...path, commands: [{ type: "move", x: 0, y: 0 }, { type: "close" }] },
    {
      ...path,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "line", x: Infinity, y: 0 }
      ]
    },
    {
      ...path,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "line", x: "w", y: 0 }
      ]
    },
    {
      ...path,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "arc", x: 1, y: 1 }
      ]
    },
    {
      ...path,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "line", x: 1, y: 1 },
        { type: "close" },
        { type: "line", x: 2, y: 2 }
      ]
    }
  ])("rejects malformed commands before edits %#", (value) => {
    expect(() => validateShapePath(value as never)).toThrow();
  });
  it("rejects accessors without evaluating them and rejects sparse commands", () => {
    let called = false;
    const value = { ...path };
    Object.defineProperty(value, "unit", {
      enumerable: true,
      get() {
        called = true;
        return "emu";
      }
    });
    expect(() => validateShapePath(value)).toThrow();
    expect(called).toBe(false);
    expect(() => validateShapePath({ ...path, commands: new Array(3) })).toThrow();
  });
  it("preserves arbitrary formulas and rejects replacing them", () => {
    const geometry = base.replace(
      "<a:pathLst>",
      '<a:gdLst><a:gd name="bend" fmla="*/ w 1 2"/></a:gdLst><a:pathLst>'
    );
    const doc = xml(geometry);
    expect(readShapePath(doc, doc.root)).toMatchObject({ path: null, xml: geometry });
    expect(() => applyShapePath(doc, doc.root, path)).toThrow(
      expect.objectContaining({ code: "unsupported-edit" })
    );
    expect(new TextDecoder().decode(doc.bytes())).toContain(geometry);
  });
  it("keeps winding and explicit open subpaths in input order", () => {
    const commands = [
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 0, y: 80 },
      { type: "line", x: 100, y: 80 },
      { type: "line", x: 100, y: 0 },
      { type: "close" },
      { type: "move", x: 10, y: 10 },
      { type: "line", x: 90, y: 10 }
    ] as const;
    const doc = xml(base);
    const updated = applyShapePath(doc, doc.root, { ...path, commands });
    expect(readShapePath(updated, updated.root).path?.commands).toEqual(commands);
  });
  it("bounds command count and coordinate magnitudes without clamping", () => {
    for (const x of [2147483648, -2147483648, 0.5, NaN])
      expect(() =>
        validateShapePath({
          ...path,
          commands: [
            { type: "move", x: 0, y: 0 },
            { type: "line", x, y: 0 }
          ]
        })
      ).toThrow();
    expect(() =>
      validateShapePath({
        ...path,
        commands: Array.from({ length: 4097 }, () => ({ type: "move", x: 0, y: 0 }))
      })
    ).toThrow();
  });
  it("adapts explicit vertex polygons without inventing a closing segment", () => {
    expect(
      pathFromVertices(
        [
          [0, 0],
          [100, 0],
          [0, 80]
        ],
        true
      ).commands
    ).toEqual([
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 100, y: 0 },
      { type: "line", x: 0, y: 80 },
      { type: "close" }
    ]);
    expect(() =>
      pathFromVertices(
        [
          [0, 0],
          [100, 0]
        ],
        true
      )
    ).toThrow();
  });
});

it.each([
  base.replace(
    '<a:lnTo><a:pt x="100" y="80"/></a:lnTo>',
    '<a:arcTo wR="10" hR="10" stAng="0" swAng="5400000"/>'
  ),
  base.replace('x="100" y="80"', 'x="w" y="80"'),
  base.replace("<a:pathLst>", '<a:avLst><a:gd name="offset" fmla="val 9"/></a:avLst><a:pathLst>'),
  base.replace("<a:custGeom>", '<a:custGeom xmlns:v="urn:custom-shape" v:hint="retain" >'),
  base.replace(
    "</a:pathLst>",
    '<a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo></a:path></a:pathLst>'
  ),
  base.replace(
    '<a:lnTo><a:pt x="100" y="80"/></a:lnTo>',
    '<a:quadBezTo><a:pt x="100" y="80"/></a:quadBezTo>'
  ),
  base.replace(
    '<a:lnTo><a:pt x="100" y="80"/></a:lnTo>',
    '<a:cubicBezTo><a:pt x="20" y="30"/><a:pt x="100" y="80"/></a:cubicBezTo>'
  )
])("retains unsupported existing geometry exactly and refuses edits %#", (geometry) => {
  const document = xml(geometry);
  const original = document.bytes();
  expect(readShapePath(document, document.root)).toEqual({
    path: null,
    xml: geometry,
    unsupported: true
  });
  expect(() => applyShapePath(document, document.root, path)).toThrow(
    expect.objectContaining({ code: "unsupported-edit" })
  );
  expect(document.bytes()).toEqual(original);
});
it("retains strict drawing namespaces when serializing curve geometry", () => {
  const document = parseXmlPart(
    new TextEncoder().encode(
      `<p:sp xmlns:p="http://purl.oclc.org/ooxml/presentationml/main" xmlns:a="http://purl.oclc.org/ooxml/drawingml/main"><p:spPr>${base}</p:spPr></p:sp>`
    ),
    { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 }
  );
  const result = applyShapePath(document, document.root, path);
  const markup = new TextDecoder().decode(result.bytes());
  expect(markup).toContain('<a:custGeom xmlns:a="http://purl.oclc.org/ooxml/drawingml/main">');
  expect(markup).toContain(
    '<a:quadBezTo><a:pt x="110" y="40"/><a:pt x="100" y="80"/></a:quadBezTo>'
  );
  expect(markup).not.toContain("schemas.openxmlformats.org");
  const geometry = result.root.children[0]!.children[0]!;
  expect(geometry.name).toEqual({
    namespace: "http://purl.oclc.org/ooxml/drawingml/main",
    localName: "custGeom"
  });
});
it("refuses to replace preset geometry with a custom path", () => {
  const document = xml('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
  const original = document.bytes();
  expect(() => applyShapePath(document, document.root, path)).toThrow(
    expect.objectContaining({ code: "unsupported-edit" })
  );
  expect(document.bytes()).toEqual(original);
});
it("accepts inclusive coordinate and command count bounds", () => {
  const commands = [
    { type: "move", x: -2147483647, y: 2147483647 },
    ...Array.from({ length: 4095 }, () => ({ type: "line", x: 2147483647, y: -2147483647 }))
  ] as ShapePath["commands"];
  const value: ShapePath = { unit: "emu", width: 2147483647, height: 2147483647, commands };
  expect(() => validateShapePath(value)).not.toThrow();
  const markup = shapePathXml(value, "http://schemas.openxmlformats.org/drawingml/2006/main");
  expect(markup).toContain(
    '<a:path w="2147483647" h="2147483647"><a:moveTo><a:pt x="-2147483647" y="2147483647"/></a:moveTo>'
  );
  expect(markup.split('<a:lnTo><a:pt x="2147483647" y="-2147483647"/></a:lnTo>')).toHaveLength(
    4096
  );
});
it.each(["pic", "cxnSp"])("inspects custom geometry on %s without allowing edits", (kind) => {
  const document = parseXmlPart(
    new TextEncoder().encode(
      `<p:${kind} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr>${base}</p:spPr></p:${kind}>`
    ),
    { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 }
  );
  expect(readShapePath(document, document.root)).toEqual({
    path: null,
    xml: base,
    unsupported: true
  });
  expect(() => applyShapePath(document, document.root, path)).toThrow(
    expect.objectContaining({ code: "unsupported-edit" })
  );
  expect(new TextDecoder().decode(document.bytes())).toContain(base);
});
