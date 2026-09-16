import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { addShape } from "./shape-operations.js";
import { Length } from "./length.js";
import { loadShared, required } from "./masters.js";
import { Shape } from "./shapes.js";
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
it("sets normalized adjustments with the same schema and domain model as SDK edits", async () => {
  const fs = Volume.fromJSON({});
  const input = (
    await addShape(
      await createPresentation({ slides: [{}] }, context),
      {
        slide: 1,
        update: {
          kind: "CHEVRON",
          name: "Arrow",
          left: new Length(0),
          top: new Length(0),
          width: new Length(1000),
          height: new Length(1000)
        }
      },
      context
    )
  ).bytes;
  fs.writeFileSync("/deck.pptx", input);
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  const run = async (args: string[]) =>
    engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
      publishOutput: async (request) => {
        if (!request.dryRun) fs.writeFileSync(request.outputPath, request.bytes);
      }
    });
  const changed = await run([
    "shapes",
    "set",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Arrow",
    "--adjustments",
    "[0.31]",
    "--in-place",
    "--json"
  ]);
  expect(changed.exitCode, new TextDecoder().decode(changed.stdout)).toBe(0);
  const result = JSON.parse(new TextDecoder().decode(changed.stdout));
  expect(result).toMatchObject({ operation: "shapes.set", affected: 1, ok: true });
  const state = await loadShared(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer), context);
  const doc = state.doc(state.index.inventory.slides[0]!.part);
  const shape = required(required(doc.root, "cSld"), "spTree").children.find(
    (node) => node.name.localName === "sp"
  )!;
  expect(new Shape(doc.subtree(shape)).adjustments[0]).toBe(0.31);
  const schema = JSON.parse(
    new TextDecoder().decode((await run(["schema", "shapes", "set", "--json"])).stdout)
  ).data.operations["shapes.set"];
  const validate = compileJsonSchema(schema.options);
  expect(
    validate.validate({ slide: 1, shape: "Arrow", adjustments: [0.31], inPlace: true }).ok
  ).toBe(true);
  const before = fs.readFileSync("/deck.pptx");
  for (const value of ["[null]", '["0.2"]', "{}"]) {
    const rejected = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Arrow",
      "--adjustments",
      value,
      "--in-place",
      "--json"
    ]);
    expect(rejected.exitCode).toBe(2);
    expect(fs.readFileSync("/deck.pptx")).toEqual(before);
  }
});
