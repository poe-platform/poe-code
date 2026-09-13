import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { readImages } from "./images.js";

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
// Original single black pixel with a transparent palette entry.
const pixel = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0,
  44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59
]);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const volume = Volume.fromJSON({});
  const original = await createPresentation({ slides: [{}] }, context);
  volume.writeFileSync("/deck.pptx", original);
  volume.writeFileSync("/dot.GIF", pixel);
  const reads: string[] = [];
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 262144
  });
  async function run(args: string[]) {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => {
        reads.push(path);
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      publishOutput: async (output) => {
        if (!output.dryRun) volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
    return {
      ...result,
      value: result.stdout.length ? JSON.parse(new TextDecoder().decode(result.stdout)) : null
    };
  }
  return { volume, original, reads, run };
}
describe("image insertion command", () => {
  it("publishes explicit image bytes with units, fit and escaped alternative text", async () => {
    const f = await fixture();
    const result = await f.run([
      "images",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--file",
      "/dot.GIF",
      "--left",
      "-1pt",
      "--top",
      "2pt",
      "--width",
      "2in",
      "--height",
      "1in",
      "--fit",
      "stretch",
      "--alt-text",
      "Tide & foam",
      "--output",
      "/new.pptx",
      "--json"
    ]);
    expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
    expect(result.value).toMatchObject({ operation: "images.add", ok: true, affected: 1 });
    const image = await readImages(
      new Uint8Array(f.volume.readFileSync("/new.pptx") as Buffer),
      {},
      context
    );
    expect(image.occurrences).toHaveLength(1);
    expect(image.occurrences[0]).toMatchObject({
      contentType: "image/gif",
      altText: "Tide & foam",
      geometry: {
        corners: [
          { x: -12700, y: 25400 },
          { x: 1816100, y: 25400 },
          { x: 1816100, y: 939800 },
          { x: -12700, y: 939800 }
        ]
      }
    });
    expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.original);
    const schema = await f.run(["schema", "images", "add", "--json"]);
    expect(
      compileJsonSchema(schema.value.data.operations["images.add"].result).validate(result.value).ok
    ).toBe(true);
  });
  it.each([
    ["--file", "/dot.GIF"],
    ["--slide", "1"],
    ["--slide", "1", "--file", "/dot.GIF", "--fit", "tile"],
    ["--slide", "1", "--file", "/dot.GIF", "--width", "2"],
    ["--slide", "1", "--file", "/dot.GIF", "--scope", "masters"],
    ["--slide", "1", "--file", "/dot.GIF", "--all"],
    ["--slide", "1", "--file", "/dot.GIF", "--content-type", "text/plain"],
    ["--slide", "1", "--file", "/unknown"]
  ])("rejects invalid insertion arguments before reading %j", async (...flags) => {
    const f = await fixture();
    const result = await f.run(["images", "add", "/deck.pptx", ...flags, "--dry-run", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(f.reads).toEqual([]);
  });
  it("validates a dry run with explicit MIME and publishes no bytes", async () => {
    const f = await fixture();
    const result = await f.run([
      "images",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--file",
      "/dot.GIF",
      "--content-type",
      "image/gif",
      "--alt-text",
      "",
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
    expect(result.value.data.dryRun).toBe(true);
    expect(f.volume.readdirSync("/")).toEqual(["deck.pptx", "dot.GIF"]);
  });
});
