import { Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { compileJsonSchema } from "toolcraft-schema";
import { templateSchema } from "./template-schema.js";

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
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
async function fixture() {
  const bytes = await createPresentation({}, context);
  const volume = Volume.fromJSON({ "/bindings.json": "[]" });
  volume.writeFileSync("/deck.pptx", bytes);
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const publishOutput = vi.fn(async (value: PptxPublicationRequest) => {
    if (!value.dryRun) volume.writeFileSync(value.outputPath, value.bytes);
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  return {
    bytes,
    volume,
    readInput,
    publishOutput,
    run: (args: string[]) =>
      engine.execute({
        args: args.map(encode),
        readInput,
        publishOutput,
        signal: new AbortController().signal
      })
  };
}
describe("typed template commands", () => {
  it.each([
    ["--data-json", "[]"],
    ["--data-file", "/bindings.json"]
  ])("accepts an explicit empty binding source %s", async (flag, value) => {
    const f = await fixture();
    const result = await f.run([
      "template",
      "apply",
      "/deck.pptx",
      flag!,
      value!,
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(result.exitCode, decode(result.stderr)).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      operation: "template.apply",
      ok: true,
      affected: 0
    });
    expect(new Uint8Array(f.volume.readFileSync("/out.pptx") as Buffer)).toEqual(f.bytes);
  });
  it.each([
    [],
    ["--data-json", "[]", "--data-file", "/bindings.json"],
    ["--data-json", '[{"name":"a","name":"b"}]'],
    ["--data-json", "[]", "--slide", "1"],
    ["--data-file", "/out.pptx"]
  ])("rejects invalid sources before input reads %j", async (...flags) => {
    const f = await fixture();
    const result = await f.run([
      "template",
      "apply",
      "/deck.pptx",
      ...flags,
      "--output",
      "/out.pptx",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("reserves stdin for only one input", async () => {
    const f = await fixture();
    const result = await f.run([
      "template",
      "apply",
      "-",
      "--data-file",
      "-",
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("discovers the exact source alternatives", async () => {
    const f = await fixture();
    const result = await f.run(["schema", "template", "apply", "--json"]);
    expect(result.exitCode).toBe(0);
    const text = decode(result.stdout);
    expect(text).toContain('"dataJson"');
    expect(text).toContain('"dataFile"');
    expect(f.readInput).not.toHaveBeenCalled();
  });
  it("schema admits exactly one source and explicit publication intent", () => {
    const schema = compileJsonSchema(templateSchema.options);
    for (const value of [
      { dataJson: "[]", dryRun: true },
      { dataFile: "bindings.json", output: "out.pptx" }
    ])
      expect(schema.validate(value).ok).toBe(true);
    for (const value of [
      { dryRun: true },
      { dataJson: "[]", dataFile: "bindings.json", dryRun: true },
      { dataJson: "[]" },
      { dataJson: "[]", inPlace: true, output: "out.pptx" }
    ])
      expect(schema.validate(value).ok).toBe(false);
  });
  it("rejects malformed file data before reading a presentation", async () => {
    const f = await fixture();
    f.volume.writeFileSync("/bindings.json", '[{"name":"x","name":"y"}]');
    const result = await f.run([
      "template",
      "apply",
      "/deck.pptx",
      "--data-file",
      "/bindings.json",
      "--dry-run",
      "--json"
    ]);
    expect(result.exitCode).toBe(2);
    expect(f.readInput.mock.calls.map(([path]) => path)).toEqual(["/bindings.json"]);
    expect(f.publishOutput).not.toHaveBeenCalled();
  });
  it("shows focused help and capability limits", async () => {
    const f = await fixture();
    const help = await f.run(["template", "apply", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(decode(help.stdout)).toContain("cardinality: one|all");
    const capabilities = await f.run(["capabilities", "--json"]);
    expect(capabilities.exitCode).toBe(0);
    expect(decode(capabilities.stdout)).toContain("template.apply");
    expect(decode(capabilities.stdout)).toContain("Repeated slides are unavailable");
    expect(f.readInput).not.toHaveBeenCalled();
  });
});
