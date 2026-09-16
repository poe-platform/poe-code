import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";

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
let original: Promise<Uint8Array> | undefined;
async function fixture() {
  original ??= createPresentation(
    {
      slides: [
        { shapes: [{ x: 100, y: 200, width: 300, height: 400, text: "Canvas stays independent" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", await original);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (publication: PptxPublicationRequest) => {
    if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
  });
  return {
    volume,
    readInput,
    publishOutput,
    async run(args: string[]) {
      const result = await engine.execute({
        args: [...args, "--json"].map((value) => new TextEncoder().encode(value)),
        signal: new AbortController().signal,
        readInput,
        publishOutput
      });
      return { ...result, envelope: JSON.parse(new TextDecoder().decode(result.stdout)) };
    }
  };
}

describe("theme and background commands", () => {
  it("changes a shared palette through the CLI and publishes valid package XML", async () => {
    const f = await fixture();
    const result = await f.run([
      "themes",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--slide",
      "1",
      "--color-slot",
      "accent1",
      "--color",
      "123456",
      "--in-place"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const theme = new TextDecoder().decode(
      entries.find((entry) => entry.name === "ppt/theme/theme1.xml")!.payload
    );
    expect(theme).toContain('val="123456"');
    expect(result.envelope.data.affectedSlides).toEqual([1]);
  });
  it("edits one slide gradient and advertises the structured options", async () => {
    const f = await fixture();
    const result = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "gradient",
      "--stops",
      '[{"position":0,"color":"112233"},{"position":1,"color":"CCDDEE"}]',
      "--angle",
      "45",
      "--in-place"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    const slide = new TextDecoder().decode(
      entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
    );
    expect(slide).toContain('ang="2700000"');
    expect(slide).toContain('val="CCDDEE"');
    const schema = await f.run(["schema", "backgrounds", "set"]);
    expect(
      compileJsonSchema(schema.envelope.data.operations["backgrounds.set"].options).validate({
        slide: 1,
        kind: "gradient",
        stops: [
          { position: 0, color: "112233" },
          { position: 1, color: "CCDDEE" }
        ],
        angle: 45,
        inPlace: true
      }).ok
    ).toBe(true);
  });
  it("lists and gets theme and background records with schemas matching responses", async () => {
    const f = await fixture();
    for (const family of ["themes", "backgrounds"]) {
      for (const action of ["list", "get"]) {
        const result = await f.run([family, action, "/deck.pptx", "--slide", "1"]);
        expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
        expect(result.envelope.data.records).toHaveLength(
          family === "backgrounds" && action === "get" ? 0 : 1
        );
        const schema = await f.run(["schema", family, action]);
        expect(
          compileJsonSchema(schema.envelope.data.operations[`${family}.${action}`].result).validate(
            result.envelope
          ).ok
        ).toBe(true);
      }
    }
    const shared = await f.run([
      "backgrounds",
      "get",
      "/deck.pptx",
      "--scope",
      "shared",
      "--part",
      "/ppt/slideMasters/slideMaster1.xml"
    ]);
    expect(shared.exitCode, JSON.stringify(shared.envelope)).toBe(0);
    expect(shared.envelope.data.records).toEqual([]);
  });
  it("publishes shared fonts and an explicit background style reference", async () => {
    const f = await fixture();
    const font = await f.run([
      "themes",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--slide",
      "1",
      "--font-slot",
      "majorLatin",
      "--font",
      "Cedar Sans",
      "--in-place"
    ]);
    expect(font.exitCode, JSON.stringify(font.envelope)).toBe(0);
    const result = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "style-reference",
      "--style-index",
      "1001",
      "--style-color",
      "ABCDEF",
      "--in-place"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    expect(
      new TextDecoder().decode(
        entries.find((entry) => entry.name === "ppt/theme/theme1.xml")!.payload
      )
    ).toContain('typeface="Cedar Sans"');
    expect(
      new TextDecoder().decode(
        entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!.payload
      )
    ).toContain('idx="1001"');
  });
  it("reads picture input once and protects its publication path", async () => {
    const f = await fixture();
    const picture = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 16, 75, 89, 245, 31, 0, 3,
      220, 2, 36, 111, 54, 106, 177, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ]);
    f.volume.writeFileSync("/image.png", picture);
    const result = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "picture",
      "--file",
      "/image.png",
      "--in-place"
    ]);
    expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
    expect(f.readInput.mock.calls.filter(([path]) => path === "/image.png")).toHaveLength(1);
    expect(f.publishOutput.mock.calls[0]![0].protectedInputPaths).toEqual(["/image.png"]);
    const entries = inspectZip(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer));
    expect(entries.find((entry) => entry.name === "ppt/media/image1.png")!.payload).toEqual(
      picture
    );
  });
  it("rejects unknown theme slots before admitting an input", async () => {
    const f = await fixture();
    const result = await f.run([
      "themes",
      "set",
      "/deck.pptx",
      "--scope",
      "shared",
      "--color-slot",
      "unknown",
      "--color",
      "123456",
      "--in-place"
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it.each([
    ["--kind", "constructor", "--slide", "1"],
    ["--kind", "solid", "--color", "112233", "--file", "/image.png", "--slide", "1"],
    ["--kind", "inherit", "--color", "112233", "--slide", "1"],
    ["--kind", "inherit", "--scope", "shared", "--all"],
    ["--kind", "inherit"],
    ["--kind", "inherit", "--scope", "notes", "--slide", "1"]
  ])("rejects contradictory or unscoped background fields %j", async (...fields) => {
    const f = await fixture();
    const result = await f.run(["backgrounds", "set", "/deck.pptx", ...fields, "--in-place"]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("rejects theme mutation without shared scope and missing picture resources without publication", async () => {
    const f = await fixture();
    const theme = await f.run([
      "themes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--color-slot",
      "accent1",
      "--color",
      "123456",
      "--in-place"
    ]);
    expect(theme.exitCode).toBe(2);
    const picture = await f.run([
      "backgrounds",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "picture",
      "--file",
      "/missing.png",
      "--in-place"
    ]);
    expect(picture.exitCode).not.toBe(0);
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
});
