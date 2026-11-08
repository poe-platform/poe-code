import { expect, it } from "vitest";
import { applyShapePath, pathFromVertices, shapePathXml } from "./shape-paths.js";
import { parseXmlPart } from "./xml.js";

it.each([true, false])(
  "retains each vertex and applies closure only when requested %s",
  (close) => {
    const path = pathFromVertices(
      [
        [0, 0],
        [1, 2],
        [3, 4],
        [5, 6]
      ],
      close
    );
    expect(path.commands).toEqual([
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 1, y: 2 },
      { type: "line", x: 3, y: 4 },
      { type: "line", x: 5, y: 6 },
      ...(close ? [{ type: "close" }] : [])
    ]);
  }
);

it("distinguishes a repeated endpoint from explicit closure", () => {
  const path = pathFromVertices(
    [
      [0, 0],
      [9, 0],
      [9, 8],
      [0, 0]
    ],
    false
  );
  const markup = shapePathXml(path, "http://schemas.openxmlformats.org/drawingml/2006/main");
  expect(markup).toContain('<a:lnTo><a:pt x="0" y="0"/></a:lnTo></a:path>');
  expect(markup).not.toContain("<a:close");
});

it("writes opposite contour directions without normalizing winding", () => {
  const markup = shapePathXml(
    {
      unit: "emu",
      width: 12,
      height: 12,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "line", x: 12, y: 0 },
        { type: "line", x: 12, y: 12 },
        { type: "line", x: 0, y: 12 },
        { type: "close" },
        { type: "move", x: 3, y: 3 },
        { type: "line", x: 3, y: 9 },
        { type: "line", x: 9, y: 9 },
        { type: "line", x: 9, y: 3 },
        { type: "close" }
      ]
    },
    "http://schemas.openxmlformats.org/drawingml/2006/main"
  );
  expect(markup).toContain(
    '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="12" y="0"/></a:lnTo><a:lnTo><a:pt x="12" y="12"/></a:lnTo><a:lnTo><a:pt x="0" y="12"/></a:lnTo><a:close/>'
  );
  expect(markup).toContain(
    '<a:moveTo><a:pt x="3" y="3"/></a:moveTo><a:lnTo><a:pt x="3" y="9"/></a:lnTo><a:lnTo><a:pt x="9" y="9"/></a:lnTo><a:lnTo><a:pt x="9" y="3"/></a:lnTo><a:close/>'
  );
});

it("closes a single quadratic segment without inventing polygon vertices", () => {
  const markup = shapePathXml(
    {
      unit: "emu",
      width: 18,
      height: 14,
      commands: [
        { type: "move", x: 0, y: 0 },
        { type: "quadratic", cx: 9, cy: 14, x: 18, y: 0 },
        { type: "close" }
      ]
    },
    "http://schemas.openxmlformats.org/drawingml/2006/main"
  );
  expect(markup).toContain(
    '<a:quadBezTo><a:pt x="9" y="14"/><a:pt x="18" y="0"/></a:quadBezTo><a:close/>'
  );
  expect(markup).not.toContain("<a:lnTo");
});

it("serializes supplied local points without inferring an origin or bounds", () => {
  const document = parseXmlPart(
    new TextEncoder().encode(
      '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spPr><a:custGeom><a:pathLst><a:path w="7" h="9"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="7" y="9"/></a:lnTo></a:path></a:pathLst></a:custGeom></p:spPr></p:sp>'
    ),
    { maxBytes: 65536, maxNodes: 1000, maxDepth: 32 }
  );
  const result = applyShapePath(document, document.root, {
    unit: "emu",
    width: 1001,
    height: 2002,
    commands: [
      { type: "move", x: 101, y: 202 },
      { type: "line", x: 320, y: 40 },
      { type: "close" },
      { type: "move", x: 20, y: 140 },
      { type: "line", x: -17, y: 29 }
    ]
  });
  const markup = new TextDecoder().decode(result.bytes());
  expect(markup).toContain('<a:path w="1001" h="2002">');
  expect(markup).toContain('<a:moveTo><a:pt x="101" y="202"/></a:moveTo>');
  expect(markup).toContain('<a:lnTo><a:pt x="320" y="40"/></a:lnTo><a:close/>');
  expect(markup).toContain(
    '<a:moveTo><a:pt x="20" y="140"/></a:moveTo><a:lnTo><a:pt x="-17" y="29"/></a:lnTo>'
  );
});
