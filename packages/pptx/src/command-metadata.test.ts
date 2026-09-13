import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { readTags } from "./tags.js";
const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
beforeAll(() => { const timer = globalThis.setTimeout; vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number) => delay === 0 ? setImmediate(fn) : timer(fn, delay)) as typeof setTimeout); });
afterAll(() => vi.restoreAllMocks());
async function fixture() {
  const v = Volume.fromJSON({});
  v.writeFileSync("/deck", await createPresentation({ slides: [{ name: "Garden" }] }, context));
  const engine = createPptxCommandEngine({ context, maxArgumentBytes: 65536, maxOutputBytes: 262144 });
  const readInput = vi.fn(async (path: string) => new Uint8Array(v.readFileSync(path) as Buffer));
  const publishOutput = vi.fn(async (p: PptxPublicationRequest) => { if (!p.dryRun) v.writeFileSync(p.outputPath, p.bytes); });
  return { v, readInput, publishOutput, run: async (args: string[]) => {
    const result = await engine.execute({ args: [...args, "--json"].map(x => new TextEncoder().encode(x)), signal: new AbortController().signal, readInput, publishOutput });
    return { ...result, envelope: JSON.parse(new TextDecoder().decode(result.stdout)) };
  } };
}
it("exposes plural properties with declared conversion, empty values and absent errors", async () => {
  const f = await fixture();
  expect((await f.run(["properties", "set", "/deck", "--name", "revision", "--value", "0", "--in-place"])).exitCode).toBe(0);
  expect((await f.run(["properties", "get", "/deck", "--name", "revision"])).envelope.data.properties).toMatchObject([{ type: "number", value: 0 }]);
  expect((await f.run(["properties", "set", "/deck", "--name", "subject", "--value", "Garden", "--in-place"])).exitCode).toBe(0);
  for (const [name, type, value, expected] of [["title", "string", "", ""], ["Score", "number", "12.5", 12.5], ["Ready", "boolean", "false", false], ["When", "date", "2026-04-05T06:07:08Z", "2026-04-05T06:07:08Z"]] as const) {
    const set = await f.run(["properties", "set", "/deck", "--name", name, "--type", type, "--value", value, "--in-place"]);
    expect(set.exitCode, JSON.stringify(set.envelope)).toBe(0);
    const get = await f.run(["properties", "get", "/deck", "--name", name]);
    expect(get.envelope.data.properties).toMatchObject([{ name, type, value: expected }]);
  }
  const bad = await f.run(["properties", "set", "/deck", "--name", "Ready", "--value", "1", "--in-place"]);
  expect(bad.exitCode).toBe(2);
  expect((await f.run(["properties", "get", "/deck", "--name", "Missing"])).exitCode).toBe(1);
});
it("publishes tags through the SDK, validates nonempty schemas and dry runs", async () => {
  const f = await fixture();
  const add = await f.run(["tags", "add", "/deck", "--slide", "1", "--name", "Season", "--value", "spring", "--in-place"]);
  expect(add.exitCode, JSON.stringify(add.envelope)).toBe(0);
  const bytes = new Uint8Array(f.v.readFileSync("/deck") as Buffer);
  expect(await readTags(bytes, {}, context)).toMatchObject([{ name: "Season", value: "spring" }]);
  const list = await f.run(["tags", "list", "/deck"]);
  const schema = await f.run(["schema", "tags", "list"]);
  const validator = compileJsonSchema(schema.envelope.data.operations["tags.list"].result);
  expect(validator.validate(list.envelope).ok).toBe(true);
  const dry = await f.run(["tags", "set", "/deck", "--select", list.envelope.data.tags[0].selector, "--value", "", "--dry-run"]);
  expect(dry.exitCode, JSON.stringify(dry.envelope)).toBe(0);
  expect(new Uint8Array(f.v.readFileSync("/deck") as Buffer)).toEqual(bytes);
  expect((await f.run(["sanitize", "/deck", "--remove", "notes", "--dry-run"])).exitCode).toBe(2);
});
it("creates all core string fields using the common JSON option spellings", async () => {
  const f = await fixture();
  const result = await f.run(["create", "--output", "/new", "--properties-json", JSON.stringify({ category: "Ecology", contentStatus: "Reviewed", identifier: "plot-17", language: "en", version: "2" })]);
  expect(result.exitCode, JSON.stringify(result.envelope)).toBe(0);
  const listed = await f.run(["properties", "list", "/new"]);
  expect(listed.envelope.data.properties).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "category", value: "Ecology" }),
    expect.objectContaining({ name: "content_status", value: "Reviewed" }),
    expect.objectContaining({ name: "identifier", value: "plot-17" }),
    expect.objectContaining({ name: "language", value: "en" }),
    expect.objectContaining({ name: "version", value: "2" })
  ]));
});
