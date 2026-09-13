import { Volume } from "memfs";
import { beforeAll, afterAll, vi, it, expect } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation, createPptxCommandEngine } from "./index.js";
import type { PptxCommandEngineOptions } from "./command-engine.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
async function fixture(engineContext: PptxCommandEngineOptions["context"] = context) {
  const volume = Volume.fromJSON({});
  for (const [name, text] of [
    ["left", "Harbor"],
    ["right", "Meadow"]
  ] as const)
    volume.writeFileSync(
      `/${name}.pptx`,
      await createPresentation(
        { slides: [{ shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text }] }] },
        context
      )
    );
  volume.writeFileSync("/bad.pptx", "invalid");
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn();
  const engine = createPptxCommandEngine({
    context: engineContext,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  const run = async (args: string[], signal = new AbortController().signal) => {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      readInput,
      publishOutput,
      signal
    });
    return {
      ...result,
      text: new TextDecoder().decode(result.stdout),
      error: new TextDecoder().decode(result.stderr)
    };
  };
  return { run, readInput, publishOutput, volume };
}
it("represents equal and different comparisons as successful data", async () => {
  const f = await fixture();
  const equal = await f.run(["diff", "/left.pptx", "/left.pptx", "--json"]);
  expect(equal.exitCode, equal.text).toBe(0);
  expect(JSON.parse(equal.text)).toMatchObject({
    operation: "diff",
    ok: true,
    affected: 0,
    data: { equal: true, mode: "structural", formatting: "raw", changes: [] }
  });
  const different = await f.run(["diff", "/left.pptx", "/right.pptx", "--mode", "text", "--json"]);
  expect(different.exitCode, different.text).toBe(1);
  expect(JSON.parse(different.text)).toMatchObject({
    ok: true,
    data: { equal: false, mode: "text", changes: [{ category: "text", kind: "changed" }] }
  });
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it.each([
  ["/bad.pptx", "/left.pptx"],
  ["/missing.pptx", "/left.pptx"],
  ["/left.pptx", "/right.pptx", "--mode", "effective-formatting"],
  ["/left.pptx", "/right.pptx", "--limit", "maxBytes=4"]
])("uses comparison trouble status with detailed diagnostic: %j", async (...args) => {
  const f = await fixture();
  const result = await f.run(["diff", ...args, "--json"]);
  expect(result.exitCode, result.text).toBe(2);
  expect(JSON.parse(result.text)).toMatchObject({
    operation: "diff",
    ok: false,
    data: null,
    affected: 0
  });
  expect(JSON.parse(result.text).errors[0].code).toBeTruthy();
});
it.each([
  ["-", "-"],
  ["/left.pptx"],
  ["/left.pptx", "/right.pptx", "--mode", "visual"],
  ["/left.pptx", "/right.pptx", "--output", "out.pptx"],
  ["/left.pptx", "/right.pptx", "--mode", "text", "--mode", "raw"]
])("rejects invalid comparison options before I/O: %j", async (...args) => {
  const f = await fixture();
  expect((await f.run(["diff", ...args, "--json"])).exitCode).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});

it("applies a lowered byte limit to expanded XML during comparison", async () => {
  const f = await fixture();
  const authored = await createPresentation(
    {
      slides: [
        {
          shapes: [
            {
              name: "Caption",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              text: "Coastal survey. ".repeat(300)
            }
          ]
        }
      ]
    },
    context
  );
  const archive = await readPackage(authored, context);
  const compressed = await writePackageArchive(
    archive.names.map((name) => ({ name: name.slice(1), bytes: archive.get(name) })),
    context,
    { compression: "auto" }
  );
  const limit = compressed.length;
  expect(limit).toBeLessThan(archive.get("/ppt/slides/slide1.xml").length);
  f.volume.writeFileSync("/compressed.pptx", compressed);
  const result = await f.run([
    "diff",
    "/compressed.pptx",
    "/compressed.pptx",
    "--limit",
    `maxBytes=${limit}`,
    "--json"
  ]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.text)).toMatchObject({
    ok: false,
    data: null,
    errors: [{ code: "resource-limit" }]
  });
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it("discovers the comparison schema and explicit formatting support", async () => {
  const f = await fixture();
  const schema = await f.run(["schema", "diff", "--json"]);
  expect(schema.exitCode).toBe(0);
  const definition = JSON.parse(schema.text).data.operations.diff;
  const comparison = await f.run(["diff", "/left.pptx", "/right.pptx", "--mode", "text", "--json"]);
  expect(compileJsonSchema(definition.result).validate(JSON.parse(comparison.text)).ok).toBe(true);
  expect(
    compileJsonSchema(definition.options).validate({ mode: "text", limit: { maxBytes: 1000 } }).ok
  ).toBe(true);
  expect(compileJsonSchema(definition.options).validate({ mode: "visual" }).ok).toBe(false);
  expect(JSON.parse(schema.text).data.operations.diff.options.properties.mode.enum).toEqual([
    "structural",
    "text",
    "media",
    "relationships",
    "effective-formatting",
    "raw"
  ]);
  expect((await f.run(["help", "diff"])).text).toContain(
    "0 equal, 1 different, 2 trouble, 130 cancelled"
  );
  const capabilities = JSON.parse((await f.run(["capabilities", "--json"])).text).data.features;
  expect(capabilities.diff.level).toBe("read");
  expect(capabilities.effectiveFormattingDiff.level).toBe("reject");
});
it("preserves cancellation status and bounded output", async () => {
  const f = await fixture();
  const abort = new AbortController();
  abort.abort();
  expect(
    (await f.run(["diff", "/left.pptx", "/right.pptx", "--json"], abort.signal)).exitCode
  ).toBe(130);
  const limited = await f.run([
    "diff",
    "/left.pptx",
    "/right.pptx",
    "--json",
    "--limit",
    "maxOutputBytes=512"
  ]);
  expect(limited.exitCode).toBe(2);
  expect(JSON.parse(limited.text).errors[0].code).toBe("resource-limit");
});

it("rejects unavailable effective formatting before input admission and accepts short help", async () => {
  const f = await fixture();
  const result = await f.run([
    "diff",
    "/left.pptx",
    "/right.pptx",
    "--mode",
    "effective-formatting",
    "--json"
  ]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.text).errors[0].code).toBe("unsupported-profile");
  expect(f.readInput).not.toHaveBeenCalled();
  expect((await f.run(["diff", "-h"])).text).toContain("Usage: pptx diff");
});

it.each([
  { limit: "maxBytes=8193", engineContext: context },
  ...["maxBytes=8192", "maxNodes=1000", "maxDepth=32"].map((limit) => ({
    limit,
    engineContext: {
      ...context,
      validationLimits: {
        maxBytes: 8191,
        maxNodes: 999,
        maxDepth: 31,
        maxParts: 32,
        maxRelationships: 64
      }
    }
  }))
])(
  "rejects comparison limits exceeding trusted XML or validation ceilings: $limit",
  async ({ limit, engineContext }) => {
    const f = await fixture(engineContext);
    const result = await f.run(["diff", "/left.pptx", "/right.pptx", "--limit", limit, "--json"]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.text)).toMatchObject({
      operation: "diff",
      ok: false,
      data: null,
      errors: [{ code: "invalid-value", context: { phase: "usage" } }]
    });
    expect(f.readInput).not.toHaveBeenCalled();
  }
);
