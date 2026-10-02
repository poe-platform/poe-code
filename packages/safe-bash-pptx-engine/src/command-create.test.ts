import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine, type PptxPublicationRequest } from "./command-engine.js";
import { readSelectionIndex } from "./selectors.js";

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
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
function invocation(args: string[]) {
  const volume = Volume.fromJSON({ "/work": null });
  return {
    volume,
    args: args.map(encode),
    signal: new AbortController().signal,
    readInput: vi.fn(async () => new Uint8Array()),
    publishOutput: vi.fn(async (publication: PptxPublicationRequest) => {
      if (!publication.dryRun) volume.writeFileSync(publication.outputPath, publication.bytes);
    })
  };
}

describe("presentation creation command", () => {
  it.each(["pptx", "potx", "ppsx"])(
    "publishes an independently inspectable %s without reading input",
    async (kind) => {
      const request = invocation([
        "create",
        "--kind",
        kind,
        "--output",
        `/work/deck.${kind}`,
        "--json"
      ]);
      const result = await engine.execute(request);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.length).toBe(0);
      expect(request.readInput).not.toHaveBeenCalled();
      const bytes = new Uint8Array(request.volume.readFileSync(`/work/deck.${kind}`) as Buffer);
      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      expect(JSON.parse(decode(result.stdout))).toMatchObject({
        operation: "create",
        ok: true,
        affected: 1,
        data: {
          fingerprint,
          outputs: [{ path: `/work/deck.${kind}`, sha256: fingerprint, bytes: bytes.length }]
        }
      });
      const index = await readSelectionIndex(bytes, { ...context, signal: request.signal });
      expect(index.inventory.counts).toMatchObject({
        slides: 0,
        masters: 1,
        layouts: 1,
        themes: 1
      });
    }
  );
  it("creates structured text on one slide and reopens it through inspect", async () => {
    const slides = [
      {
        name: "Field notes",
        shapes: [
          {
            name: "Heading",
            x: 914400,
            y: 914400,
            width: 4000000,
            height: 914400,
            text: "Cedar & sky"
          }
        ]
      }
    ];
    const request = invocation([
      "create",
      "--slides-json",
      JSON.stringify(slides),
      "--width",
      "10in",
      "--height",
      "180mm",
      "--timestamp",
      "2024-02-29T12:30:00Z",
      "--author",
      "Writer",
      "--output",
      "-",
      "--kind",
      "potx"
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.length).toBe(0);
    expect(request.publishOutput).not.toHaveBeenCalled();
    const inspected = await engine.execute({
      ...invocation(["inspect", "-", "--slide", "1", "--shape", "Heading", "--json"]),
      readInput: async () => result.stdout
    });
    expect(inspected.exitCode).toBe(0);
    expect(JSON.parse(decode(inspected.stdout)).data.records).toMatchObject([{ name: "Heading" }]);
  });
  it("reports dry-run effects with no publication or resulting fingerprint", async () => {
    const request = invocation(["create", "--dry-run", "--json"]);
    const result = await engine.execute(request);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      affected: 1,
      data: { outputs: [], fingerprint: null }
    });
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it("accepts explicit core property JSON and rejects ambiguous duplicate metadata", async () => {
    const properties = JSON.stringify({
      title: "Cedar",
      revision: 0,
      created: "2022-10-12T11:00:00Z",
      lastPrinted: "2023-01-02T01:02:03Z",
      lastModifiedBy: "Editor"
    });
    const valid = await engine.execute(
      invocation(["create", "--properties-json", properties, "--dry-run", "--json"])
    );
    expect(valid.exitCode).toBe(0);
    for (const value of [
      '{"revision":1,"revision":2}',
      '{"created":"2023-02-30T00:00:00Z"}',
      '{"extra":true}',
      '{"last_printed":"2023-01-02T01:02:03Z"}'
    ]) {
      const rejected = await engine.execute(
        invocation(["create", "--properties-json", value, "--dry-run", "--json"])
      );
      expect(rejected.exitCode).toBe(2);
    }
  });
  it.each([
    [],
    ["input.pptx", "--dry-run"],
    ["--in-place"],
    ["--output", "-", "--json"],
    ["--width", "10", "--dry-run"],
    ["--width", "Infinityin", "--dry-run"],
    ["--width", "1e2in", "--dry-run"],
    ["--width", "0in", "--dry-run"],
    ["--height", "3cm", "--height", "4cm", "--dry-run"],
    ["--kind", "pptm", "--dry-run"],
    ["--timestamp", "2024-02-30T00:00:00Z", "--dry-run"],
    ["--timestamp", "2024-01-01", "--dry-run"],
    ["--slide", "1", "--dry-run"],
    ["--slides-json", '[{"name":"A","name":"B"}]', "--dry-run"],
    ["--slides-json", '[{"shapes":[{"text":"a","text":"b"}]}]', "--dry-run"]
  ])("rejects invalid creation arguments %j before I/O", async (...args) => {
    const request = invocation([
      "create",
      ...args,
      ...((args as readonly string[]).includes("--json") ? [] : ["--json"])
    ]);
    const result = await engine.execute(request);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      operation: "create",
      ok: false,
      affected: 0
    });
    expect(request.readInput).not.toHaveBeenCalled();
    expect(request.publishOutput).not.toHaveBeenCalled();
  });
  it.each([
    ["--template", "source.potx"],
    ["--dialect", "strict"]
  ])("discloses unsupported %s creation before input reads", async (...args) => {
    const request = invocation(["create", ...args, "--dry-run", "--json"]);
    const result = await engine.execute(request);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(decode(result.stdout)).errors[0].code).toBe("unsupported-profile");
    expect(request.readInput).not.toHaveBeenCalled();
  });
  it("publishes executable discovery schemas for the actual options and result", async () => {
    const help = await engine.execute(invocation(["help", "create"]));
    expect(help.exitCode).toBe(0);
    expect(decode(help.stdout)).toContain("--properties-json");
    const result = await engine.execute(invocation(["schema", "create", "--json"]));
    expect(result.exitCode).toBe(0);
    const schema = JSON.parse(decode(result.stdout)).data.operations.create;
    expect(
      compileJsonSchema(schema.options).validate({
        output: "deck.pptx",
        width: { value: 10, unit: "in" }
      }).ok
    ).toBe(true);
    expect(compileJsonSchema(schema.options).validate({ kind: "pptm", dryRun: true }).ok).toBe(
      false
    );
    expect(
      compileJsonSchema(schema.options).validate({
        properties: { revision: 0, lastModifiedBy: "Editor" },
        dryRun: true
      }).ok
    ).toBe(true);
    const created = await engine.execute(invocation(["create", "--dry-run", "--json"]));
    expect(compileJsonSchema(schema.result).validate(JSON.parse(decode(created.stdout))).ok).toBe(
      true
    );
    const caps = await engine.execute(invocation(["capabilities", "--json"]));
    expect(JSON.parse(decode(caps.stdout)).data.features.creation.level).toBe("edit");
  });
});
