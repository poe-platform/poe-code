import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
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

describe("slide removal command", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
    original = createPresentation(
      { slides: [{ name: "First" }, { name: "Middle" }, { name: "Last" }] },
      context
    );
  });
  afterAll(() => vi.restoreAllMocks());
  it("accepts current selection tokens and rejects them after the input changes", async () => {
    const request = await invocation(["inspect", "/input.pptx", "--slide", "1", "--json"]);
    const inspected = await engine.execute(request);
    expect(inspected.exitCode).toBe(0);
    const token = JSON.parse(decode(inspected.stdout)).data.records[0].token;
    const args = ["slides", "remove", "/input.pptx", "--select", token, "--dry-run", "--json"].map(
      (value) => new TextEncoder().encode(value)
    );
    const valid = await engine.execute({ ...request, args });
    expect(valid.exitCode, decode(valid.stdout)).toBe(0);
    request.volume.writeFileSync(
      "/input.pptx",
      await createPresentation({ slides: [{ name: "Changed" }] }, context)
    );
    const stale = await engine.execute({ ...request, args });
    expect(stale.exitCode, decode(stale.stdout)).toBe(1);
    expect(JSON.parse(decode(stale.stdout)).errors[0].code).toBe("stale-selection");
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("automatically removes affected show membership before publication", async () => {
    const request = await invocation([
      "slides",
      "remove",
      "/input.pptx",
      "--slide",
      "1",
      "--output",
      "/result.pptx",
      "--json"
    ]);
    request.volume.writeFileSync(
      "/input.pptx",
      storedArchive(
        inspectZip(await original).map((entry) => ({
          name: entry.name,
          bytes:
            entry.name === "ppt/presentation.xml"
              ? new TextEncoder().encode(
                  decode(entry.payload).replace(
                    "</p:presentation>",
                    '<p:custShowLst><p:custShow name="Morning" id="1"><p:sldLst><p:sld r:id="rId2"/></p:sldLst></p:custShow></p:custShowLst></p:presentation>'
                  )
                )
              : entry.payload
        }))
      )
    );
    const accepted = await engine.execute(request);
    expect(accepted.exitCode, decode(accepted.stdout)).toBe(0);
    const presentation = inspectZip(
      new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer)
    ).find((entry) => entry.name === "ppt/presentation.xml")!;
    expect(decode(presentation.payload)).not.toContain("Morning");
  });
  it("permits explicit empty selection without inventing an effect", async () => {
    const request = await invocation([
      "slides",
      "remove",
      "/input.pptx",
      "--selection-json",
      '{"kind":"slide","name":"Absent"}',
      "--allow-empty",
      "--dry-run",
      "--json"
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      affected: 0,
      locations: [],
      data: { effects: [], outputs: [] }
    });
  });
  it.each([
    ["1", "slide1.xml", "256"],
    ["3", "slide3.xml", "258"]
  ])("removes slide at position %s with original location identity", async (position, part, id) => {
    const request = await invocation([
      "slides",
      "remove",
      "/input.pptx",
      "--slide",
      position!,
      "--output",
      "/result.pptx",
      "--json"
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    const parts = new Map(
      inspectZip(new Uint8Array(request.volume.readFileSync("/result.pptx") as Buffer)).map(
        (entry) => [entry.name, decode(entry.payload)]
      )
    );
    expect(parts.has(`ppt/slides/${part}`)).toBe(false);
    expect(parts.get("ppt/presentation.xml")).not.toContain(`id="${id}"`);
    expect(parts.get("ppt/presentation.xml")).toContain('id="257"');
    expect(parts.has("ppt/theme/theme1.xml")).toBe(true);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      operation: "slides.remove",
      affected: 1,
      locations: [{ objectId: id }],
      data: { effects: [{ action: "remove", feature: "F07" }] }
    });
  });
  it("removes all selected slides to binary stdout", async () => {
    const request = await invocation(["slides", "remove", "/input.pptx", "--all", "--output", "-"]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stderr)).toBe(0);
    const parts = inspectZip(result.stdout);
    expect(parts.filter((entry) => entry.name.startsWith("ppt/slides/"))).toEqual([]);
    expect(parts.some((entry) => entry.name === "ppt/theme/theme1.xml")).toBe(true);
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("supports ordered structured selections and dry-run without publication", async () => {
    const request = await invocation([
      "slides",
      "remove",
      "/input.pptx",
      "--selection-json",
      '[{"kind":"slide","id":"258"},{"kind":"slide","id":"256"}]',
      "--dry-run",
      "--json"
    ]);
    const original = request.volume.readFileSync("/input.pptx");
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      affected: 2,
      locations: [{ objectId: "258" }, { objectId: "256" }],
      data: { outputs: [], fingerprint: null }
    });
    expect(request.volume.readFileSync("/input.pptx")).toEqual(original);
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    ["--dry-run"],
    ["--slide", "1"],
    ["--all", "--position", "1", "--dry-run"],
    ["--all", "--reference-policy", "repair", "--dry-run"],
    ["--all", "--output", "-"],
    ["--all", "--scope", "notes", "--dry-run"]
  ])("rejects invalid flags before reading input %j", async (...flags) => {
    const request = await invocation(["slides", "remove", "/input.pptx", ...flags, "--json"]);
    const result = await engine.execute(request);
    expect(result.exitCode, decode(result.stdout)).toBe(2);
    expect(JSON.parse(decode(result.stdout)).operation).toBe("slides.remove");
    expect(request.readInput).not.toHaveBeenCalled();
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("declares removal selectors and the explicit reference policy in schema and help", async () => {
    const response = await engine.execute(
      await invocation(["schema", "slides", "remove", "--json"])
    );
    expect(response.exitCode).toBe(0);
    const schema = JSON.parse(decode(response.stdout)).data.operations["slides.remove"];
    const validate = compileJsonSchema(schema.options);
    expect(validate.validate({ all: true, referencePolicy: "remove", dryRun: true }).ok).toBe(true);
    expect(validate.validate({ all: true, referencePolicy: "repair", dryRun: true }).ok).toBe(
      false
    );
    expect(validate.validate({ all: true, position: 1, dryRun: true }).ok).toBe(false);
    expect(validate.validate({ dryRun: true }).ok).toBe(false);
    const result = await engine.execute(
      await invocation([
        "slides",
        "remove",
        "/input.pptx",
        "--all",
        "--reference-policy",
        "remove",
        "--dry-run",
        "--json"
      ])
    );
    expect(result.exitCode, decode(result.stdout)).toBe(0);
    expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(result.stdout))).ok).toBe(
      true
    );
    const help = await engine.execute(await invocation(["help", "slides", "remove"]));
    expect(decode(help.stdout)).toContain("pptx slides remove INPUT");
    expect(decode(help.stdout)).toContain("--reference-policy remove");
  });
});
