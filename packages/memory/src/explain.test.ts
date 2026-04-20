import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const resolveAgent = vi.fn();

vi.mock("@poe-code/poe-code-config", () => ({
  resolveAgent
}));

const { explainPage } = await import("./explain.js");

describe("explainPage", () => {
  beforeEach(() => {
    vol.reset();
    resolveAgent.mockReset();
    resolveAgent.mockResolvedValue("claude-code");
  });

  it("returns an empty answer without spawning when the target page is missing", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n"
    });

    const spawnFn = vi.fn();
    const result = await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096,
      spawnFn
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(result).toEqual({
      answer: "",
      citations: [],
      tokensUsed: 0,
      budget: 4096,
      exitCode: 0,
      inboundPages: [],
      outboundSources: []
    });
  });

  it("includes inbound and outbound memory pages in the explain prompt", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": [
        "# Memory index",
        "- [architecture](pages/architecture.md)",
        "- [packages/superintendent](pages/packages/superintendent.md)",
        "- [incidents/retry](pages/incidents/retry.md)",
        ""
      ].join("\n"),
      "/repo/.poe-code/memory/pages/packages/superintendent.md": [
        "---",
        "description: Loop harness",
        "sources:",
        "  - pages/incidents/retry.md",
        "  - src/phases.ts#L1-L4",
        "---",
        "# Superintendent",
        "",
        "## checkpoints",
        "",
        "Retries happen during cleanup races.",
        ""
      ].join("\n"),
      "/repo/.poe-code/memory/pages/architecture.md": [
        "---",
        "sources:",
        "  - pages/packages/superintendent.md",
        "---",
        "# Architecture",
        "",
        "Superintendent coordinates retries.",
        ""
      ].join("\n"),
      "/repo/.poe-code/memory/pages/incidents/retry.md": [
        "# Retry incident",
        "",
        "History of the cleanup race.",
        ""
      ].join("\n")
    });

    const spawnFn = vi.fn().mockResolvedValue({
      answer: "Superintendent retries during cleanup races.",
      citations: [
        {
          relPath: "pages/packages/superintendent.md",
          section: "checkpoints",
          confidence: "extracted"
        }
      ],
      tokensUsed: 222,
      exitCode: 0
    });

    const result = await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096,
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalledWith(
      "claude-code",
      expect.stringContaining("Summarize the target page using only the provided memory pages")
    );
    const prompt = spawnFn.mock.calls[0]?.[1] ?? "";
    expect(prompt).toContain("Target page: pages/packages/superintendent.md");
    expect(prompt).toContain("FILE: pages/packages/superintendent.md");
    expect(prompt).toContain("FILE: pages/architecture.md");
    expect(prompt).toContain("FILE: pages/incidents/retry.md");

    expect(result).toEqual({
      answer: "Superintendent retries during cleanup races.",
      citations: [
        {
          relPath: "pages/packages/superintendent.md",
          section: "checkpoints",
          confidence: "extracted"
        }
      ],
      tokensUsed: 222,
      budget: 4096,
      exitCode: 0,
      inboundPages: ["pages/architecture.md"],
      outboundSources: [
        { path: "pages/incidents/retry.md" },
        { path: "src/phases.ts", startLine: 1, endLine: 4 }
      ]
    });
  });

  it("throws when the budget cannot fit the required explain context", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n\nRetries happen during cleanup races.\n"
    });

    await expect(
      explainPage("/repo/.poe-code/memory", {
        relPath: "pages/packages/superintendent.md",
        budget: 1,
        spawnFn: vi.fn()
      })
    ).rejects.toThrow(/budget too small/i);
  });
});
