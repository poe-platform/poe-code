import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { applyShapeGroup, applyShapeUngroup, groupShapes } from "./shape-groups.js";
import { nodeFor, readShapes } from "./shape-operations.js";
import { createPresentation } from "./creation.js";
import { addConnector } from "./connector-operations.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { Emu } from "./length.js";
import { readShapeGeometry } from "./shape-transforms.js";
import { parseXmlPart } from "./xml.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const line = (id: number, x: number, y: number, width: number, height: number) =>
  `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Edge ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="line"/></p:spPr></p:cxnSp>`;
const doc = (body: string) =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 65536, maxNodes: 500, maxDepth: 20 }
  );

it.each([
  [30, 0],
  [0, 40],
  [0, 0]
])(
  "groups and restores a connector with extent %s by %s without changing its points",
  (width, height) => {
    const source = doc(line(2, -17, 23, width!, height!) + line(3, 100, 200, 50, 70));
    const changed = applyShapeGroup(source, ["2", "3"], 0);
    expect(readShapeGeometry(changed.root, nodeFor(changed.root, "2"))?.corners).toEqual([
      { x: -17, y: 23 },
      { x: -17 + width!, y: 23 },
      { x: -17 + width!, y: 23 + height! },
      { x: -17, y: 23 + height! }
    ]);
    const wrapper = nodeFor(changed.root, "4");
    expect(changed.markup(wrapper)).toContain('<a:ext cx="167" cy="247"/>');
    expect(changed.markup(nodeFor(changed.root, "2"), true)).toBe(
      source.markup(nodeFor(source.root, "2"), true)
    );
    const restored = applyShapeUngroup(changed, "4", 0);
    expect(restored.markup(nodeFor(restored.root, "2"), true)).toBe(
      source.markup(nodeFor(source.root, "2"), true)
    );
  }
);

it.each([
  [0, 30],
  [30, 0],
  [0, 0]
])("rejects a singular group union %s by %s", (width, height) => {
  const source = doc(line(2, -5, 7, width!, height!) + line(3, -5, 7, width!, height!));
  const before = source.bytes();
  expect(() => applyShapeGroup(source, ["2", "3"], 0)).toThrow();
  expect(source.bytes()).toEqual(before);
});

it.each([-1, -20])("rejects negative connector extents %s", (width) => {
  const source = doc(line(2, 0, 0, width, 0) + line(3, 100, 200, 50, 70));
  expect(() => applyShapeGroup(source, ["2", "3"], 0)).toThrow();
});

it("retains rejection of zero-sized ordinary shapes and missing connector dimensions", () => {
  for (const body of [
    '<p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="0" cy="4"/></a:xfrm></p:spPr></p:sp>',
    '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2"/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cy="4"/></a:xfrm></p:spPr></p:cxnSp>'
  ]) {
    const source = doc(body + line(3, 100, 200, 50, 70));
    const before = source.bytes();
    expect(() => applyShapeGroup(source, ["2", "3"], 0)).toThrow();
    expect(source.bytes()).toEqual(before);
  }
});

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it("groups zero-axis connectors through the SDK and command with matching explicit bounds", async () => {
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
  let bytes = await createPresentation({ slides: [{}] }, context);
  for (const [beginX, beginY, endX, endY] of [
    [-17, 23, 13, 23],
    [100, 200, 100, 270]
  ]) {
    bytes = (
      await addConnector(
        bytes,
        {
          slide: 1,
          update: {
            kind: "STRAIGHT",
            beginX: new Emu(beginX!),
            beginY: new Emu(beginY!),
            endX: new Emu(endX!),
            endY: new Emu(endY!)
          }
        },
        context
      )
    ).bytes;
  }
  const shapes = (await readShapes(bytes, {}, context)).map((item) => item.location);
  const sdk = await groupShapes(bytes, { shapes, tolerance: new Emu(0) }, context);
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/edges.pptx", bytes);
  const result = await createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  }).execute({
    args: [
      "shapes",
      "group",
      "/edges.pptx",
      "--shapes",
      JSON.stringify(shapes),
      "--tolerance",
      "0emu",
      "--in-place",
      "--json"
    ].map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
    publishOutput: async (request) => {
      fs.writeFileSync(request.outputPath, request.bytes);
    }
  });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  for (const output of [sdk.bytes, new Uint8Array(fs.readFileSync("/edges.pptx") as Buffer)]) {
    const records = await readShapes(output, {}, context);
    expect(records.map(({ left, top, width, height }) => ({ left, top, width, height }))).toEqual([
      { left: -17, top: 23, width: 117, height: 247 },
      { left: -17, top: 23, width: 30, height: 0 },
      { left: 100, top: 200, width: 0, height: 70 }
    ]);
  }
});
