import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import type { AgentTraceFileSystem } from "@poe-code/agent-traces";
import type { TraceTreeNode, TraceView } from "./types.js";
import { writeTraceHtml } from "./write-html.js";

function createFs(): AgentTraceFileSystem {
  return createFsFromVolume(new Volume()).promises as unknown as AgentTraceFileSystem;
}

function sampleTree(): TraceTreeNode {
  const view: TraceView = {
    source: "claude",
    id: "abc/def",
    title: "Sample",
    turns: [{ role: "human", text: "hi" }],
    context: { tokens: 1, window: 100, percent: 1, source: "estimated" },
    breakdown: { measuredTokens: 1, categories: [], source: "exact" }
  };
  return { view, children: [] };
}

describe("writeTraceHtml", () => {
  it("writes to an explicit outPath", async () => {
    const fs = createFs();
    const result = await writeTraceHtml(sampleTree(), {
      fs,
      outPath: "/out/trace.html"
    });

    expect(result.path).toBe("/out/trace.html");
    expect(result.bytes).toBeGreaterThan(100);
    const content = await fs.readFile("/out/trace.html", "utf8");
    expect(content).toContain("<!doctype html>");
    expect(content).toContain("Sample");
  });

  it("defaults under tmpDir/poe-code-traces with a sanitized id", async () => {
    const fs = createFs();
    const result = await writeTraceHtml(sampleTree(), {
      fs,
      tmpDir: "/tmp-root"
    });

    expect(result.path).toBe(path.join("/tmp-root", "poe-code-traces", "trace-abc-def.html"));
    await expect(fs.readFile(result.path, "utf8")).resolves.toContain("poe-code");
  });
});
