import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, createPptxCommandEngine, readMedia } from "./index.js";
import { compileJsonSchema } from "toolcraft-schema";
import { inspectZip } from "../tests/zip-reader.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const clip = new Uint8Array([
  0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109
]);
const poster = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0,
  0, 2, 2, 68, 1, 0, 59
]);
async function fixture() {
  const volume = Volume.fromJSON({
    "/deck.pptx": Buffer.from(await createPresentation({ slides: [{}] }, context)),
    "/clip.mp4": Buffer.from(clip),
    "/poster.gif": Buffer.from(poster)
  });
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 1000000
  });
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput,
      publishOutput: async (publication) => {
        if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
      }
    });
    return { ...result, text: new TextDecoder().decode(result.stdout) };
  };
  return { volume, run, readInput, engine };
}
const add = [
  "media",
  "add",
  "/deck.pptx",
  "--slide",
  "1",
  "--file",
  "/clip.mp4",
  "--poster",
  "/poster.gif",
  "--kind",
  "video",
  "--mime-type",
  "video/mp4",
  "--left",
  "0emu",
  "--top",
  "0emu",
  "--width",
  "1in",
  "--height",
  "1in",
  "--output",
  "/out.pptx",
  "--json"
];
it("inserts supplied media through the command and preserves exact payload bytes", async () => {
  const f = await fixture();
  const result = await f.run(add);
  expect(result.exitCode, result.text).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ operation: "media.add", affected: 1, ok: true });
  const schema = JSON.parse((await f.run(["schema", "media", "add", "--json"])).text).data
    .operations["media.add"];
  expect(compileJsonSchema(schema.result).validate(JSON.parse(result.text))).toMatchObject({
    ok: true
  });
  const output = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
  const inventory = await readMedia(output, {}, context);
  expect(inventory.occurrences[0]).toMatchObject({
    kind: "video",
    posters: [{ contentType: "image/gif" }]
  });
  const entries = inspectZip(output);
  expect(
    new TextDecoder().decode(
      entries.find((entry) => entry.name === "ppt/slides/slide1.xml")?.payload
    )
  ).toContain('uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"');
  expect(
    entries.find((entry) => entry.name === inventory.media[0]!.part.slice(1))?.payload
  ).toEqual(clip);
});
it("rejects absent video posters and conflicting selectors without reading inputs", async () => {
  const f = await fixture();
  const withoutPoster = add.filter((_, index) => index !== 7 && index !== 8);
  for (const args of [
    withoutPoster,
    [...add, "--select", "opaque"],
    [...add, "--mime-type", "audio/wav"]
  ]) {
    const result = await f.run(args);
    expect(result.exitCode, result.text).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
it("replaces selected media, preserves settings and extracts with an explicit partial-publication policy", async () => {
  const f = await fixture();
  const insertion = await f.run([
    ...add,
    "--trim-start",
    "5",
    "--trim-end",
    "90",
    "--loop",
    "true",
    "--volume",
    "45000"
  ]);
  expect(insertion.exitCode, insertion.text).toBe(0);
  const inserted = new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer);
  const before = await readMedia(inserted, {}, context);
  const shape = before.occurrences[0]!.shapeName!;
  const replacement = await f.run([
    "media",
    "replace",
    "/out.pptx",
    "--slide",
    "1",
    "--shape",
    shape,
    "--file",
    "/clip.mp4",
    "--poster",
    "/poster.gif",
    "--shared",
    "--output",
    "/replaced.pptx",
    "--json"
  ]);
  expect(replacement.exitCode, replacement.text).toBe(0);
  const after = await readMedia(
    new Uint8Array(f.volume.readFileSync("/replaced.pptx") as Buffer),
    {},
    context
  );
  expect(after.occurrences[0]!.timing).toEqual(before.occurrences[0]!.timing);
  expect(after.occurrences[0]!.playback.map((item) => item.xml)).toEqual(
    before.occurrences[0]!.playback.map((item) => item.xml)
  );
  const denied = await f.run([
    "media",
    "extract",
    "/replaced.pptx",
    "--output-dir",
    "/clips",
    "--json"
  ]);
  expect(denied.exitCode, denied.text).toBe(3);
  f.volume.mkdirSync("/clips");
  const extracted = await f.run([
    "media",
    "extract",
    "/replaced.pptx",
    "--output-dir",
    "/clips",
    "--allow-partial-output",
    "--json"
  ]);
  expect(extracted.exitCode, extracted.text).toBe(0);
  const manifest = JSON.parse(extracted.text).data.outputs;
  expect(manifest).toHaveLength(1);
  expect(new Uint8Array(f.volume.readFileSync(manifest[0].path) as Buffer)).toEqual(clip);
});

it("reports only committed outputs after a later partial extraction failure", async () => {
  const f = await fixture();
  expect((await f.run(add)).exitCode).toBe(0);
  const second = add.map((value) =>
    value === "/deck.pptx" ? "/out.pptx" : value === "/out.pptx" ? "/two.pptx" : value
  );
  expect((await f.run(second)).exitCode).toBe(0);
  let written = 0;
  const result = await f.engine.execute({
    args: [
      "media",
      "extract",
      "/two.pptx",
      "--output-dir",
      "/clips",
      "--allow-partial-output",
      "--json"
    ].map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: f.readInput,
    publishOutput: async (publication) => {
      if (!publication.dryRun && ++written === 2)
        throw Object.assign(new Error("full"), { code: "ENOSPC" });
    }
  });
  const envelope = JSON.parse(new TextDecoder().decode(result.stdout));
  expect(result.exitCode).not.toBe(0);
  expect(envelope).toMatchObject({
    ok: false,
    affected: 1,
    data: { outputs: [{ contentType: "video/mp4", bytes: 20 }], dryRun: false }
  });
  expect(envelope.data.outputs).toHaveLength(1);
  const schema = JSON.parse((await f.run(["schema", "media", "extract", "--json"])).text).data
    .operations["media.extract"];
  expect(compileJsonSchema(schema.result).validate(envelope)).toMatchObject({ ok: true });
});
it("rejects wrong payload types and dual stdin without publishing", async () => {
  const f = await fixture();
  f.volume.writeFileSync("/clip.mp4", poster);
  const invalid = await f.run(add);
  expect(invalid.exitCode).not.toBe(0);
  expect(f.volume.existsSync("/out.pptx")).toBe(false);
  f.readInput.mockClear();
  const stdin = await f.run(
    add.map((value) => (["/deck.pptx", "/clip.mp4"].includes(value) ? "-" : value))
  );
  expect(stdin.exitCode).toBe(2);
  expect(f.readInput).not.toHaveBeenCalled();
});
