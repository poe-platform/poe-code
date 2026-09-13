import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";

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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
let original: Promise<Uint8Array>;
async function invocation(flags: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", await original);
  return {
    volume,
    args: flags.map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: vi.fn(async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)),
    publishOutput: vi.fn(async (publication: PptxPublicationRequest) => {
      if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
    })
  };
}

describe("slide duplication command", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
    original = createPresentation({ slides: [{ name: "Coast" }, { name: "Forest" }] }, context);
  });
  afterAll(() => vi.restoreAllMocks());
  it("publishes a new slide and reports its fresh identity", async () => {
    const request = await invocation([
      "slides",
      "duplicate",
      "/input.pptx",
      "--slide",
      "1",
      "--position",
      "2",
      "--output",
      "/copy.pptx",
      "--json"
    ]);
    const response = await engine.execute(request);
    expect(response.exitCode, decode(response.stdout)).toBe(0);
    const result = JSON.parse(decode(response.stdout));
    expect(result).toMatchObject({
      operation: "slides.duplicate",
      affected: 1,
      data: { effects: [{ action: "add", feature: "F07" }] }
    });
    expect(result.locations[0].objectId).not.toBe("256");
    const parts = new Map(
      inspectZip(new Uint8Array(request.volume.readFileSync("/copy.pptx") as Buffer)).map(
        (entry) => [entry.name, decode(entry.payload)]
      )
    );
    expect(parts.get("ppt/presentation.xml")).toContain('id="256"');
    expect(parts.get("ppt/presentation.xml")).toContain('id="257"');
    expect(parts.get("ppt/presentation.xml")).toContain(`id="${result.locations[0].objectId}"`);
    expect(
      [...parts.keys()].filter(
        (name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml")
      )
    ).toHaveLength(3);
    expect(request.volume.readFileSync("/input.pptx")).toEqual(Buffer.from(await original));
  });
  it("validates ordered copies without publication and declares matching schemas", async () => {
    const request = await invocation([
      "slides",
      "duplicate",
      "/input.pptx",
      "--selection-json",
      '[{"kind":"slide","id":"257"},{"kind":"slide","id":"256"}]',
      "--position",
      "1",
      "--dry-run",
      "--json"
    ]);
    const response = await engine.execute(request);
    expect(response.exitCode, decode(response.stdout)).toBe(0);
    const result = JSON.parse(decode(response.stdout));
    expect(result).toMatchObject({
      affected: 2,
      data: { outputs: [], fingerprint: null, effects: [{ action: "add" }, { action: "add" }] }
    });
    expect(
      new Set(result.locations.map((location: { objectId: string }) => location.objectId)).size
    ).toBe(2);
    expect(request.publishOutput).not.toHaveBeenCalled();
    const schemaResult = await engine.execute(
      await invocation(["schema", "slides", "duplicate", "--json"])
    );
    const schema = JSON.parse(decode(schemaResult.stdout)).data.operations["slides.duplicate"];
    expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
    const validate = compileJsonSchema(schema.options);
    expect(validate.validate({ slide: 1, position: 2, dryRun: true }).ok).toBe(true);
    expect(validate.validate({ slide: 1, dryRun: true }).ok).toBe(false);
    expect(validate.validate({ slide: 1, position: 2, name: "Other", dryRun: true }).ok).toBe(
      false
    );
    const help = await engine.execute(await invocation(["help", "slides", "duplicate"]));
    expect(decode(help.stdout)).toContain("pptx slides duplicate INPUT --position N");
  });
  it("rejects stale tokens and out-of-range insertion without publication", async () => {
    const request = await invocation(["inspect", "/input.pptx", "--slide", "1", "--json"]);
    const inspected = await engine.execute(request);
    expect(inspected.exitCode).toBe(0);
    const token = JSON.parse(decode(inspected.stdout)).data.records[0].token;
    request.volume.writeFileSync(
      "/input.pptx",
      await createPresentation({ slides: [{ name: "Desert" }] }, context)
    );
    for (const { flags, exitCode, code } of [
      { flags: ["--select", token, "--position", "1"], exitCode: 1, code: "stale-selection" },
      { flags: ["--slide", "1", "--position", "3"], exitCode: 2, code: "invalid-value" }
    ]) {
      const response = await engine.execute({
        ...request,
        args: [
          "slides",
          "duplicate",
          "/input.pptx",
          ...flags,
          "--output",
          "/copy.pptx",
          "--json"
        ].map((value) => new TextEncoder().encode(value))
      });
      expect(response.exitCode, decode(response.stdout)).toBe(exitCode);
      expect(JSON.parse(decode(response.stdout))).toMatchObject({
        affected: 0,
        errors: [{ code }],
        locations: [],
        data: null
      });
      expect(request.publishOutput).not.toHaveBeenCalled();
      expect(request.volume.existsSync("/copy.pptx")).toBe(false);
    }
  });
  it("allows explicit no-match copying and emits package-only stdout", async () => {
    const request = await invocation([
      "slides",
      "duplicate",
      "/input.pptx",
      "--selection-json",
      '{"kind":"slide","name":"Absent"}',
      "--allow-empty",
      "--position",
      "1",
      "--output",
      "-"
    ]);
    const response = await engine.execute(request);
    expect(response.exitCode, decode(response.stderr)).toBe(0);
    expect(response.stdout).toEqual(await original);
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    ["--slide", "1", "--dry-run"],
    ["--position", "1", "--dry-run"],
    ["--all", "--position", "0", "--dry-run"],
    ["--all", "--position", "1", "--name", "Changed", "--dry-run"],
    ["--all", "--position", "1", "--scope", "notes", "--dry-run"],
    ["--slide", "1", "--position", "1", "--output", "-"]
  ])("rejects invalid duplication flags before input %j", async (...flags) => {
    const request = await invocation(["slides", "duplicate", "/input.pptx", ...flags, "--json"]);
    const response = await engine.execute(request);
    expect(response.exitCode, decode(response.stdout)).toBe(2);
    expect(JSON.parse(decode(response.stdout)).operation).toBe("slides.duplicate");
    expect(request.readInput).not.toHaveBeenCalled();
  });
});
