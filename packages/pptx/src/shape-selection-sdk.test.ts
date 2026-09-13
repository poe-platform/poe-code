import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, Length, mutateShapeSelection, readShapes } from "./index.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
it("uses only supplied file authority and returns reusable fresh duplicate locations", async () => {
  const source = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { x: 10, y: 20, width: 30, height: 40, text: "First" },
            { x: 50, y: 60, width: 30, height: 40, text: "Second" }
          ]
        },
        { shapes: [{ x: 70, y: 80, width: 30, height: 40, text: "Elsewhere" }] }
      ]
    },
    context
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/input.pptx", source);
  const input = {
    path: "/input.pptx",
    capability: {
      async openRead(path: string) {
        const bytes = new Uint8Array(fs.readFileSync(path) as Buffer);
        let offset = 0;
        return {
          async read(size: number) {
            if (offset === bytes.length) return null;
            const chunk = bytes.slice(offset, offset + size);
            offset += chunk.length;
            return chunk;
          }
        };
      }
    }
  };
  const original = await readShapes(input, {}, context);
  await expect(
    mutateShapeSelection(
      input,
      {
        action: "align",
        alignment: "left",
        coordinateSystem: "slide",
        shapes: [original[0]!.location, original[2]!.location]
      },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-selection" });
  const duplicated = await mutateShapeSelection(
    input,
    {
      action: "duplicate",
      coordinateSystem: "slide",
      shapes: [original[0]!.location],
      offsetX: new Length(5),
      offsetY: new Length(-7)
    },
    context
  );
  expect(duplicated.affected).toBe(1);
  await expect(
    mutateShapeSelection(
      duplicated.bytes,
      {
        action: "move",
        order: "front",
        coordinateSystem: "slide",
        shapes: [original[0]!.location]
      },
      context
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
  expect(duplicated.records[0]!.location.fingerprint).not.toBe(original[0]!.location.fingerprint);
  const copied = await readShapes(duplicated.bytes, { slide: 1 }, context);
  expect(copied.map((s) => [s.shapeId, s.left, s.top])).toEqual([
    [2, 10, 20],
    [3, 50, 60],
    [4, 15, 13]
  ]);
  const moved = await mutateShapeSelection(
    duplicated.bytes,
    {
      action: "move",
      order: "back",
      coordinateSystem: "slide",
      shapes: duplicated.records.map((r) => r.location)
    },
    context
  );
  expect((await readShapes(moved.bytes, { slide: 1 }, context)).map((s) => s.shapeId)).toEqual([
    4, 2, 3
  ]);
  for (const action of ["move", "align", "distribute", "duplicate"] as const) {
    const specific =
      action === "move"
        ? { action, order: "front" as const }
        : action === "align"
          ? { action, alignment: "left" as const }
          : action === "distribute"
            ? { action, axis: "horizontal" as const }
            : { action, offsetX: new Length(0), offsetY: new Length(0) };
    const empty = await mutateShapeSelection(
      input,
      { ...specific, coordinateSystem: "slide", shape: "Absent", all: true, allowEmpty: true },
      context
    );
    expect(empty.affected).toBe(0);
    expect(empty.records).toEqual([]);
    expect(empty.bytes).toEqual(source);
  }
  expect(new Uint8Array(fs.readFileSync("/input.pptx") as Buffer)).toEqual(source);
});
