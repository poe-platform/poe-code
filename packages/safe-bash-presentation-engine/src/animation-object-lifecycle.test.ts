import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  createPresentation,
  mutateAnimations,
  mutateShapeSelection,
  readShapes,
  removeShapes,
  importSlides,
  readAnimations,
  Length
} from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart } from "./xml.js";

const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
const position = { coordinateSystem: "one-based" as const, value: 1 };
async function fixture() {
  const volume = Volume.fromJSON({});
  const source = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { name: "Card", text: "One", x: 10, y: 20, width: 100, height: 80 },
            { name: "Badge", text: "Two", x: 110, y: 20, width: 100, height: 80 }
          ]
        }
      ]
    },
    context
  );
  const animated = await mutateAnimations(
    source,
    "add",
    { target: { slide: position, shape: "Card" }, kind: "fade-in", trigger: "on-click" },
    context
  );
  volume.writeFileSync("/source.pptx", animated.bytes);
  return { volume, bytes: new Uint8Array(volume.readFileSync("/source.pptx") as Buffer) };
}
function timing(bytes: Uint8Array, part = "ppt/slides/slide1.xml") {
  const doc = parseXmlPart(
    inspectZip(bytes).find((entry) => entry.name === part)!.payload,
    context.xmlLimits
  );
  const node = doc.root.children.find((child) => child.name.localName === "timing")!;
  return doc.markup(node);
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it("duplicates a drawing with fresh shape identity while retaining original animation targets", async () => {
  const { bytes, volume } = await fixture();
  const shapes = await readShapes(bytes, {}, context);
  const output = await mutateShapeSelection(
    bytes,
    {
      action: "duplicate",
      coordinateSystem: "slide",
      shapes: [shapes[0]!.location],
      offsetX: new Length(4),
      offsetY: new Length(5)
    },
    context
  );
  const after = await readShapes(output.bytes, {}, context);
  expect(after.map((shape) => shape.shapeId).sort()).toEqual([2, 3, 4]);
  expect(timing(output.bytes)).toBe(timing(bytes));
  expect((await readAnimations(output.bytes, {}, context))[0]!.targetShapeIds).toEqual(["2"]);
  expect((await readAnimations(output.bytes, {}, context))[0]!.diagnostics).toEqual([]);
  expect(new Uint8Array(volume.readFileSync("/source.pptx") as Buffer)).toEqual(bytes);
});
it("rejects target deletion until its effect is removed or retargeted", async () => {
  const { bytes } = await fixture();
  await expect(removeShapes(bytes, { slide: 1, shape: "Card" }, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
  const removed = await mutateAnimations(
    bytes,
    "remove",
    {
      selection: { kind: "object", scope: "slides", owner: "/ppt/slides/slide1.xml", name: "Card" }
    },
    context
  );
  const deleted = await removeShapes(removed.bytes, { slide: 1, shape: "Card" }, context);
  expect((await readShapes(deleted.bytes, {}, context)).map((shape) => shape.name)).toEqual([
    "Badge"
  ]);
  expect((await readAnimations(deleted.bytes, {}, context))[0]!.targetShapeIds).toEqual([]);
  const retargeted = await mutateAnimations(
    bytes,
    "set",
    {
      selection: { kind: "object", scope: "slides", owner: "/ppt/slides/slide1.xml", name: "Card" },
      target: { slide: position, shape: "Badge" }
    },
    context
  );
  const after = await removeShapes(retargeted.bytes, { slide: 1, shape: "Card" }, context);
  expect((await readAnimations(after.bytes, {}, context))[0]!.targetShapeIds).toEqual(["3"]);
  expect((await readAnimations(after.bytes, {}, context))[0]!.diagnostics).toEqual([]);
});
it("imports a slide with coherent local timing identities and editable dependencies", async () => {
  const { bytes } = await fixture();
  const dependent = await mutateAnimations(
    bytes,
    "add",
    {
      target: { slide: position, shape: "Badge" },
      kind: "pulse",
      trigger: "after-previous",
      duration: 501
    },
    context
  );
  const destination = await createPresentation({ slides: [{}] }, context);
  const imported = await importSlides(
    destination,
    dependent.bytes,
    { sourceSlides: [1], position: 2, themePolicy: "source" },
    context
  );
  const records = await readAnimations(imported, {}, context);
  expect(records.map((record) => record.diagnostics)).toEqual([[], []]);
  expect(records[0]!.nodes).toEqual([]);
  expect(records[1]!.targetShapeIds).toHaveLength(2);
  const shapes = await readShapes(imported, { slide: 2 }, context);
  expect(shapes.map((shape) => shape.name)).toEqual(["Card", "Badge"]);
  expect(records[1]!.targetShapeIds).toEqual(shapes.map((shape) => String(shape.shapeId)));
  const changed = await mutateAnimations(
    imported,
    "set",
    {
      selection: { kind: "object", scope: "slides", owner: records[1]!.part, name: "Badge" },
      trigger: "on-click"
    },
    context
  );
  expect(
    (await readAnimations(changed.bytes, {}, context))[1]!.nodes.filter(
      (node) => node.type === "tn"
    )
  ).toEqual([]);
});
