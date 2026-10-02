import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readShapes } from "./shape-operations.js";

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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const original = await createPresentation(
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
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", original);
  let reads = 0;
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => {
        reads++;
        return new Uint8Array(fs.readFileSync(path) as Buffer);
      },
      publishOutput: async (request) => {
        if (!request.dryRun) fs.writeFileSync(request.outputPath, request.bytes);
      }
    });
    return { code: result.exitCode, value: JSON.parse(new TextDecoder().decode(result.stdout)) };
  };
  return {
    original,
    run,
    reads: () => reads,
    bytes: () => new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)
  };
}

describe("group resource commands", () => {
  it("requires explicit tolerance and publishes mutation schemas without reading input", async () => {
    const f = await fixture();
    for (const action of ["group", "ungroup"]) {
      const result = await f.run(["schema", "shapes", action]);
      expect(result.code, JSON.stringify(result.value)).toBe(0);
      const schema = result.value.data.operations[`shapes.${action}`].options;
      const validate = compileJsonSchema(schema);
      const options = {
        dryRun: true,
        tolerance: { value: 0, unit: "emu" },
        ...(action === "group"
          ? { shapes: (await readShapes(f.original, {}, context)).map((x) => x.location) }
          : { slide: 1, shape: "Group" })
      };
      expect(validate.validate(options).ok).toBe(true);
      const { tolerance: ignoredTolerance, ...missing } = options;
      expect(validate.validate(missing).ok).toBe(false);
      expect(validate.validate({ ...options, tolerance: { value: -1, unit: "emu" } }).ok).toBe(
        false
      );
      expect((await f.run(["shapes", action, "/deck.pptx", "--dry-run"])).code).toBe(2);
      const help = await f.run(["shapes", action, "--help"]);
      expect(help.value.data.usage).toContain("--tolerance");
    }
    expect(f.reads()).toBe(0);
  });

  it("groups and ungroups inspected locations while preserving IDs, order and slide corners", async () => {
    const f = await fixture();
    const locations = (await readShapes(f.original, {}, context)).map((x) => x.location);
    const group = await f.run([
      "shapes",
      "group",
      "/deck.pptx",
      "--shapes",
      JSON.stringify(locations),
      "--tolerance",
      "0emu",
      "--in-place"
    ]);
    expect(group.code, JSON.stringify(group.value)).toBe(0);
    expect(group.value.data.effects.every((x: { feature: string }) => x.feature === "F24")).toBe(
      true
    );
    const grouped = await readShapes(f.bytes(), {}, context);
    expect(grouped.map((x) => x.shapeId)).toEqual([4, 2, 3]);
    expect(grouped.slice(1).map((x) => x.geometry?.corners)).toEqual([
      [
        { x: 10, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 40 },
        { x: 10, y: 40 }
      ],
      [
        { x: 70, y: 20 },
        { x: 90, y: 20 },
        { x: 90, y: 60 },
        { x: 70, y: 60 }
      ]
    ]);
    const schema = (await f.run(["schema", "shapes", "group"])).value.data.operations[
      "shapes.group"
    ].result;
    expect(compileJsonSchema(schema).validate(group.value).ok).toBe(true);
    const ungroup = await f.run([
      "shapes",
      "ungroup",
      "/deck.pptx",
      "--select",
      grouped[0]!.token,
      "--tolerance",
      "0emu",
      "--in-place"
    ]);
    expect(ungroup.code, JSON.stringify(ungroup.value)).toBe(0);
    expect(ungroup.value.locations).toHaveLength(2);
    expect(ungroup.value.data.effects).toHaveLength(2);
    expect(
      (await readShapes(f.bytes(), {}, context)).map((x) => ({
        id: x.shapeId,
        corners: x.geometry?.corners
      }))
    ).toEqual([
      {
        id: 2,
        corners: [
          { x: 10, y: 20 },
          { x: 50, y: 20 },
          { x: 50, y: 40 },
          { x: 10, y: 40 }
        ]
      },
      {
        id: 3,
        corners: [
          { x: 70, y: 20 },
          { x: 90, y: 20 },
          { x: 90, y: 60 },
          { x: 70, y: 60 }
        ]
      }
    ]);
  });

  it("rejects malformed location options before input reads and preserves dry-run input", async () => {
    const f = await fixture();
    const locations = (await readShapes(f.original, {}, context)).map((x) => x.location);
    for (const bad of [
      null,
      7,
      { ...locations[0], extra: true },
      { ...locations[0], coordinateSystem: "one-based" },
      { ...locations[0], objectId: 2 }
    ]) {
      const result = await f.run([
        "shapes",
        "group",
        "/deck.pptx",
        "--shapes",
        JSON.stringify([bad, locations[1]]),
        "--tolerance",
        "0emu",
        "--dry-run"
      ]);
      expect(result.code, JSON.stringify(result.value)).toBe(2);
    }
    expect(f.reads()).toBe(0);
    const dry = await f.run([
      "shapes",
      "group",
      "/deck.pptx",
      "--shapes",
      JSON.stringify(locations),
      "--tolerance",
      "0emu",
      "--dry-run"
    ]);
    expect(dry.code, JSON.stringify(dry.value)).toBe(0);
    expect(dry.value.data).toMatchObject({ dryRun: true, outputs: [], fingerprint: null });
    expect(f.bytes()).toEqual(f.original);
    const capabilities = await f.run(["capabilities"]);
    expect(capabilities.value.data.features.shapeGroups.operations).toEqual([
      "shapes.group",
      "shapes.ungroup"
    ]);
  });

  it("requires an explicit ungroup selector before reading input", async () => {
    const f = await fixture();
    const result = await f.run([
      "shapes",
      "ungroup",
      "/deck.pptx",
      "--tolerance",
      "0emu",
      "--dry-run"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(2);
    expect(f.reads()).toBe(0);
  });

  it("rejects inapplicable bulk controls before reading input", async () => {
    const f = await fixture();
    for (const action of ["group", "ungroup"]) {
      const schema = (await f.run(["schema", "shapes", action])).value.data.operations[
        `shapes.${action}`
      ].options;
      expect(schema.properties).not.toHaveProperty("all");
      expect(schema.properties).not.toHaveProperty("allowEmpty");
      for (const flag of ["--all", "--allow-empty"]) {
        const result = await f.run([
          "shapes",
          action,
          "/deck.pptx",
          "--tolerance",
          "0emu",
          flag,
          "--dry-run"
        ]);
        expect(result.code).toBe(2);
      }
    }
    expect(f.reads()).toBe(0);
  });
});
