import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { getXmlPart } from "./xml-parts.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
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
async function fixture() {
  const bytes = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "雪 café 雪" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    volume,
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
describe("run formatting commands", () => {
  it("writes explicit font attributes through the command", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "runs",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Caption",
      "--paragraph",
      "1",
      "--run",
      "1",
      "--font",
      "Example Sans",
      "--size",
      "18pt",
      "--bold",
      "false",
      "--italic",
      "null",
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(out.exitCode, decode(out.stdout) + decode(out.stderr)).toBe(0);
    const xml = (
      await getXmlPart(
        new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
        "/ppt/slides/slide1.xml",
        context
      )
    ).xml;
    expect(xml).toContain('sz="1800"');
    expect(xml).toContain('b="0"');
    expect(xml).toContain('typeface="Example Sans"');
  });
  it.each([
    ["--size", "0pt"],
    ["--bold", "yes"],
    ["--run", "0"],
    ["--baseline", "101"]
  ])("rejects invalid formatting %j before reading", async (...flags) => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "runs",
      "set",
      "/deck.pptx",
      ...flags,
      "--all",
      "--dry-run",
      "--json"
    ]);
    expect(out.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("advertises a closed formatting schema", async () => {
    const f = await fixture();
    const out = await f.run(["schema", "text", "runs", "set", "--json"]);
    expect(out.exitCode).toBe(0);
    const schema = JSON.parse(decode(out.stdout)).data.operations["text.runs.set"];
    const options = compileJsonSchema(schema.options);
    expect(options.validate({ bold: false, italic: null, all: true, dryRun: true }).ok).toBe(true);
    expect(options.validate({ bold: "yes", all: true, dryRun: true }).ok).toBe(false);
    expect(options.validate({ all: true, dryRun: true }).ok).toBe(false);
  });
});

it("reads direct run formatting through the public command without publication", async () => {
  const f = await fixture();
  const out = await f.run([
    "text",
    "runs",
    "get",
    "/deck.pptx",
    "--slide",
    "1",
    "--shape",
    "Caption",
    "--paragraph",
    "1",
    "--run",
    "1",
    "--json"
  ]);
  expect(out.exitCode, decode(out.stdout)).toBe(0);
  const result = JSON.parse(decode(out.stdout));
  expect(result.data.runs).toHaveLength(1);
  expect(result.data.runs[0]).toMatchObject({
    paragraph: 0,
    run: 0,
    coordinateSystem: "zero-based",
    formatting: { bold: null, italic: null, font: null }
  });
  expect(f.publishOutput).not.toHaveBeenCalled();
  const schema = JSON.parse(
    decode((await f.run(["schema", "text", "runs", "get", "--json"])).stdout)
  ).data.operations["text.runs.get"];
  expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
});

it.each(["--paragraph", "--run"])("rejects null %s before acquiring input", async (flag) => {
  const f = await fixture();
  const out = await f.run(["text", "runs", "get", "/deck.pptx", flag, "null", "--json"]);
  expect(out.exitCode).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});
it("accepts numeric and symbolic underline enum values", async () => {
  for (const value of ["3", "DOUBLE_LINE"]) {
    const f = await fixture();
    const out = await f.run([
      "text",
      "runs",
      "set",
      "/deck.pptx",
      "--all",
      "--underline",
      value,
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(out.exitCode, decode(out.stdout)).toBe(0);
    expect(
      (
        await getXmlPart(
          new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
          "/ppt/slides/slide1.xml",
          context
        )
      ).xml
    ).toContain('u="dbl"');
  }
});

it("lists empty selections but fails missing run get", async () => {
  const f = await fixture();
  const missing = await f.run(["text", "runs", "get", "/deck.pptx", "--run", "9", "--json"]);
  expect(missing.exitCode).toBe(1);
  const listed = await f.run(["text", "runs", "list", "/deck.pptx", "--run", "9", "--json"]);
  expect(listed.exitCode, decode(listed.stdout)).toBe(0);
  expect(JSON.parse(decode(listed.stdout)).data.runs).toEqual([]);
});

it("requires an explicit formatting selection before reading", async () => {
  const f = await fixture();
  const out = await f.run([
    "text",
    "runs",
    "set",
    "/deck.pptx",
    "--bold",
    "false",
    "--dry-run",
    "--json"
  ]);
  expect(out.exitCode).toBe(1);
  expect(f.readInput).not.toHaveBeenCalled();
});

it("shows scoped run help without input acquisition", async () => {
  const f = await fixture();
  const out = await f.run(["text", "runs", "set", "--help"]);
  expect(out.exitCode).toBe(0);
  expect(decode(out.stdout)).toContain("--highlight");
  expect(decode(out.stdout)).toContain("--paragraph");
  expect(f.readInput).not.toHaveBeenCalled();
});
