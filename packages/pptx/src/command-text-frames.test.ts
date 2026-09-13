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
describe("text frame commands", () => {
  it.each(["just", "dist"])(
    "admits preserved anchor %s in read results but rejects writes",
    async (anchor) => {
      const f = await fixture();
      const read = JSON.parse(
        decode((await f.run(["text", "frames", "get", "/deck.pptx", "--json"])).stdout)
      );
      read.data.frames[0].formatting.verticalAnchor = anchor;
      const schemas = {
        ...JSON.parse(decode((await f.run(["schema", "text", "frames", "get", "--json"])).stdout))
          .data.operations,
        ...JSON.parse(decode((await f.run(["schema", "text", "frames", "set", "--json"])).stdout))
          .data.operations
      };
      expect(compileJsonSchema(schemas["text.frames.get"].result).validate(read).ok).toBe(true);
      expect(
        compileJsonSchema(schemas["text.frames.set"].options).validate({
          all: true,
          dryRun: true,
          verticalAnchor: anchor
        }).ok
      ).toBe(false);
      const write = await f.run([
        "text",
        "frames",
        "set",
        "/deck.pptx",
        "--all",
        "--vertical-anchor",
        anchor,
        "--dry-run"
      ]);
      expect(write.exitCode).toBe(2);
    }
  );
  it("clears direct metadata while replacing Unicode text and retains omitted values", async () => {
    const f = await fixture();
    const first = await f.run([
      "text",
      "frames",
      "set",
      "/deck.pptx",
      "--all",
      "--wrap",
      "false",
      "--columns",
      "2",
      "--autofit",
      "text",
      "--output",
      "/out.pptx"
    ]);
    expect(first.exitCode, decode(first.stderr)).toBe(0);
    const second = await f.run([
      "text",
      "frames",
      "set",
      "/out.pptx",
      "--all",
      "--wrap",
      "null",
      "--autofit",
      "null",
      "--text",
      "Cove 雪\nDepth\vCurrent",
      "--in-place"
    ]);
    expect(second.exitCode, decode(second.stderr)).toBe(0);
    const xml = (
      await getXmlPart(
        new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
        "/ppt/slides/slide1.xml",
        context
      )
    ).xml;
    expect(xml).not.toContain("wrap=");
    expect(xml).not.toContain("normAutofit");
    expect(xml).toContain('numCol="2"');
    expect(xml).toContain("Cove 雪");
    expect(xml).toContain("Depth");
    expect(xml).toContain("Current");
    expect(xml).not.toContain("café");
  });
  it("writes explicit frame metadata and reads its normalized values", async () => {
    const f = await fixture();
    const changed = await f.run([
      "text",
      "frames",
      "set",
      "/deck.pptx",
      "--all",
      "--margin-left",
      "0pt",
      "--margin-right",
      "1in",
      "--margin-top",
      "2pt",
      "--margin-bottom",
      "3pt",
      "--vertical-anchor",
      "middle",
      "--columns",
      "16",
      "--wrap",
      "false",
      "--vertical-text",
      "vert270",
      "--rotation",
      "-45.5",
      "--autofit",
      "text",
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(changed.exitCode, decode(changed.stdout) + decode(changed.stderr)).toBe(0);
    const xml = (
      await getXmlPart(
        new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
        "/ppt/slides/slide1.xml",
        context
      )
    ).xml;
    for (const value of [
      'lIns="0"',
      'rIns="914400"',
      'tIns="25400"',
      'bIns="38100"',
      'anchor="ctr"',
      'numCol="16"',
      'wrap="none"',
      'vert="vert270"',
      'rot="-2730000"',
      "normAutofit"
    ])
      expect(xml).toContain(value);
    const read = await f.run(["text", "frames", "get", "/out.pptx", "--json"]);
    const data = JSON.parse(decode(read.stdout));
    expect(data.data.frames[0].formatting).toMatchObject({
      marginLeft: 0,
      marginRight: 72,
      verticalAnchor: "middle",
      columns: 16,
      wrap: false,
      verticalText: "vert270",
      rotation: -45.5,
      autofit: "text"
    });
    const schema = JSON.parse(
      decode((await f.run(["schema", "text", "frames", "get", "--json"])).stdout)
    ).data.operations["text.frames.get"];
    expect(compileJsonSchema(schema.result).validate(data).ok).toBe(true);
    expect(f.volume.readFileSync("/deck.pptx")).toEqual(Buffer.from(f.bytes));
  });
  it.each([
    ["--columns", "0"],
    ["--columns", "17"],
    ["--columns", "1.5"],
    ["--wrap", "yes"],
    ["--margin-left", "-999999pt"],
    ["--rotation", "0x20"],
    ["--rotation", " 2 "],
    ["--rotation", "NaN"],
    ["--vertical-anchor", "center"],
    ["--vertical-text", "sideways"],
    ["--autofit", "measure"],
    ["--size", "12pt"]
  ])("rejects invalid frame option %s before reading", async (...flags) => {
    const f = await fixture();
    const result = await f.run([
      "text",
      "frames",
      "set",
      "/deck.pptx",
      "--all",
      "--dry-run",
      ...flags
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("exposes closed schemas and frame-scoped help", async () => {
    const f = await fixture();
    const output = await f.run(["schema", "text", "frames", "set", "--json"]);
    expect(output.exitCode).toBe(0);
    const schema = compileJsonSchema(
      JSON.parse(decode(output.stdout)).data.operations["text.frames.set"].options
    );
    expect(schema.validate({ all: true, dryRun: true, marginLeft: 0, wrap: null }).ok).toBe(true);
    expect(schema.validate({ all: true, dryRun: true }).ok).toBe(false);
    expect(schema.validate({ all: true, dryRun: true, autofit: "text", metrics: {} }).ok).toBe(
      false
    );
    expect(decode((await f.run(["text", "frames", "set", "--help"])).stdout)).toContain(
      "--vertical-text"
    );
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("supports empty collection reads and explicit empty mutations", async () => {
    const f = await fixture();
    const list = await f.run([
      "text",
      "frames",
      "list",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "absent",
      "--json"
    ]);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(decode(list.stdout)).data.frames).toEqual([]);
    expect(
      (await f.run(["text", "frames", "get", "/deck.pptx", "--slide", "1", "--shape", "absent"]))
        .exitCode
    ).toBe(1);
    const empty = await f.run([
      "text",
      "frames",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "absent",
      "--autofit",
      "none",
      "--allow-empty",
      "--dry-run",
      "--json"
    ]);
    expect(empty.exitCode, decode(empty.stdout)).toBe(0);
    expect(JSON.parse(decode(empty.stdout)).affected).toBe(0);
  });
});
