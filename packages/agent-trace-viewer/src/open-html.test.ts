import { pathToFileURL } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { AgentTraceFileSystem } from "@poe-code/agent-traces";
import { openTraceHtml } from "./open-html.js";
import type { TraceTreeNode, TraceView } from "./types.js";

function createFs(): AgentTraceFileSystem {
  return createFsFromVolume(new Volume()).promises as unknown as AgentTraceFileSystem;
}

function sampleTree(): TraceTreeNode {
  const view: TraceView = {
    source: "claude",
    id: "open-me",
    title: "Open me",
    turns: [{ role: "human", text: "hi" }],
    context: { tokens: 1, window: 100, percent: 1, source: "estimated" },
    breakdown: { measuredTokens: 1, categories: [], source: "exact" }
  };
  return { view, children: [] };
}

describe("openTraceHtml", () => {
  it("writes then opens a file URL", async () => {
    const fs = createFs();
    const open = vi.fn(async () => undefined);

    const result = await openTraceHtml(sampleTree(), {
      fs,
      outPath: "/tmp/open.html",
      open
    });

    expect(result.path).toBe("/tmp/open.html");
    expect(open).toHaveBeenCalledWith(pathToFileURL("/tmp/open.html").href);
    await expect(fs.readFile("/tmp/open.html", "utf8")).resolves.toContain("<!doctype html>");
  });

  it("propagates open errors after writing", async () => {
    const fs = createFs();
    const open = vi.fn(async () => {
      throw new Error("Browser launcher exited with code 1");
    });

    await expect(
      openTraceHtml(sampleTree(), {
        fs,
        outPath: "/tmp/fail.html",
        open
      })
    ).rejects.toThrow("Browser launcher exited with code 1");

    await expect(fs.readFile("/tmp/fail.html", "utf8")).resolves.toContain("<!doctype html>");
  });
});
