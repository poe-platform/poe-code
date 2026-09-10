import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runTest262Corpus } from "./corpus.js";
import { runConformanceCommand } from "./command.js";

vi.mock("./corpus.js", () => ({ TEST262_REVISION: "pinned", runTest262Corpus: vi.fn() }));
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});
beforeEach(() => {
  vol.fromJSON({ "/reports/.keep": "" });
  vi.mocked(runTest262Corpus).mockImplementation(async options => {
    const entry = { filename: "example.js", kind: "test" as const, results: [{ mode: "sloppy" as const, status: "passed" as const }] };
    await options.onResult?.(entry);
    return { revision: "pinned", runtime: { node: "test", icu: "test" }, execution: { timeoutMs: options.timeoutMs, budget: {} },
      selections: options.selections ?? ["."], entries: [entry], harnessHashes: {},
      counts: { files: 1, fixtures: 0, metadataErrors: 0, executionErrors: 0, variants: 1, passed: 1, failed: 0, unsupported: 0 } };
  });
});
afterEach(() => { vol.reset(); vi.clearAllMocks(); });

it("writes a header, streamed entries and final summary", async () => {
  expect(await runConformanceCommand(["--corpus", "/corpus", "--report", "/reports/result.jsonl", "--include", "built-ins/Array/of", "--timeout-ms", "1000"])).toBe(0);
  const records = fs.readFileSync("/reports/result.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(records.map(record => record.type)).toEqual(["header", "result", "summary"]);
  expect(records[2]).toMatchObject({ counts: { passed: 1 }, execution: { timeoutMs: 1000 } });
  expect(records[2]).not.toHaveProperty("entries");
});

it("refuses to overwrite an existing report", async () => {
  vol.fromJSON({ "/reports/result.jsonl": "keep" });
  await expect(runConformanceCommand(["--corpus", "/corpus", "--report", "/reports/result.jsonl"])).rejects.toThrow();
  expect(fs.readFileSync("/reports/result.jsonl", "utf8")).toBe("keep");
  expect(runTest262Corpus).not.toHaveBeenCalled();
});

it.each([[], ["--corpus", "/corpus"], ["--corpus", "/corpus", "--report", "/reports/result.jsonl", "--timeout-ms", "0"]])("rejects invalid command arguments: %j", async args => {
  await expect(runConformanceCommand(args)).rejects.toThrow();
  expect(runTest262Corpus).not.toHaveBeenCalled();
});

it.each(["failed", "unsupported", "metadataErrors", "executionErrors"] as const)("returns failure for %s results", async category => {
  const implementation = vi.mocked(runTest262Corpus).getMockImplementation()!;
  vi.mocked(runTest262Corpus).mockImplementation(async options => {
    const report = await implementation(options);
    report.counts[category] = 1;
    if (category === "failed" || category === "unsupported") report.counts.passed = 0;
    return report;
  });
  expect(await runConformanceCommand(["--corpus", "/corpus", "--report", "/reports/result.jsonl"])).toBe(1);
});

it("leaves no successful summary when corpus execution aborts", async () => {
  vi.mocked(runTest262Corpus).mockRejectedValue(new Error("corpus changed"));
  await expect(runConformanceCommand(["--corpus", "/corpus", "--report", "/reports/result.jsonl"])).rejects.toThrow("corpus changed");
  const records = fs.readFileSync("/reports/result.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(records.map(record => record.type)).toEqual(["header"]);
});
