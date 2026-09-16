import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation, createPptxCommandEngine, readShapes } from "./index.js";

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
  const bytes = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { x: 10, y: 20, width: 10, height: 20, text: "First" },
            { x: 40, y: 50, width: 20, height: 20, text: "Second" },
            { x: 100, y: 80, width: 30, height: 20, text: "Third" }
          ]
        }
      ]
    },
    context
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  let reads = 0;
  return {
    bytes: () => new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer),
    reads: () => reads,
    async run(args: string[]) {
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
    }
  };
}

describe("shape selection commands", () => {
  it("publishes schemas and rejects missing coordinate space before input reads", async () => {
    const f = await fixture();
    for (const action of ["move", "align", "distribute", "duplicate"]) {
      const result = await f.run(["schema", "shapes", action]);
      expect(result.code, JSON.stringify(result.value)).toBe(0);
      const schema = result.value.data.operations[`shapes.${action}`].options;
      const options = {
        coordinateSystem: "slide",
        slide: 1,
        all: true,
        dryRun: true,
        ...(action === "move"
          ? { order: "front" }
          : action === "align"
            ? { alignment: "left" }
            : action === "distribute"
              ? { axis: "horizontal" }
              : { offsetX: { value: 1, unit: "emu" }, offsetY: { value: 2, unit: "emu" } })
      };
      const validate = compileJsonSchema(schema);
      expect(validate.validate(options).ok).toBe(true);
      const missingSpace = { ...options } as Record<string, unknown>;
      delete missingSpace.coordinateSystem;
      expect(validate.validate(missingSpace).ok).toBe(false);
      expect((await f.run(["shapes", action, "/deck.pptx", "--dry-run"])).code).toBe(2);
      expect((await f.run(["shapes", action, "--help"])).value.data.usage).toContain(
        "--coordinate-system"
      );
    }
    expect(f.reads()).toBe(0);
    const capabilities = await f.run(["capabilities"]);
    expect(capabilities.value.data.features.shapeSelection.operations).toEqual([
      "shapes.move",
      "shapes.align",
      "shapes.distribute",
      "shapes.duplicate"
    ]);
  });

  it("rejects conflicting and wrong action options before input reads", async () => {
    const f = await fixture();
    for (const flags of [
      ["move", "--order", "front", "--position", "1"],
      ["move", "--order", "sideways"],
      ["move", "--position", "1.5"],
      ["align", "--alignment", "justify"],
      ["align", "--alignment", "left", "--axis", "horizontal"],
      ["distribute", "--axis", "diagonal"],
      ["duplicate", "--offset-x", "0emu"],
      ["duplicate", "--offset-x", "1", "--offset-y", "0emu"]
    ]) {
      const result = await f.run([
        "shapes",
        flags[0]!,
        "/deck.pptx",
        ...flags.slice(1),
        "--coordinate-system",
        "slide",
        "--slide",
        "1",
        "--all",
        "--dry-run"
      ]);
      expect(result.code, JSON.stringify(result.value)).toBe(2);
    }
    expect(f.reads()).toBe(0);
  });

  it("validates a duplicate dry run without changing input bytes", async () => {
    const f = await fixture();
    const original = f.bytes();
    const result = await f.run([
      "shapes",
      "duplicate",
      "/deck.pptx",
      "--slide",
      "1",
      "--all",
      "--coordinate-system",
      "slide",
      "--offset-x",
      "0emu",
      "--offset-y",
      "0emu",
      "--in-place",
      "--dry-run"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(0);
    expect(f.bytes()).toEqual(original);
    expect(result.value.affected).toBe(3);
    expect(result.value.data.outputs).toEqual([]);
    const schema = await f.run(["schema", "shapes", "duplicate"]);
    const validate = compileJsonSchema(schema.value.data.operations["shapes.duplicate"].result);
    expect(validate.validate(result.value).ok).toBe(true);
  });

  it("honors explicitly empty selections while retaining original bytes", async () => {
    const f = await fixture();
    const original = f.bytes();
    for (const flags of [
      ["move", "--order", "front"],
      ["align", "--alignment", "left"],
      ["distribute", "--axis", "horizontal"],
      ["duplicate", "--offset-x", "0emu", "--offset-y", "0emu"]
    ]) {
      const result = await f.run([
        "shapes",
        flags[0]!,
        "/deck.pptx",
        ...flags.slice(1),
        "--coordinate-system",
        "slide",
        "--slide",
        "1",
        "--shape",
        "Missing",
        "--allow-empty",
        "--in-place"
      ]);
      expect(result.code, JSON.stringify(result.value)).toBe(0);
      expect(result.value.affected).toBe(0);
      expect(result.value.locations).toEqual([]);
      expect(f.bytes()).toEqual(original);
    }
  });

  it("moves exact siblings and preserves order after reopening", async () => {
    const f = await fixture();
    const records = await readShapes(f.bytes(), {}, context);
    const result = await f.run([
      "shapes",
      "move",
      "/deck.pptx",
      "--shapes",
      JSON.stringify([records[0]!.location]),
      "--coordinate-system",
      "slide",
      "--order",
      "front",
      "--in-place"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(0);
    expect((await readShapes(f.bytes(), {}, context)).map((x) => x.shapeId)).toEqual([3, 4, 2]);
    expect(result.value.data.effects.map((x: { feature: string }) => x.feature)).toEqual(["F25"]);
    const schema = await f.run(["schema", "shapes", "move"]);
    expect(
      compileJsonSchema(schema.value.data.operations["shapes.move"].result).validate(result.value)
        .ok
    ).toBe(true);
  });

  it("aligns, distributes and duplicates with exact local arithmetic", async () => {
    const f = await fixture();
    for (const [action, flags] of [
      ["align", ["--alignment", "top"]],
      ["distribute", ["--axis", "horizontal"]]
    ] as const) {
      const result = await f.run([
        "shapes",
        action,
        "/deck.pptx",
        "--slide",
        "1",
        "--all",
        "--coordinate-system",
        "slide",
        ...flags,
        "--in-place"
      ]);
      expect(result.code, JSON.stringify(result.value)).toBe(0);
    }
    const records = await readShapes(f.bytes(), {}, context);
    expect(records.map((x) => [x.left, x.top])).toEqual([
      [10, 20],
      [50, 20],
      [100, 20]
    ]);
    const result = await f.run([
      "shapes",
      "duplicate",
      "/deck.pptx",
      "--shapes",
      JSON.stringify([records[0]!.location]),
      "--coordinate-system",
      "slide",
      "--offset-x",
      "5emu",
      "--offset-y",
      "-2emu",
      "--in-place"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(0);
    const copied = await readShapes(f.bytes(), {}, context);
    expect(copied.map((x) => x.shapeId)).toEqual([2, 3, 4, 5]);
    expect([copied[3]!.left, copied[3]!.top]).toEqual([15, 18]);
  });
});
