import { Volume } from "memfs";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation, fitTextFrames, admitFontMetrics } from "./index.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { inspectZip } from "../tests/zip-reader.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
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
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 32,
    maxParts: 32,
    maxRelationships: 64,
    maxEntries: 32
  }
};
const metricData = {
  family: "Calibri",
  bold: false,
  italic: false,
  unitsPerEm: 10,
  lineHeight: 10,
  advances: { A: 5, " ": 2 }
};
async function fixture() {
  const bytes = await createPresentation(
    {
      slides: [
        {
          shapes: [
            { name: "Caption", x: 0, y: 0, width: 487680, height: 599440, text: "AA AA" },
            { name: "Unchanged", x: 0, y: 100, width: 1270000, height: 1270000, text: "Elsewhere" }
          ]
        }
      ]
    },
    context
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => {
    if (!p.dryRun) fs.writeFileSync(p.outputPath, p.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    fs,
    bytes,
    readInput,
    publishOutput,
    run: (args: string[]) =>
      engine.execute({
        args: args.map(encode),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      })
  };
}
it("fits through the public SDK and command with equal bytes and independent expected size", async () => {
  const f = await fixture();
  const sdk = await fitTextFrames(
    f.bytes,
    {
      metrics: admitFontMetrics(metricData),
      maxSize: 40,
      select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
      shape: "Caption"
    },
    context
  );
  expect(sdk.sizes).toEqual([20]);
  const result = await f.run([
    "text",
    "fit",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Caption",
    "--metrics",
    JSON.stringify(metricData),
    "--max-size",
    "40",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(result.exitCode, decode(result.stdout) + decode(result.stderr)).toBe(0);
  expect(JSON.parse(decode(result.stdout))).toMatchObject({
    version: 1,
    operation: "text.fit",
    ok: true,
    affected: 1,
    data: { sizes: [20], dryRun: false }
  });
  expect(f.fs.readFileSync("/out.pptx")).toEqual(Buffer.from(sdk.bytes));
  const entries = inspectZip(sdk.bytes);
  expect(decode(entries.find((e) => e.name === "ppt/slides/slide1.xml")!.payload)).toContain(
    'sz="2000"'
  );
  for (const entry of inspectZip(f.bytes).filter((e) => e.name !== "ppt/slides/slide1.xml"))
    expect(entries.find((e) => e.name === entry.name)?.payload).toEqual(entry.payload);
  expect(f.fs.readFileSync("/deck.pptx")).toEqual(Buffer.from(f.bytes));
});
it("fails missing metrics and impossible bounds without publication and separates metadata autofit", async () => {
  const f = await fixture();
  for (const flags of [
    [],
    ["--metrics", JSON.stringify(metricData), "--min-size", "30", "--max-size", "40"],
    ["--metrics", JSON.stringify(metricData), "--font-family", "Missing"]
  ]) {
    const result = await f.run([
      "text",
      "fit",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Caption",
      "--output",
      "/fail.pptx",
      ...flags
    ]);
    expect(result.exitCode).not.toBe(0);
  }
  expect(f.publishOutput).not.toHaveBeenCalled();
  const metadata = await f.run([
    "text",
    "frames",
    "set",
    "/deck.pptx",
    "--all",
    "--autofit",
    "text",
    "--dry-run"
  ]);
  expect(metadata.exitCode).toBe(0);
});
it("discovers closed fitting schemas and validates dry-run output", async () => {
  const f = await fixture();
  const schemaResult = await f.run(["schema", "text", "fit", "--json"]);
  expect(schemaResult.exitCode).toBe(0);
  const schema = JSON.parse(decode(schemaResult.stdout)).data.operations["text.fit"];
  const valid = {
    metrics: metricData,
    all: true,
    dryRun: true,
    minSize: 1,
    maxSize: 40,
    wrap: false,
    lineSpacing: 1.5
  };
  expect(compileJsonSchema(schema.options).validate(valid).ok).toBe(true);
  expect(compileJsonSchema(schema.options).validate({ ...valid, ignored: true }).ok).toBe(false);
  expect(compileJsonSchema(schema.options).validate({ ...valid, metrics: undefined }).ok).toBe(
    false
  );
  const result = await f.run([
    "text",
    "fit",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Caption",
    "--metrics",
    JSON.stringify(metricData),
    "--wrap",
    "false",
    "--line-spacing",
    "2",
    "--margin-left",
    "7.2pt",
    "--dry-run",
    "--json"
  ]);
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(result.stdout))).ok).toBe(
    true
  );
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(decode((await f.run(["text", "fit", "--help"])).stdout)).toContain("--metrics");
  expect(decode((await f.run(["capabilities", "--json"])).stdout)).toContain("text.fit");
});
it("reports fit usage errors with the fit operation and never reads input", async () => {
  const f = await fixture();
  const result = await f.run([
    "text",
    "fit",
    "/deck.pptx",
    "--metrics",
    "{}",
    "--all",
    "--dry-run",
    "--json"
  ]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(decode(result.stdout)).operation).toBe("text.fit");
  expect(f.readInput).not.toHaveBeenCalled();
});
it("does not publish partial fits when a later frame has missing glyphs", async () => {
  const f = await fixture();
  const result = await f.run([
    "text",
    "fit",
    "/deck.pptx",
    "--metrics",
    JSON.stringify(metricData),
    "--all",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(result.exitCode).toBe(1);
  expect(f.publishOutput).not.toHaveBeenCalled();
  expect(f.fs.readFileSync("/deck.pptx")).toEqual(Buffer.from(f.bytes));
});
it("identifies the required metric input explicitly", async () => {
  const f = await fixture();
  const result = await f.run(["text", "fit", "/deck.pptx", "--all", "--dry-run"]);
  expect(result.exitCode).toBe(2);
  expect(decode(result.stderr)).toContain("requires --metrics JSON");
});
