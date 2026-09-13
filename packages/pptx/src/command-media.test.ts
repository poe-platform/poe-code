import { Volume } from "memfs";
import { it, expect, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPresentation, createPptxCommandEngine } from "./index.js";

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
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 }
};
async function fixture() {
  const bytes = await createPresentation({ slides: [] }, context);
  const volume = Volume.fromJSON({ "/deck.pptx": Buffer.from(bytes) });
  const readInput = vi.fn(
    async (path: string) => new Uint8Array(volume.readFileSync(path) as Buffer)
  );
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  const run = async (args: string[]) => {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput
    });
    return { ...result, text: new TextDecoder().decode(result.stdout) };
  };
  return { run, readInput };
}
it("reports empty media lists, missing singular reads and truthful capabilities", async () => {
  const f = await fixture();
  const list = await f.run(["media", "list", "/deck.pptx", "--json"]);
  expect(list.exitCode, list.text).toBe(0);
  expect(JSON.parse(list.text)).toMatchObject({
    operation: "media.list",
    affected: 0,
    data: { occurrences: [], media: [], playbackVerified: false }
  });
  const schema = JSON.parse((await f.run(["schema", "media", "list", "--json"])).text).data
    .operations["media.list"];
  expect(compileJsonSchema(schema.result).validate(JSON.parse(list.text)).ok).toBe(true);
  const get = await f.run(["media", "get", "/deck.pptx", "--json"]);
  expect(get.exitCode).toBe(1);
  expect(JSON.parse(get.text).errors[0].code).toBe("missing-selection");
  const caps = JSON.parse((await f.run(["capabilities", "--json"])).text);
  expect(caps.data.features.media.operations).toEqual(["media.list", "media.get"]);
  expect((await f.run(["media", "list", "--help"])).text).toContain("does not prove playback");
});
it("rejects media mutation flags and mixed selectors before reading", async () => {
  const f = await fixture();
  for (const flags of [
    ["--output", "/out.pptx"],
    ["--all"],
    ["--scope", "presentation"],
    ["--shape", "Clip"],
    ["--select", "token", "--slide", "1"],
    ["--slide", "0"],
    ["--json", "--json"]
  ]) {
    const result = await f.run(["media", "list", "/deck.pptx", "--json", ...flags]);
    expect(result.exitCode, result.text).toBe(2);
    expect(JSON.parse(result.text).operation).toBe("media.list");
  }
  expect(f.readInput).not.toHaveBeenCalled();
});
