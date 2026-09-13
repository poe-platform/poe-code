import { compileJsonSchema } from "toolcraft-schema";
import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mutateDrawing } from "./drawing-operations.js";
import { readPackage } from "./package-reader.js";
import { readSelectionIndex } from "./selectors.js";
import { addShape } from "./shape-operations.js";
import { Inches } from "./length.js";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
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
async function fixture(input?: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", input ?? (await createPresentation({ slides: [{}] }, context)));
  const image = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0, 3,
    199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
  ]);
  fs.writeFileSync("/tile.png", image);
  return async (args: string[]) => {
    const output = await engine.execute({
      args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
      publishOutput: async (request) => {
        if (!request.dryRun) fs.writeFileSync(request.outputPath, request.bytes);
      }
    });
    return { code: output.exitCode, value: JSON.parse(new TextDecoder().decode(output.stdout)) };
  };
}
describe("drawing resource commands", () => {
  it("exposes typed drawing and effect schemas", async () => {
    const run = await fixture();
    for (const path of [
      ["drawing", "get"],
      ["drawing", "set"],
      ["effects", "set"]
    ]) {
      const result = await run(["schema", "shapes", ...path]);
      expect(result.code, JSON.stringify(result.value)).toBe(0);
      expect(result.value.data.operations["shapes." + path.join(".")]).toBeDefined();
    }
  });
  it.each([
    ["--fill", '{"kind":"solid","color":{"rgb":"123456","theme":"accent1"}}'],
    ["--fill", '{"kind":"solid","color":{"rgb":"123456","opacity":1.1}}'],
    [
      "--fill",
      '{"kind":"gradient","angle":0,"stops":[{"position":0.5,"color":"000000"},{"position":1,"color":"FFFFFF"}]}'
    ],
    ["--fill", '{"kind":"pattern","preset":"absent"}'],
    ["--line", '{"width":{"value":-1,"unit":"pt"}}'],
    ["--line", '{"dash":"absent"}']
  ])("rejects invalid drawing values before publication: %s %s", async (flag, value) => {
    const run = await fixture();
    const result = await run([
      "shapes",
      "drawing",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--all",
      flag,
      value,
      "--dry-run"
    ]);
    expect(result.code).toBe(2);
    expect(result.value.affected).toBe(0);
    expect(result.value.data).toBeNull();
  });
  it("accepts simple fill flags and rejects mixed structured paint", async () => {
    const run = await fixture();
    const result = await run([
      "shapes",
      "drawing",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--all",
      "--allow-empty",
      "--fill-kind",
      "solid",
      "--color",
      "445566",
      "--dry-run"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(0);
    const mixed = await run([
      "shapes",
      "drawing",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--all",
      "--fill-kind",
      "solid",
      "--fill",
      '{"kind":"none"}',
      "--dry-run"
    ]);
    expect(mixed.code).toBe(2);
  });
  it("admits explicit picture bytes and CLI file without a relationship identifier", async () => {
    const input = await createPresentation({ slides: [{}] }, context);
    const shape = await addShape(
      input,
      {
        slide: 1,
        update: {
          kind: "RECTANGLE",
          name: "Panel",
          left: new Inches(0),
          top: new Inches(0),
          width: new Inches(1),
          height: new Inches(1)
        }
      },
      context
    );
    const image = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0,
      3, 199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ]);
    const changed = await mutateDrawing(
      shape.bytes,
      { slide: 1, shape: "Panel", update: { fill: { kind: "picture", mode: "stretch" } }, image },
      context
    );
    const archive = await readPackage(changed.bytes, context);
    expect(archive.get("/ppt/media/image1.png")).toEqual(image);
    const index = await readSelectionIndex(changed.bytes, context);
    expect(
      index.inventory.relationships.some(
        (r) =>
          r.owner === "/ppt/slides/slide1.xml" &&
          r.targetPart === "/ppt/media/image1.png" &&
          !r.external
      )
    ).toBe(true);
    const run = await fixture(shape.bytes);
    const result = await run([
      "shapes",
      "drawing",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel",
      "--fill-kind",
      "picture",
      "--mode",
      "stretch",
      "--file",
      "/tile.png",
      "--in-place"
    ]);
    expect(result.code, JSON.stringify(result.value)).toBe(0);
    const read = await run([
      "shapes",
      "drawing",
      "get",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel"
    ]);
    expect(read.value.data.records[0].drawing.fill.kind).toBe("picture");
  });
  it("round trips theme fill alpha and a simple shadow through public CLI", async () => {
    const input = await createPresentation({ slides: [{}] }, context);
    const shape = await addShape(
      input,
      {
        slide: 1,
        update: {
          kind: "RECTANGLE",
          name: "Panel",
          left: new Inches(1),
          top: new Inches(1),
          width: new Inches(2),
          height: new Inches(1)
        }
      },
      context
    );
    const run = await fixture(shape.bytes);
    const fill = await run([
      "shapes",
      "drawing",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel",
      "--fill",
      JSON.stringify({ kind: "solid", color: { theme: "accent2", opacity: 0.4 } }),
      "--in-place"
    ]);
    expect(fill.code, JSON.stringify(fill.value)).toBe(0);
    const shadow = await run([
      "shapes",
      "effects",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel",
      "--shadow",
      "true",
      "--opacity",
      "0.25",
      "--shadow-blur",
      "2pt",
      "--shadow-color",
      "112233",
      "--in-place"
    ]);
    expect(shadow.code, JSON.stringify(shadow.value)).toBe(0);
    expect(shadow.value.affected).toBe(1);
    const effectSchema = await run(["schema", "shapes", "effects", "set"]);
    expect(
      compileJsonSchema(effectSchema.value.data.operations["shapes.effects.set"].result).validate(
        shadow.value
      ).ok
    ).toBe(true);
    const read = await run([
      "shapes",
      "drawing",
      "get",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel"
    ]);
    expect(read.code, JSON.stringify(read.value)).toBe(0);
    const readSchema = await run(["schema", "shapes", "drawing", "get"]);
    expect(
      compileJsonSchema(readSchema.value.data.operations["shapes.drawing.get"].result).validate(
        read.value
      ).ok
    ).toBe(true);
    expect(read.value.data.records[0].drawing.fill).toMatchObject({
      kind: "solid",
      color: { theme: "accent2", opacity: 0.4 }
    });
  });
});
