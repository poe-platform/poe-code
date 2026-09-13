import { expect, it, vi, beforeAll, afterAll } from "vitest";
import { createPresentation } from "./creation.js";
import { readShapes } from "./shape-operations.js";
import {
  addConnector,
  readConnectors,
  mutateConnectors,
  removeShapes,
  removeConnectors
} from "./connector-operations.js";
import { Length } from "./length.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
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
const geometry = {
  kind: 1 as const,
  beginX: new Length(0),
  beginY: new Length(0),
  endX: new Length(30),
  endY: new Length(20)
};
it("round trips SDK attachment, rebind, free endpoint and target deletion policy", async () => {
  const source = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { x: 0, y: 0, width: 100, height: 100, text: "First" },
            { x: 100, y: 100, width: 40, height: 60, text: "Second" }
          ]
        }
      ]
    },
    context
  );
  let shapes = await readShapes(source, { slide: 1 }, context);
  let edited = await addConnector(
    source,
    { slide: 1, update: { ...geometry, beginTarget: shapes[0]!.location, site: 3 } },
    context
  );
  expect((await readConnectors(edited.bytes, { slide: 1 }, context))[0]).toMatchObject({
    beginX: 100,
    beginY: 50,
    beginTarget: { objectId: Number(shapes[0]!.location.objectId), site: 3 }
  });
  shapes = await readShapes(edited.bytes, { slide: 1 }, context);
  const connector = (await readConnectors(edited.bytes, { slide: 1 }, context))[0]!;
  edited = await mutateConnectors(
    edited.bytes,
    { shape: connector.name, update: { beginTarget: shapes[1]!.location, site: 0 } },
    context
  );
  expect((await readConnectors(edited.bytes, { slide: 1 }, context))[0]).toMatchObject({
    beginX: 120,
    beginY: 100
  });
  shapes = await readShapes(edited.bytes, { slide: 1 }, context);
  await expect(removeShapes(edited.bytes, { select: shapes[1]!.token }, context)).rejects.toThrow();
  edited = await removeShapes(
    edited.bytes,
    { select: shapes[1]!.token, detachPolicy: "detach" },
    context
  );
  expect((await readConnectors(edited.bytes, { slide: 1 }, context))[0]).toMatchObject({
    beginTarget: null,
    beginX: 120,
    beginY: 100
  });
});
it("rejects stale and cross-slide locations without assigning a connection", async () => {
  const source = await createPresentation(
    {
      slides: [
        { shapes: [{ x: 0, y: 0, width: 20, height: 20, text: "One" }] },
        { shapes: [{ x: 0, y: 0, width: 20, height: 20, text: "Two" }] }
      ]
    },
    context
  );
  const target = (await readShapes(source, { slide: 2 }, context))[0]!.location;
  await expect(
    addConnector(
      source,
      { slide: 1, update: { ...geometry, beginTarget: target, site: 0 } },
      context
    )
  ).rejects.toThrow();
  await expect(
    addConnector(
      source,
      {
        slide: 1,
        update: { ...geometry, beginTarget: { ...target, fingerprint: "stale" }, site: 0 }
      },
      context
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
});
it("rejects invalid deletion options before reading input capabilities", async () => {
  const read = vi.fn(async () => null),
    source = { read };
  await expect(removeShapes(source, { detachPolicy: "other" } as never, context)).rejects.toThrow();
  await expect(
    removeConnectors(source, { detachPolicy: "detach" } as never, context)
  ).rejects.toThrow();
  const options = Object.defineProperty({}, "shape", {
    get() {
      throw new Error("getter invoked");
    }
  });
  await expect(removeShapes(source, options, context)).rejects.toMatchObject({
    code: "invalid-selection"
  });
  await expect(removeShapes(source, { update: {} } as never, context)).rejects.toThrow();
  await expect(removeConnectors(source, { update: {} } as never, context)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
