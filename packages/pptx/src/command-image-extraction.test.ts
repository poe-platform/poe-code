import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";

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
const engine = createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 262144 });
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
let deck: Uint8Array;
beforeAll(async () => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  deck = await createPresentation({ slides: [{}] }, context);
  for (let i = 0; i < 2; i++)
    deck = await addImage(deck, { slide: 1, bytes: pixel, contentType: "image/gif" }, context);
});
afterAll(() => vi.restoreAllMocks());
function invocation(flags: string[]) {
  const volume = Volume.fromJSON({ "/out": null });
  volume.writeFileSync("/deck.pptx", deck);
  return {
    volume,
    args: flags.map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    publishOutput: vi.fn(async (item: PptxPublicationRequest) => {
      if (!item.dryRun) volume.writeFileSync(item.outputPath, item.bytes);
    })
  };
}
const extract = ["images", "extract", "/deck.pptx", "--output-dir", "/out", "--json"];
it("extracts original occurrence bytes and a schema-valid hash manifest without implicit deduplication", async () => {
  const request = invocation([...extract, "--allow-partial-output"]);
  const result = await engine.execute(request);
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(request.volume.readdirSync("/out")).toEqual(["part-000001.gif", "part-000002.gif"]);
  for (const name of request.volume.readdirSync("/out"))
    expect(request.volume.readFileSync(`/out/${name}`)).toEqual(Buffer.from(pixel));
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.affected).toBe(2);
  expect(envelope.data.outputs.map((item: { sha256: string }) => item.sha256)).toEqual(
    Array(2).fill(createHash("sha256").update(pixel).digest("hex"))
  );
  const schemaResult = await engine.execute(invocation(["schema", "images", "extract", "--json"]));
  const schema = JSON.parse(decode(schemaResult.stdout)).data.operations["images.extract"].result;
  expect(compileJsonSchema(schema).validate(envelope).ok).toBe(true);
});
it("requires explicit partial publication and admits count limits before any output", async () => {
  for (const [flags, status] of [
    [[], 3],
    [["--allow-partial-output", "--limit", "maxOutputs=1"], 4]
  ] as const) {
    const request = invocation([...extract, ...flags]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(status);
    expect(request.publishOutput).not.toHaveBeenCalled();
    expect(request.volume.readdirSync("/out")).toEqual([]);
  }
});
it("reports only completed image outputs on an opted-in publication failure", async () => {
  const request = invocation([...extract, "--allow-partial-output"]);
  request.publishOutput.mockImplementation(async (item) => {
    if (item.dryRun) return;
    if (item.outputPath.endsWith("000002.gif")) throw new Error("Write denied");
    request.volume.writeFileSync(item.outputPath, item.bytes);
  });
  const result = await engine.execute(request);
  expect(result.exitCode).toBe(3);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.ok).toBe(false);
  expect(envelope.affected).toBe(1);
  expect(envelope.data.outputs.map((item: { path: string }) => item.path)).toEqual([
    "/out/part-000001.gif"
  ]);
  expect(request.volume.readdirSync("/out")).toEqual(["part-000001.gif"]);
});
it("validates dry runs without destinations and honors explicit unique selection", async () => {
  const dry = invocation(["images", "extract", "/deck.pptx", "--dry-run", "--json"]);
  expect((await engine.execute(dry)).exitCode).toBe(0);
  expect(dry.publishOutput).not.toHaveBeenCalled();
  const request = invocation([...extract, "--unique", "--allow-partial-output"]);
  const result = await engine.execute(request);
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(request.volume.readdirSync("/out")).toEqual(["part-000001.gif"]);
  expect(JSON.parse(decode(result.stdout)).data.outputs[0].occurrences).toHaveLength(2);
});
it("never calls transactional publication for an empty dry run", async () => {
  const request = invocation([...extract, "--dry-run"]);
  const empty = await createPresentation({ slides: [{}] }, context);
  request.readInput.mockResolvedValue(new Uint8Array(empty));
  const publishOutputs = vi.fn(async (_items: readonly PptxPublicationRequest[]) => {});
  const result = await engine.execute({ ...request, publishOutputs });
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(publishOutputs).not.toHaveBeenCalled();
});
it("filters by exact byte hash and validates hash syntax before reading", async () => {
  const request = invocation([
    ...extract,
    "--sha256",
    createHash("sha256").update(pixel).digest("hex"),
    "--unique",
    "--allow-partial-output"
  ]);
  const result = await engine.execute(request);
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(JSON.parse(decode(result.stdout)).data.outputs).toHaveLength(1);
  const invalid = invocation([...extract, "--sha256", "../art.gif"]);
  expect((await engine.execute(invalid)).exitCode).toBe(2);
  expect(invalid.readInput).not.toHaveBeenCalled();
});
it("reports completed bytes when cancellation interrupts partial publication", async () => {
  const request = invocation([...extract, "--allow-partial-output"]);
  const controller = new AbortController();
  request.publishOutput.mockImplementation(async (item) => {
    if (item.dryRun) return;
    if (item.outputPath.endsWith("000002.gif")) {
      controller.abort(new Error("Stop output"));
      controller.signal.throwIfAborted();
    }
    request.volume.writeFileSync(item.outputPath, item.bytes);
  });
  const result = await engine.execute({ ...request, signal: controller.signal });
  expect(result.exitCode).toBe(130);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.errors[0].code).toBe("cancelled");
  expect(envelope.data.outputs.map((item: { path: string }) => item.path)).toEqual([
    "/out/part-000001.gif"
  ]);
  expect(envelope.affected).toBe(1);
});
it("publishes a single complete image transaction after all preflights", async () => {
  const request = invocation(extract);
  const preflightOutput = vi.fn(async (_item: PptxPublicationRequest) => {});
  const publishOutputs = vi.fn(async (items: readonly PptxPublicationRequest[]) => {
    expect(preflightOutput).toHaveBeenCalledTimes(2);
    expect(items.map((item) => item.outputPath)).toEqual([
      "/out/part-000001.gif",
      "/out/part-000002.gif"
    ]);
  });
  const result = await engine.execute({ ...request, preflightOutput, publishOutputs });
  expect(result.exitCode, decode(result.stdout)).toBe(0);
  expect(publishOutputs).toHaveBeenCalledTimes(1);
  expect(request.publishOutput).not.toHaveBeenCalled();
});
