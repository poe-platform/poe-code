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
  it("shows chart creation selectors and the complete supported type list", async () => {
    const help = await run(["charts", "add", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.text).toContain("pptx charts add INPUT --slide N");
    for (const flag of ["--shape", "--select", "--all", "--allow-empty", "--workbook-policy"])
      expect(help.text).not.toContain(flag);
    for (const type of [
      "AREA",
      "AREA_STACKED",
      "AREA_STACKED_100",
      "DOUGHNUT",
      "DOUGHNUT_EXPLODED",
      "RADAR",
      "RADAR_FILLED",
      "RADAR_MARKERS",
      "BUBBLE",
      "BUBBLE_THREE_D_EFFECT",
      "BAR_CLUSTERED",
      "BAR_STACKED",
      "BAR_STACKED_100",
      "COLUMN_CLUSTERED",
      "COLUMN_STACKED",
      "COLUMN_STACKED_100",
      "LINE",
      "LINE_MARKERS",
      "LINE_MARKERS_STACKED",
      "LINE_MARKERS_STACKED_100",
      "LINE_STACKED",
      "LINE_STACKED_100",
      "PIE",
      "PIE_EXPLODED",
      "XY_SCATTER",
      "XY_SCATTER_LINES",
      "XY_SCATTER_LINES_NO_MARKERS",
      "XY_SCATTER_SMOOTH",
      "XY_SCATTER_SMOOTH_NO_MARKERS"
    ])
      expect(help.text.replaceAll("\n", " ").replaceAll(",", " ").split(" ")).toContain(type);
    expect(Math.max(...help.text.split("\n").map((line) => line.length))).toBeLessThanOrEqual(100);
    expect(readInput).not.toHaveBeenCalled();
    expect(help.text).toContain('"bubbleSizes":[0,5]');
    expect(help.text).toContain("categoryLevels");
  });
  it.each(["set", "replace"])("shows only applicable %s mutation options", async (action) => {
    const help = await run(["charts", action, "--help"]);
    expect(help.text).toContain(`pptx charts ${action} INPUT`);
    for (const flag of ["--shape", "--select", "--all", "--allow-empty", "--data"])
      expect(help.text).toContain(flag);
    expect(help.text).not.toContain("--type");
    if (action === "replace") {
      expect(help.text).toContain("--workbook-policy");
      expect(help.text).not.toContain("--style");
      expect(help.text).not.toContain("--width");
    } else {
      expect(help.text).toContain("--style");
      expect(help.text).toContain("--width");
      expect(help.text).not.toContain("--workbook-policy");
    }
    expect(Math.max(...help.text.split("\n").map((line) => line.length))).toBeLessThanOrEqual(100);
  });
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
  it("advertises chart inspection and supported editing", async () => {
    const result = await run(["capabilities", "--json"]);
    expect(JSON.parse(result.text).data.features.charts).toMatchObject({
      level: "edit",
      operations: ["charts.list", "charts.get", "charts.add", "charts.set", "charts.replace"]
    });
  });
});
