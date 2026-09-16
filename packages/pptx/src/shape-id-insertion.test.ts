import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";
import { addChart } from "./chart-editing.js";
import { addTable } from "./table-operations.js";
import { addConnector } from "./connector-operations.js";
import { addShape, readShapes } from "./shape-operations.js";
import { createShapeXml } from "./shapes.js";
import { loadShared, required } from "./masters.js";
import { Length } from "./length.js";

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
const geometry = {
  left: new Length(0),
  top: new Length(0),
  width: new Length(1000),
  height: new Length(1000)
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function sparseDrawing() {
  const state = await loadShared(await createPresentation({ slides: [{}] }, context), context);
  const part = state.index.inventory.slides[0]!.part;
  const doc = state.doc(part);
  const tree = required(required(doc.root, "cSld"), "spTree");
  state.save(
    part,
    doc.spliceChildren(tree, tree.children.length, 0, [createShapeXml("RECTANGLE", 17, geometry)])
  );
  const bytes = (await state.finish(part, [1])).bytes;
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  return new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer);
}
it.each(["shape", "image", "table", "chart", "connector"])(
  "allocates %s above the current maximum rather than filling a gap",
  async (kind) => {
    const input = await sparseDrawing();
    let output: Uint8Array;
    if (kind === "image")
      output = await addImage(
        input,
        {
          slide: 1,
          bytes: new Uint8Array([
            71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0,
            1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
          ]),
          contentType: "image/gif"
        },
        context
      );
    else if (kind === "chart")
      output = await addChart(
        input,
        {
          slide: 1,
          type: "COLUMN_CLUSTERED",
          left: 0,
          top: 0,
          width: 1000,
          height: 1000,
          data: { categories: ["North"], series: [{ name: "Rain", values: [3] }] }
        },
        context
      );
    else if (kind === "table")
      output = (
        await addTable(input, { slide: 1, update: { rows: 1, columns: 1, ...geometry } }, context)
      ).bytes;
    else if (kind === "connector")
      output = (
        await addConnector(
          input,
          {
            slide: 1,
            update: {
              kind: "STRAIGHT",
              beginX: new Length(0),
              beginY: new Length(0),
              endX: new Length(1000),
              endY: new Length(1000)
            }
          },
          context
        )
      ).bytes;
    else
      output = (
        await addShape(input, { slide: 1, update: { kind: "RECTANGLE", ...geometry } }, context)
      ).bytes;
    expect((await readShapes(output, { slide: 1 }, context)).map((shape) => shape.shapeId)).toEqual(
      [17, 18]
    );
  }
);
