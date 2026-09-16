import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { mutateProperty, readProperties } from "./properties.js";
import { inspectZip } from "../tests/zip-reader.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
beforeAll(() => { const timer = globalThis.setTimeout; vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number) => delay === 0 ? setImmediate(fn) : timer(fn, delay)) as typeof setTimeout); });
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const original = (await mutateProperty(await createPresentation({ slides: [{ name: "Cedar" }] }, context), "set", { name: "title", value: "Private heading" }, context)).bytes;
  const volume = Volume.fromJSON({ "/deck": Buffer.from(original) });
  const engine = createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 });
  const readInput = vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => { if (!p.dryRun) volume.writeFileSync(p.outputPath, p.bytes); });
  return { original, volume, readInput, publishOutput, run: async (args: string[]) => {
    const result = await engine.execute({ args: [...args, "--json"].map(x => new TextEncoder().encode(x)), signal: new AbortController().signal, readInput, publishOutput });
    return { ...result, envelope: JSON.parse(new TextDecoder().decode(result.stdout)) };
  } };
}
it("sanitizes explicit JSON families with a detailed report and preserves slide bytes", async () => {
  const f = await fixture();
  const result = await f.run(["sanitize", "/deck", "--remove", '["properties","notes"]', "--output", "/clean"]);
  expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
  expect(result.envelope.affected).toBe(1);
  expect(result.envelope.data.removed).toEqual(expect.arrayContaining([expect.objectContaining({ category: "properties", part: "/docProps/core.xml" })]));
  expect(result.envelope.data.retained).toEqual(expect.any(Array));
  const output = new Uint8Array(f.volume.readFileSync("/clean") as Buffer);
  expect(await readProperties(output, {}, context)).toEqual([]);
  expect(inspectZip(output).find(p => p.name === "ppt/slides/slide1.xml")!.payload).toEqual(inspectZip(f.original).find(p => p.name === "ppt/slides/slide1.xml")!.payload);
  const schema = await f.run(["schema", "sanitize"]);
  const declared = schema.envelope.data.operations.sanitize;
  const validation = compileJsonSchema(declared.result).validate(result.envelope);
  expect(validation.ok, JSON.stringify(validation)).toBe(true);
  const options = compileJsonSchema(declared.options);
  expect(options.validate({ remove: ["properties", "notes"], output: "/clean" }).ok).toBe(true);
  expect(options.validate({ remove: ["notes", "notes"], dryRun: true }).ok).toBe(false);
  expect(options.validate({ remove: [], dryRun: true }).ok).toBe(false);
});
it("validates removal arguments before input admission", async () => {
  const f = await fixture();
  for (const remove of ['[]', '["notes","notes"]', '["history"]', '[null]', '{}', 'notes,comments', '["notes"']) {
    const result = await f.run(["sanitize", "/deck", "--remove", remove, "--dry-run"]);
    expect(result.exitCode, remove).toBe(2);
  }
  expect(f.readInput).not.toHaveBeenCalled();
  expect(f.publishOutput).not.toHaveBeenCalled();
});
it("keeps missing-selection and allow-empty semantics without widening selected families", async () => {
  const f = await fixture();
  expect((await f.run(["sanitize", "/deck", "--remove", '["notes","comments","links","objects"]', "--dry-run"])).exitCode).toBe(1);
  const empty = await f.run(["sanitize", "/deck", "--remove", '["notes","comments","links","objects"]', "--allow-empty", "--all", "--dry-run"]);
  expect(empty.exitCode, JSON.stringify(empty.envelope)).toBe(0);
  expect(empty.envelope.affected).toBe(0);
  expect(empty.envelope.data.removed).toEqual([]);
  expect(empty.envelope.data.retained).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "part", part: "/docProps/core.xml" })]));
  expect(f.volume.readFileSync("/deck")).toEqual(Buffer.from(f.original));
  expect(f.publishOutput).not.toHaveBeenCalled();
});
