import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { getXmlPart } from "./xml-parts.js";
import { readPresentationText } from "./text-reading.js";
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
describe("literal replacement commands", () => {
  it.each([
    ["--first", "海 café 雪", 1],
    ["--all", "海 café 海", 2],
    ["--occurrence", "雪 café 海", 1]
  ] as const)("applies explicit %s cardinality", async (mode, expected, affected) => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "雪",
      "--with",
      "海",
      mode,
      ...(mode === "--occurrence" ? ["2"] : []),
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(out.exitCode, decode(out.stdout) + decode(out.stderr)).toBe(0);
    expect(JSON.parse(decode(out.stdout))).toMatchObject({
      operation: "text.replace",
      ok: true,
      affected
    });
    expect(
      (
        await readPresentationText(
          new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
          {},
          context
        )
      ).text
    ).toBe(expected);
    expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.bytes);
  });
  it.each([[], ["--first", "--all"], ["--occurrence", "0"], ["--first", "--occurrence", "1"]])(
    "rejects invalid cardinality %j before reading",
    async (...mode) => {
      const f = await fixture();
      const out = await f.run([
        "text",
        "replace",
        "/deck.pptx",
        "--find",
        "雪",
        "--with",
        "海",
        ...mode,
        "--dry-run",
        "--json"
      ]);
      expect(out.exitCode).toBe(2);
      expect(f.readInput).not.toHaveBeenCalled();
    }
  );
  it("fails zero matches without publication and allows an explicit no-change dry-run", async () => {
    const f = await fixture();
    const args = [
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "absent",
      "--with",
      "",
      "--all",
      "--dry-run",
      "--json"
    ];
    const missing = await f.run(args);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(decode(missing.stdout))).toMatchObject({
      operation: "text.replace",
      ok: false,
      affected: 0
    });
    expect(f.publishOutput).not.toHaveBeenCalled();
    const allowed = await f.run([...args, "--allow-empty"]);
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(decode(allowed.stdout))).toMatchObject({
      operation: "text.replace",
      ok: true,
      affected: 0
    });
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("supports binary stdout and exact shape selection without emitting JSON", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "café",
      "--with",
      "tea",
      "--all",
      "--slide",
      "1",
      "--shape",
      "Caption",
      "--output",
      "-"
    ]);
    expect(out.exitCode, decode(out.stdout) + decode(out.stderr)).toBe(0);
    expect(out.stderr).toEqual(new Uint8Array());
    expect((await readPresentationText(out.stdout, {}, context)).text).toBe("雪 tea 雪");
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    ["--all"],
    ["--all", "--output", "-", "--json"],
    ["--all", "--in-place", "--output", "/out.pptx"],
    ["--all", "--force", "--dry-run"],
    ["--all", "--output", "/deck.pptx"],
    ["--all", "--paragraph", "1", "--dry-run"]
  ])("rejects invalid publication or unsupported selectors %j", async (...flags) => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "雪",
      "--with",
      "海",
      ...flags
    ]);
    expect(out.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("replaces a literal match split across independently authored runs through the command", async () => {
    const f = await fixture();
    const part = "/ppt/slides/slide1.xml";
    const before = await getXmlPart(f.bytes, part, context);
    const split = before.xml.replace(
      "<a:t>雪 café 雪</a:t>",
      '<a:t>雪 ca</a:t></a:r><a:r><a:rPr i="1"/><a:t>fé 雪</a:t>'
    );
    expect(split).not.toBe(before.xml);
    const bytes = storedArchive(
      inspectZip(f.bytes).map((entry) => ({
        name: entry.name,
        bytes: entry.name === "ppt/slides/slide1.xml" ? encode(split) : entry.payload
      }))
    );
    f.volume.writeFileSync("/deck.pptx", bytes);
    const output = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "café",
      "--with",
      "tea",
      "--all",
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(output.exitCode, decode(output.stdout)).toBe(0);
    const result = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
    expect((await readPresentationText(result, {}, context)).text).toBe("雪 tea 雪");
    const after = await getXmlPart(result, part, context);
    expect(after.xml).toContain('<a:rPr i="1"/>');
    expect(after.xml).toContain("<a:t> 雪</a:t>");
  });
  it.each(["{}", '{"bold":"yes"}', '{"font":"Serif"}', "[]", "null"])(
    "rejects invalid replacement style %s before reading",
    async (style) => {
      const f = await fixture();
      const out = await f.run([
        "text",
        "replace",
        "/deck.pptx",
        "--find",
        "雪",
        "--with",
        "海",
        "--all",
        "--style-json",
        style,
        "--dry-run",
        "--json"
      ]);
      expect(out.exitCode).toBe(2);
      expect(f.readInput).not.toHaveBeenCalled();
    }
  );
  it("applies the typed style override through direct command flags", async () => {
    const f = await fixture();
    const out = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "café",
      "--with",
      "tea",
      "--first",
      "--style-json",
      '{"bold":true,"italic":false}',
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(out.exitCode, decode(out.stdout)).toBe(0);
    const xml = await getXmlPart(
      new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
      "/ppt/slides/slide1.xml",
      context
    );
    expect(xml.xml).toContain('b="1"');
    expect(xml.xml).toContain('i="0"');
    expect(
      (
        await readPresentationText(
          new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
          {},
          context
        )
      ).text
    ).toBe("雪 tea 雪");
  });
  it("exposes a result and option schema that agrees with explicit modes", async () => {
    const f = await fixture();
    const response = await f.run(["schema", "text", "replace", "--json"]);
    expect(response.exitCode).toBe(0);
    const schema = JSON.parse(decode(response.stdout)).data.operations["text.replace"];
    const options = compileJsonSchema(schema.options);
    expect(options.validate({ find: "雪", with: "", first: true, dryRun: true }).ok).toBe(true);
    expect(options.validate({ find: "雪", with: "", dryRun: true }).ok).toBe(false);
    expect(
      options.validate({ find: "雪", with: "", first: true, dryRun: true, style: { bold: false } })
        .ok
    ).toBe(true);
    expect(
      options.validate({ find: "雪", with: "", first: true, dryRun: true, style: {} }).ok
    ).toBe(false);
    expect(
      options.validate({ find: "雪", with: "", first: true, dryRun: true, style: { bold: "yes" } })
        .ok
    ).toBe(false);
    expect(
      options.validate({ find: "雪", with: "", first: true, all: true, dryRun: true }).ok
    ).toBe(false);
    const out = await f.run([
      "text",
      "replace",
      "/deck.pptx",
      "--find",
      "雪",
      "--with",
      "",
      "--all",
      "--dry-run",
      "--json"
    ]);
    expect(out.exitCode, decode(out.stdout) + decode(out.stderr)).toBe(0);
    expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(out.stdout))).ok).toBe(true);
  });
});
