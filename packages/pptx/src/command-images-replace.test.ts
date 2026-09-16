import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";
import { readImages } from "./images.js";
import { readPackage } from "./package-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

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
  let original = await createPresentation({ slides: [{}] }, context);
  for (let index = 0; index < 2; index++)
    original = await addImage(
      original,
      { slide: 1, bytes: pixel, contentType: "image/gif", altText: "Harbor", left: 12700 },
      context
    );
  const archive = await readPackage(original, context);
  original = storedArchive(
    archive.names.map((name) => ({
      name: name.slice(1),
      bytes:
        name === "/ppt/slides/_rels/slide1.xml.rels"
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(archive.get(name))
                .replace('Target="../media/image2.gif"', 'Target="../media/image1.gif"')
            )
          : archive.get(name)
    }))
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck.pptx", original);
  const replacement = pixel.slice();
  replacement[13] = 128;
  volume.writeFileSync("/new.gif", replacement);
  const reads: string[] = [];
  const publish = vi.fn(
    async (output: { dryRun: boolean; outputPath: string; bytes: Uint8Array }) => {
      if (!output.dryRun) volume.writeFileSync(output.outputPath, output.bytes);
    }
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 262144
  });
  const controller = new AbortController();
  async function run(args: string[], cancelOnImageRead = false) {
    const output = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: controller.signal,
      readInput: async (path) => {
        reads.push(path);
        if (cancelOnImageRead && path === "/new.gif") controller.abort();
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      publishOutput: publish
    });
    return {
      ...output,
      value: output.stdout.length ? JSON.parse(new TextDecoder().decode(output.stdout)) : null
    };
  }
  return { volume, original, reads, publish, run };
}
const flags = [
  "images",
  "replace",
  "/deck.pptx",
  "--slide",
  "1",
  "--image",
  "1",
  "--file",
  "/new.gif"
];
it("rebinds one image and validates the affected occurrence report against schema", async () => {
  const f = await fixture();
  const result = await f.run([...flags, "--output", "/out.pptx", "--json"]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
  expect(result.value).toMatchObject({
    operation: "images.replace",
    affected: 1,
    data: {
      dryRun: false,
      shared: false,
      occurrences: [{ shapeName: "Picture 2", altText: "Harbor" }]
    }
  });
  const images = await readImages(
    new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer),
    {},
    context
  );
  expect(images.occurrences[0]!.sha256).not.toBe(images.occurrences[1]!.sha256);
  expect(images.occurrences[0]!.geometry!.corners[0]).toEqual({ x: 12700, y: 0 });
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.original);
  const schema = await f.run(["schema", "images", "replace", "--json"]);
  const validation = compileJsonSchema(
    schema.value.data.operations["images.replace"].result
  ).validate(result.value);
  expect(validation.ok, JSON.stringify(validation)).toBe(true);
});
it("applies explicit shared replacement and preservation policies", async () => {
  const f = await fixture();
  const result = await f.run([
    ...flags,
    "--shared",
    "--preserve-geometry",
    "false",
    "--preserve-crop",
    "false",
    "--preserve-alt-text",
    "false",
    "--alt-text",
    "",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(result.exitCode, JSON.stringify(result.value)).toBe(0);
  expect(result.value.affected).toBe(2);
  expect(result.value.data.occurrences).toHaveLength(2);
  expect(result.value.data.occurrences[0]).toMatchObject({
    altText: "",
    geometry: {
      corners: [
        { x: 0, y: 0 },
        { x: 12700, y: 0 },
        { x: 12700, y: 12700 },
        { x: 0, y: 12700 }
      ]
    }
  });
});
it("validates dry runs and cancels before publication", async () => {
  const f = await fixture();
  expect((await f.run([...flags, "--dry-run", "--json"])).exitCode).toBe(0);
  expect(f.publish).not.toHaveBeenCalled();
  expect((await f.run([...flags, "--output", "/out.pptx", "--json"], true)).exitCode).toBe(130);
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.volume.existsSync("/out.pptx")).toBe(false);
});
it("retains an existing destination when cancellation interrupts image admission", async () => {
  const f = await fixture();
  const sentinel = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
  f.volume.writeFileSync("/out.pptx", sentinel);
  const result = await f.run([...flags, "--output", "/out.pptx", "--force", "--json"], true);
  expect(result.exitCode).toBe(130);
  expect(f.publish).not.toHaveBeenCalled();
  expect(new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer)).toEqual(sentinel);
  expect(new Uint8Array(f.volume.readFileSync("/deck.pptx") as Buffer)).toEqual(f.original);
});
it("rejects missing destinations and ambiguous replacement before publication", async () => {
  const f = await fixture();
  expect((await f.run([...flags, "--json"])).exitCode).toBe(2);
  expect(f.reads).toEqual([]);
  const ambiguous = await f.run([
    "images",
    "replace",
    "/deck.pptx",
    "--slide",
    "1",
    "--file",
    "/new.gif",
    "--output",
    "/out.pptx",
    "--json"
  ]);
  expect(ambiguous.exitCode).toBe(2);
  expect(f.reads).toEqual([]);
  expect(f.publish).not.toHaveBeenCalled();
});
it("keeps shared and slide selection preconditions aligned with schema", async () => {
  const f = await fixture();
  const schema = await f.run(["schema", "images", "replace", "--json"]);
  const validate = compileJsonSchema(schema.value.data.operations["images.replace"].options);
  expect(validate.validate({ file: "/new.gif", image: 1, dryRun: true }).ok).toBe(false);
  expect(validate.validate({ file: "/new.gif", image: 1, scope: "slides", dryRun: true }).ok).toBe(
    false
  );
  expect(validate.validate({ file: "/new.gif", all: true, scope: "shared", dryRun: true }).ok).toBe(
    false
  );
  expect(
    validate.validate({ file: "/new.gif", all: true, scope: "shared", shared: true, dryRun: true })
      .ok
  ).toBe(true);
  const result = await f.run([
    "images",
    "replace",
    "/deck.pptx",
    "--scope",
    "shared",
    "--all",
    "--file",
    "/new.gif",
    "--dry-run",
    "--json"
  ]);
  expect(result.exitCode).toBe(2);
  expect(f.reads).toEqual([]);
});
it.each([
  ["--preserve-crop", "sometimes"],
  ["--scope", "presentation"],
  ["--content-type", "text/plain"],
  ["--select", "token"]
])("rejects invalid policies before input reads %j", async (...extra) => {
  const f = await fixture();
  expect((await f.run([...flags, ...extra, "--dry-run", "--json"])).exitCode).toBe(2);
  expect(f.reads).toEqual([]);
});
