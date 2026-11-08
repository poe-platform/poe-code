import { createHash } from "node:crypto";
import {mediaExtractionFixture as fixture} from "../tests/fixtures/media-extraction.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { extractMedia } from "./index.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 262144, maxReads: 100, chunkBytes: 4096 },
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
const limits = { maxOutputBytes: 1000, maxOutputs: 10 };
const clip = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 109, 112, 52, 50]);
it("extracts one original resource per occurrence, collapsing dual bindings only", async () => {
  const source = fixture();
  const before = source.slice();
  const outputs = await extractMedia(source, limits, context);
  expect(outputs.map((x) => x.name)).toEqual([
    "part-000001.mp4",
    "part-000002.mp4",
    "part-000003.mp4"
  ]);
  expect(outputs.map((x) => x.occurrenceIds)).toEqual([
    ["/slide.xml#media-2"],
    ["/slide.xml#media-3"],
    ["/slide.xml#media-4"]
  ]);
  for (const output of outputs) {
    expect(output.bytes).toEqual(clip);
    expect(output.sha256).toBe(createHash("sha256").update(clip).digest("hex"));
    expect(output.contentType).toBe("video/mp4");
  }
  outputs[0]!.bytes.fill(0);
  expect(outputs[1]!.bytes).toEqual(clip);
  expect(source).toEqual(before);
});
it("deduplicates equal bytes only by explicit intent and keeps occurrence provenance", async () => {
  const outputs = await extractMedia(fixture(), { ...limits, deduplicate: true }, context);
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.sourceParts).toEqual(["/hidden.dat", "/copy.dat"]);
  expect(outputs[0]!.occurrenceIds).toEqual([
    "/slide.xml#media-2",
    "/slide.xml#media-3",
    "/slide.xml#media-4"
  ]);
});
it("retains distinct imported fallback resources within the same occurrence", async () => {
  const outputs = await extractMedia(
    fixture(false, "video/mp4", true),
    { ...limits, slide: 1, shape: "../../private-2.exe" },
    context
  );
  expect(outputs.map((x) => x.bytes)).toEqual([clip, new Uint8Array([11, 22, 33])]);
});
it.each([
  [35, 3],
  [36, 2]
])("charges expanded occurrence output budgets %s/%s", async (maxOutputBytes, maxOutputs) => {
  await expect(
    extractMedia(fixture(), { maxOutputBytes, maxOutputs }, context)
  ).rejects.toMatchObject({ code: "resource-limit" });
});
it("accepts exact byte and count budgets with explicit deduplication", async () => {
  expect(
    await extractMedia(fixture(), { maxOutputBytes: 12, maxOutputs: 1, deduplicate: true }, context)
  ).toHaveLength(1);
  expect(
    await extractMedia(fixture(), { maxOutputBytes: 36, maxOutputs: 3 }, context)
  ).toHaveLength(3);
});
it("rejects external relationships without reading their target", async () => {
  await expect(extractMedia(fixture(true), limits, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("uses an inert bin extension for an unknown imported media type", async () => {
  expect(
    (await extractMedia(fixture(false, "application/x-custom"), limits, context))[0]!.name
  ).toBe("part-000001.bin");
});
it.each([0, -1, 1.5, NaN])("rejects invalid extraction limits %s", async (maxOutputs) => {
  await expect(extractMedia(fixture(), { ...limits, maxOutputs }, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
});
it("rejects option accessors without evaluating them", async () => {
  const getter = vi.fn(() => true);
  const options = Object.defineProperty({ ...limits }, "deduplicate", { get: getter });
  await expect(extractMedia(fixture(), options, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(getter).not.toHaveBeenCalled();
});
it("rejects unknown options and malformed deduplication intent", async () => {
  for (const options of [
    { ...limits, unexpected: true },
    { ...limits, deduplicate: "yes" }
  ])
    await expect(
      extractMedia(fixture(), options as Parameters<typeof extractMedia>[1], context)
    ).rejects.toMatchObject({ code: "invalid-value" });
});
it("observes cancellation before admitting the package", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    extractMedia(fixture(), limits, { ...context, signal: controller.signal })
  ).rejects.toBeDefined();
});
