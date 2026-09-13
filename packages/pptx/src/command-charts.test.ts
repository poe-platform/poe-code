import { describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 64, maxRelationships: 64 }
};
const engine = createPptxCommandEngine({ context, maxArgumentBytes: 8192, maxOutputBytes: 65536 });
const readInput = vi.fn(async () => new Uint8Array());
const run = async (args: string[]) => {
  const result = await engine.execute({
    args: args.map((arg) => new TextEncoder().encode(arg)),
    signal: new AbortController().signal,
    readInput
  });
  return { ...result, text: new TextDecoder().decode(result.stdout) };
};

describe("chart command discovery and admission", () => {
  it.each(["list", "get"])(
    "publishes the %s schema and help without reading input",
    async (action) => {
      const schema = await run(["schema", "charts", action, "--json"]);
      expect(schema.exitCode).toBe(0);
      const operations = JSON.parse(schema.text).data.operations;
      expect(Object.keys(operations)).toEqual([`charts.${action}`]);
      expect(operations[`charts.${action}`].options.properties.scope.enum).toEqual(["slides"]);
      const validator = compileJsonSchema(operations[`charts.${action}`].result);
      const failure = await run([
        "charts",
        action,
        "deck.pptx",
        "--output",
        "other.pptx",
        "--json"
      ]);
      expect(failure.exitCode).toBe(2);
      expect(validator.validate(JSON.parse(failure.text)).ok).toBe(true);
      const help = await run(["charts", action, "--help"]);
      expect(help.exitCode).toBe(0);
      expect(help.text).toContain("--shape");
      expect(help.text).toContain("--limit");
      expect(readInput).not.toHaveBeenCalled();
    }
  );
  it.each([
    "--all",
    "--dry-run",
    "--scope notes",
    "--slide 0",
    "--shape Name --select token",
    "--scope slides --select token",
    "--slide 1 --slide 2"
  ])("rejects inapplicable or conflicting flags: %s", async (flags) => {
    const result = await run(["charts", "list", "deck.pptx", ...flags.split(" "), "--json"]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.text)).toMatchObject({
      operation: "charts.list",
      ok: false,
      data: null,
      affected: 0
    });
    expect(readInput).not.toHaveBeenCalled();
  });
  it("advertises chart inspection separately from unsupported editing", async () => {
    const result = await run(["capabilities", "--json"]);
    expect(JSON.parse(result.text).data.features.charts).toMatchObject({
      level: "read",
      operations: ["charts.list", "charts.get"]
    });
  });
});
