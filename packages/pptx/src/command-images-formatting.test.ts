import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";
import { readPackage } from "./package-reader.js";
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
  const original = await addImage(
    await createPresentation({ slides: [{}] }, context),
    { slide: 1, bytes: pixel, contentType: "image/gif" },
    context
  );
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
const flags = ["images", "set", "/deck.pptx", "--slide", "1", "--image", "1"];
it("formats one picture with signed crop, transforms, alpha and explicit border units", async () => {
  const f = await fixture();
  const result = await f.run([
    ...flags,
    "--crop-left",
    "-0.35",
    "--crop-right",
    "1.1",
    "--rotation",
    "32.25",
    "--flip-horizontal",
    "true",
    "--flip-vertical",
    "false",
    "--opacity",
    "0.42",
    "--border-color",
    "2468AC",
    "--border-width",
    "1.5pt",
    "--alt-text",
    "Lagoon & dunes",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
  expect(result.value).toMatchObject({
    operation: "images.set",
    affected: 1,
    data: { dryRun: false }
  });
  const bytes = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
  const images = await readImages(bytes, {}, context);
  expect(images.occurrences[0]).toMatchObject({
    crop: { left: -0.35, right: 1.1, top: 0, bottom: 0 },
    altText: "Lagoon & dunes"
  });
  const archive = await readPackage(bytes, context);
  const xml = new TextDecoder().decode(archive.get("/ppt/slides/slide1.xml"));
  for (const expected of ['rot="1935000"', 'flipH="1"', 'amt="42000"', 'w="19050"', 'val="2468AC"'])
    expect(xml).toContain(expected);
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.original);
  const schema = await f.run(["schema", "images", "set", "--json"]);
  const validate = compileJsonSchema(schema.value.data.operations["images.set"].result).validate(
    result.value
  );
  expect(validate.ok, JSON.stringify(validate)).toBe(true);
});
it("validates dry-run edits without publication and rejects zero visible crop", async () => {
  const f = await fixture();
  expect((await f.run([...flags, "--opacity", "0", "--dry-run", "--json"])).exitCode).toBe(0);
  expect(f.volume.existsSync("/out.pptx")).toBe(false);
  expect(
    (
      await f.run([
        ...flags,
        "--crop-left",
        "0.7",
        "--crop-right",
        "0.3",
        "--output",
        "/out.pptx",
        "--json"
      ])
    ).exitCode
  ).toBe(2);
  expect(f.volume.existsSync("/out.pptx")).toBe(false);
});
it.each([
  ["--flip-horizontal", "maybe"],
  ["--opacity", "NaN"],
  ["--border-width", "-1pt"],
  ["--crop-left", "Infinity"]
])("rejects invalid formatting values %j before publication", async (...extra) => {
  const f = await fixture();
  expect((await f.run([...flags, ...extra, "--dry-run", "--json"])).exitCode).toBe(2);
});

it("shows picture formatting help rather than the full command inventory", async () => {
  const f = await fixture();
  const help = await f.run(["images", "set", "--help", "--json"]);
  expect(help.value.data.usage).toContain("Usage: pptx images set INPUT");
  expect(help.value.data.usage).toContain("--crop-left");
  expect(help.value.data.usage).not.toContain("Usage: pptx create");
});
it("bounds declared picture rotation to the shared transform contract", async () => {
  const f = await fixture();
  const schema = await f.run(["schema", "images", "set", "--json"]);
  const validator = compileJsonSchema(schema.value.data.operations["images.set"].options);
  expect(validator.validate({ rotation: 360001, dryRun: true }).ok).toBe(false);
  expect(validator.validate({ rotation: -360000, dryRun: true }).ok).toBe(true);
});
