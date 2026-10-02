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
describe("paragraph formatting commands", () => {
  it("writes zero margins, numbered direction and tab stops with explicit units", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "paragraphs",
      "set",
      "/deck.pptx",
      "--all",
      "--alignment",
      "right",
      "--margin-left",
      "0pt",
      "--indent",
      "-6pt",
      "--space-before",
      "0pt",
      "--line-spacing",
      "1.5",
      "--rtl",
      "true",
      "--bullet",
      '{"kind":"numbered","scheme":"arabicPeriod","startAt":2}',
      "--tabs",
      '[{"position":24,"alignment":"decimal"}]',
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
    expect(xml).toContain('marL="0"');
    expect(xml).toContain('indent="-76200"');
    expect(xml).toContain('rtl="1"');
    expect(xml).toContain('val="150000"');
    expect(xml).toContain('pos="304800"');
    expect(xml).toContain('startAt="2"');
    const read = await f.run([
      "text",
      "paragraphs",
      "get",
      "/out.pptx",
      "--paragraph",
      "1",
      "--json"
    ]);
    expect(read.exitCode, decode(read.stdout)).toBe(0);
    const data = JSON.parse(decode(read.stdout));
    expect(data.data.paragraphs[0].formatting).toMatchObject({
      marginLeft: 0,
      indent: -6,
      rtl: true
    });
    const schema = JSON.parse(
      decode((await f.run(["schema", "text", "paragraphs", "get", "--json"])).stdout)
    ).data.operations["text.paragraphs.get"];
    expect(compileJsonSchema(schema.result).validate(data).ok).toBe(true);
    const cleared = await f.run([
      "text",
      "paragraphs",
      "set",
      "/out.pptx",
      "--all",
      "--margin-left",
      "null",
      "--in-place",
      "--json"
    ]);
    expect(cleared.exitCode, decode(cleared.stdout)).toBe(0);
    const clearedXml = (
      await getXmlPart(
        new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
        "/ppt/slides/slide1.xml",
        context
      )
    ).xml;
    expect(clearedXml).not.toContain("marL=");
    expect(clearedXml).toContain('indent="-76200"');
  });
  it("accepts ordinary bullet, direction, numbering and explicit tab lengths", async () => {
    const f = await fixture();
    for (const flags of [
      ["--bullet", "•", "--direction", "ltr"],
      ["--numbering", "lower-roman", "--direction", "rtl"],
      ["--numbering", "none"],
      ["--numbering", "null"],
      ["--direction", "null"]
    ]) {
      const result = await f.run([
        "text",
        "paragraphs",
        "set",
        "/deck.pptx",
        "--all",
        ...flags,
        "--tabs",
        '[{"value":0,"unit":"pt"},{"position":{"value":1,"unit":"in"},"alignment":"right"}]',
        "--output",
        "/out.pptx",
        "--force",
        "--json"
      ]);
      expect(result.exitCode, decode(result.stdout)).toBe(0);
      const xml = (
        await getXmlPart(
          new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
          "/ppt/slides/slide1.xml",
          context
        )
      ).xml;
      expect(xml).toContain('pos="0"');
      expect(xml).toContain('pos="914400"');
      if (flags[1] === "lower-roman") expect(xml).toContain('type="romanLcPeriod"');
      if (flags[1] === "•") expect(xml).toContain('char="•"');
    }
  });
  it.each([
    ["--direction", "rtl", "--rtl", "false"],
    ["--rtl", "true", "--direction", "ltr"],
    ["--bullet", "•", "--numbering", "decimal"],
    ["--numbering", "none", "--bullet", "•"]
  ])("rejects conflicting projections before reading", async (...flags) => {
    const f = await fixture();
    const result = await f.run([
      "text",
      "paragraphs",
      "set",
      "/deck.pptx",
      "--all",
      "--dry-run",
      ...flags
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it.each([
    ["--paragraph", "0"],
    ["--rtl", "yes"],
    ["--level", "9"],
    ["--space-before", "-1pt"],
    ["--alignment", "diagonal"],
    ["--level", ""],
    ["--line-spacing", "0x10"],
    ["--line-spacing", " 1 "]
  ])("rejects invalid option %s before reading", async (...flags) => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "paragraphs",
      "set",
      "/deck.pptx",
      "--all",
      "--dry-run",
      "--json",
      ...flags
    ]);
    expect(out.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("rounds tiny numeric JSON lengths once even when JS uses exponent notation", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "paragraphs",
      "set",
      "/deck.pptx",
      "--all",
      "--dry-run",
      "--tabs",
      '[{"value":0.0000001,"unit":"pt"}]'
    ]);
    expect(out.exitCode, decode(out.stderr)).toBe(0);
  });
  it("rejects tab positions colliding after EMU rounding before input admission", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "paragraphs",
      "set",
      "/deck.pptx",
      "--all",
      "--dry-run",
      "--tabs",
      '[{"value":0,"unit":"pt"},{"value":0.00001,"unit":"pt"}]'
    ]);
    expect(out.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("exposes closed schemas, scoped help and empty read semantics", async () => {
    const f = await fixture();
    const output = await f.run(["schema", "text", "paragraphs", "set", "--json"]);
    expect(output.exitCode).toBe(0);
    const schema = compileJsonSchema(
      JSON.parse(decode(output.stdout)).data.operations["text.paragraphs.set"].options
    );
    expect(schema.validate({ marginLeft: 0, rtl: null, all: true, dryRun: true }).ok).toBe(true);
    expect(schema.validate({ all: true, dryRun: true }).ok).toBe(false);
    expect(schema.validate({ marginLeft: 0, surprise: true, all: true, dryRun: true }).ok).toBe(
      false
    );
    expect(decode((await f.run(["text", "paragraphs", "set", "--help"])).stdout)).toContain(
      "--line-spacing"
    );
    expect(f.readInput).not.toHaveBeenCalled();
    const listed = await f.run([
      "text",
      "paragraphs",
      "list",
      "/deck.pptx",
      "--paragraph",
      "9",
      "--json"
    ]);
    expect(JSON.parse(decode(listed.stdout)).data.paragraphs).toEqual([]);
    expect(
      (await f.run(["text", "paragraphs", "get", "/deck.pptx", "--paragraph", "9", "--json"]))
        .exitCode
    ).toBe(1);
  });
});
