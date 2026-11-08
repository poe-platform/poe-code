import { afterAll, beforeAll, expect, it, vi } from "vitest";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
import { applyShapeGroup, applyShapeUngroup } from "./shape-groups.js";
import { parseXmlPart } from "./xml.js";
import { nodeFor } from "./shape-operations.js";
import { readShapeGeometry } from "./shape-transforms.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const limits = { maxBytes: 100000, maxNodes: 1000, maxDepth: 40 };
const shape = (id: number, x = 0, y = 0, w = 20, h = 10, rot = 0) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="${rot}"><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
const group = (body: string, w = 200, h = 100, cw = 100, ch = 100, rot = 0, flip = false) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="40" name="Assembly"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="${rot}" flipH="${Number(flip)}"><a:off x="10" y="20"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="5" y="10"/><a:chExt cx="${cw}" cy="${ch}"/></a:xfrm></p:grpSpPr>${body}</p:grpSp>`;
const doc = (body: string) =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    ),
    limits
  );
it("wraps contiguous siblings with union coordinates and preserves original IDs and order", () => {
  const source = doc(shape(7, 100, 200, 100, 200) + shape(19, 250, 450, 150, 250) + shape(31));
  const changed = applyShapeGroup(source, ["19", "7"], 0);
  expect(changed.markup(nodeFor(changed.root, "32"))).toContain('<a:off x="100" y="200"/>');
  expect(changed.markup(nodeFor(changed.root, "32"))).toContain('<a:ext cx="300" cy="500"/>');
  expect(readShapeGeometry(changed.root, nodeFor(changed.root, "19"))?.corners).toEqual([
    { x: 250, y: 450 },
    { x: 400, y: 450 },
    { x: 400, y: 700 },
    { x: 250, y: 700 }
  ]);
  const restored = applyShapeUngroup(changed, "32", 0);
  expect(restored.root.children[0]!.children[0]!.children.map((n) => n.name.localName)).toEqual([
    "sp",
    "sp",
    "sp"
  ]);
  expect(restored.markup(nodeFor(restored.root, "7"))).toContain('id="7"');
});
it("composes offset scale quarter rotation and reflection before removing a group", () => {
  const source = doc(group(shape(7, 5, 10, 20, 10), 200, 100, 100, 100, 5400000, true));
  const changed = applyShapeUngroup(source, "40", 0);
  expect(readShapeGeometry(changed.root, nodeFor(changed.root, "7"))?.corners).toEqual([
    { x: 160, y: 170 },
    { x: 160, y: 130 },
    { x: 150, y: 130 },
    { x: 150, y: 170 }
  ]);
});
it("retains nested child coordinate extents while composing the outer transform", () => {
  const nested = group(shape(7, 5, 10), 50, 50, 100, 100, 5400000, true).replace(
    'id="40"',
    'id="41"'
  );
  const source = doc(group(nested, 200, 200, 100, 100, 5400000, true));
  const changed = applyShapeUngroup(source, "40", 0);
  expect(readShapeGeometry(changed.root, nodeFor(changed.root, "7"))?.corners).toEqual([
    { x: 90, y: 110 },
    { x: 110, y: 110 },
    { x: 110, y: 120 },
    { x: 90, y: 120 }
  ]);
  expect(changed.markup(nodeFor(changed.root, "41"))).toContain('<a:chExt cx="100" cy="100"/>');
});
it("rejects fractional precision loss at zero tolerance before final corner rounding", () => {
  const source = doc(group(shape(7, 6, 10, 3, 3), 1, 1, 3, 3));
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/tolerance/);
  expect(() => applyShapeUngroup(source, "40", 1)).not.toThrow();
});
it.each([0, -1])("rejects singular child extents %s", (extent) => {
  const source = doc(group(shape(7), 100, 100, extent, 100));
  expect(() => applyShapeUngroup(source, "40", 100)).toThrow();
});
it("rejects a rotated child under anisotropic scaling that requires shear", () => {
  expect(() => applyShapeUngroup(doc(group(shape(7, 5, 10, 20, 10, 2700000))), "40", 100)).toThrow(
    /shear/
  );
});
it("rejects discontiguous grouping and referenced removed identities", () => {
  expect(() => applyShapeGroup(doc(shape(7) + shape(8) + shape(9)), ["7", "9"], 0)).toThrow();
  const source = doc(
    group(shape(7)) +
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="50"/><p:cNvCxnSpPr><a:stCxn id="40" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr></p:cxnSp>'
  );
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/referenc/);
});
it("rejects unsupported vertex geometry and group effects without changing input", () => {
  const source = doc(group(shape(7).replace('prst="rect"', 'prst="star5"')));
  const bytes = source.bytes();
  expect(() => applyShapeUngroup(source, "40", 100)).toThrow();
  expect(source.bytes()).toEqual(bytes);
});
it("rejects sub-EMU loss hidden behind a large world offset", () => {
  const source = doc(
    group(shape(7, 1, 0, 10000000000000, 10000000000000), 1, 1, 10000000000000, 10000000000000)
      .replace('x="10" y="20"', 'x="10000000000000" y="0"')
      .replace('x="5" y="10"', 'x="0" y="0"')
  );
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/tolerance/);
});

it.each([
  {
    boxes: [
      [1, 2, 3, 4],
      [10, 20, 30, 40]
    ],
    expected: [1, 2, 39, 58]
  },
  {
    boxes: [
      [100, 50, 25, 25],
      [50, 100, 25, 25],
      [150, 75, 25, 25]
    ],
    expected: [50, 50, 125, 75]
  },
  {
    boxes: [
      [300, 400, 100, 200],
      [450, 650, 150, 250]
    ],
    expected: [300, 400, 300, 500]
  }
])("calculates the stored sibling union $expected", ({ boxes, expected }) => {
  const source = doc(boxes.map((b, i) => shape(i + 1, b[0], b[1], b[2], b[3])).join(""));
  const changed = applyShapeGroup(
    source,
    boxes.map((_, i) => String(i + 1)),
    0
  );
  const markup = changed.markup(nodeFor(changed.root, String(boxes.length + 1)));
  expect(markup).toContain(`<a:off x="${expected[0]}" y="${expected[1]}"/>`);
  expect(markup).toContain(`<a:chOff x="${expected[0]}" y="${expected[1]}"/>`);
  expect(markup).toContain(`<a:ext cx="${expected[2]}" cy="${expected[3]}"/>`);
  expect(markup).toContain(`<a:chExt cx="${expected[2]}" cy="${expected[3]}"/>`);
});
it.each([{ ids: [] }, { ids: ["7"] }, { ids: ["7", "7"] }])(
  "requires at least two distinct identities $ids",
  ({ ids }) => {
    expect(() => applyShapeGroup(doc(shape(7)), ids, 0)).toThrow();
  }
);
it("preserves general-angle text children structurally through an identity wrapper", () => {
  const source = doc(
    shape(7, 5, 10, 20, 10, 1234567).replace(
      "</p:sp>",
      "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Original</a:t></a:r></a:p></p:txBody></p:sp>"
    ) + shape(8)
  );
  const grouped = applyShapeGroup(source, ["7", "8"], 0),
    restored = applyShapeUngroup(grouped, "9", 0);
  expect(restored.markup(nodeFor(restored.root, "7"), true)).toBe(
    source.markup(nodeFor(source.root, "7"), true)
  );
});
it("rejects nonidentity general-angle flattening when an exact bound is unavailable", () => {
  expect(() =>
    applyShapeUngroup(doc(group(shape(7), 100, 100, 100, 100, 1000000)), "40", 1)
  ).toThrow(/quarter-turn/);
});
it("rejects foreign group children rather than dropping them", () => {
  const source = doc(group(shape(7) + '<v:sp xmlns:v="urn:original:metadata"/>'));
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/metadata/);
});
it.each(["<a:hlinkClick/>", "<p:extLst/>"])("rejects group actions or extensions %s", (extra) => {
  const source = doc(
    group(shape(7)).replace(
      '<p:cNvPr id="40" name="Assembly"/>',
      `<p:cNvPr id="40" name="Assembly">${extra}</p:cNvPr>`
    )
  );
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/metadata/);
});
it("rejects timing targeting transformed descendants while retaining child connector identities", () => {
  const source = doc(group(shape(7)) + '<p:timing><p:spTgt spid="7"/></p:timing>');
  expect(() => applyShapeUngroup(source, "40", 0)).toThrow(/timing/);
  const connected = doc(
    group(shape(7)) +
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="50"/><p:cNvCxnSpPr><a:stCxn id="7" idx="0"/></p:cNvCxnSpPr></p:nvCxnSpPr></p:cxnSp>'
  );
  const changed = applyShapeUngroup(connected, "40", 0);
  expect(changed.markup(nodeFor(changed.root, "50"))).toContain('<a:stCxn id="7" idx="0"/>');
});

it("rejects a union extent beyond the coordinate admission bound", () => {
  const limit = 27273042316900;
  expect(() =>
    applyShapeGroup(doc(shape(7, -limit, 0, 1, 1) + shape(8, limit - 1, 0, 1, 1)), ["7", "8"], 0)
  ).toThrow(/bounds/);
});
it("composes a vertical flip in the Strict namespace", () => {
  const sourceXml = group(shape(7, 5, 10, 20, 10), 100, 100, 100, 100, 0).replace(
    'flipH="0"',
    'flipV="1"'
  );
  const source = parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="http://purl.oclc.org/ooxml/presentationml/main" xmlns:a="http://purl.oclc.org/ooxml/drawingml/main"><p:cSld><p:spTree>${sourceXml}</p:spTree></p:cSld></p:sld>`
    ),
    limits
  );
  const changed = applyShapeUngroup(source, "40", 0);
  expect(readShapeGeometry(changed.root, nodeFor(changed.root, "7"))?.corners).toEqual([
    { x: 10, y: 120 },
    { x: 30, y: 120 },
    { x: 30, y: 110 },
    { x: 10, y: 110 }
  ]);
  expect(new TextDecoder().decode(changed.bytes())).not.toContain("schemas.openxmlformats.org");
});
it("allocates the first unused identity after the maximum and retains exact sibling order", () => {
  const source = doc(shape(1) + shape(4294967295) + shape(7));
  const grouped = applyShapeGroup(source, ["4294967295", "1"], 0);
  expect(grouped.markup(nodeFor(grouped.root, "2"))).toContain('name="Group 2"');
  const restored = applyShapeUngroup(grouped, "2", 0);
  expect(
    restored.root.children[0]!.children[0]!.children.map((node) =>
      Number(
        node.children[0]!.children[0]!.attributes.find((a) => a.name.localName === "id")!.value
      )
    )
  ).toEqual([1, 4294967295, 7]);
});
it("roundtrips public SDK locations and exposes lifted child records", async () => {
  const { createPresentation, readShapes, groupShapes, ungroupShape, Emu } =
    await import("./index.js");
  const context = {
    limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
    archiveLimits: {
      maxArchiveBytes: 262144,
      maxEntryBytes: 65536,
      maxTotalBytes: 262144,
      maxMembers: 64,
      maxPathBytes: 256,
      maxDepth: 16,
      maxPaxBytes: 1024,
      maxTextBytes: 65536,
      chunkSize: 4096
    },
    xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
    relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
  };
  const bytes = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { x: 10, y: 20, width: 40, height: 20, text: "First" },
            { x: 70, y: 20, width: 20, height: 40, text: "Second" }
          ]
        }
      ]
    },
    context
  );
  const original = await readShapes(bytes, { slide: 1 }, context);
  const grouped = await groupShapes(
    bytes,
    { shapes: original.map((s) => s.location), tolerance: new Emu(0) },
    context
  );
  const inspection = await readShapes(grouped.bytes, { slide: 1 }, context),
    assembly = inspection.find((s) => s.name.startsWith("Group "))!;
  const restored = await ungroupShape(
    grouped.bytes,
    { select: assembly.token, tolerance: new Emu(0) },
    context
  );
  expect(restored.affected).toBe(1);
  expect(restored.records.map((r) => r.id)).toEqual(original.map((s) => String(s.shapeId)));
  expect(
    (await readShapes(restored.bytes, { slide: 1 }, context)).map((s) => ({
      id: s.shapeId,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height
    }))
  ).toEqual([
    { id: 2, left: 10, top: 20, width: 40, height: 20 },
    { id: 3, left: 70, top: 20, width: 20, height: 40 }
  ]);
});
it("rejects opaque timing and extension references before removing an identity", () => {
  for (const references of [
    '<p:timing><v:target xmlns:v="urn:original:timeline" object="40"/></p:timing>',
    '<p:extLst><p:ext uri="urn:original:link"><v:target xmlns:v="urn:original:links" object="40"/></p:ext></p:extLst>'
  ]) {
    expect(() => applyShapeUngroup(doc(group(shape(7)) + references), "40", 0)).toThrow(
      /references/
    );
  }
});
