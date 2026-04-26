import { beforeEach, describe, expect, it, vi } from "vitest";

const explainPage = vi.fn();

vi.mock("./explain.js", () => ({
  explainPage
}));

const { runMemoryExplain } = await import("./explain.cli.js");

describe("runMemoryExplain", () => {
  beforeEach(() => {
    explainPage.mockReset();
  });

  it("delegates to explainPage with the provided arguments", async () => {
    explainPage.mockResolvedValue({
      answer: "summary",
      citations: [],
      tokensUsed: 10,
      budget: 2048,
      exitCode: 0,
      inboundPages: ["pages/architecture.md"],
      outboundSources: [{ path: "pages/incidents/retry.md" }]
    });

    const result = await runMemoryExplain({
      root: "/repo/.poe-code/memory",
      relPath: "pages/packages/superintendent.md",
      budget: 2048,
      agent: "claude-code"
    });

    expect(explainPage).toHaveBeenCalledWith("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 2048,
      agent: "claude-code"
    });
    expect(result.answer).toBe("summary");
  });
});
