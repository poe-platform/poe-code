import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { createSpawnMock } from "@poe-code/agent-spawn/testing";
import { MEMORY_AGENT_JSON_CONTRACT } from "./agent-response.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const mockedAgentSpawn = vi.hoisted(() => ({
  spawnMock: undefined as ReturnType<typeof createSpawnMock> | undefined
}));

vi.mock("@poe-code/agent-spawn", () => {
  const spawnMock = createSpawnMock();
  mockedAgentSpawn.spawnMock = spawnMock;
  return spawnMock.factory();
});

const resolveAgent = vi.fn();

vi.mock("@poe-code/poe-code-config/core", () => ({
  resolveAgent
}));

const { queryMemory, selectQueryContext, rankPagesForQuery } = await import("./query.js");

describe("rankPagesForQuery", () => {
  it("ranks exact name/description matches above unrelated pages", () => {
    const ranked = rankPagesForQuery(
      [
        {
          relPath: "pages/packages/superintendent.md",
          frontmatter: { name: "superintendent", description: "Retry rules and checkpoints" },
          body: "# Superintendent\n\nRetry on ENOENT.",
          bytes: 0,
          mtimeMs: 0
        },
        {
          relPath: "pages/architecture.md",
          frontmatter: { description: "Package wiring overview" },
          body: "# Architecture\n\nGeneral overview.",
          bytes: 0,
          mtimeMs: 0
        }
      ],
      "why does superintendent retry on ENOENT"
    );

    expect(ranked.map((page) => page.relPath)).toEqual([
      "pages/packages/superintendent.md",
      "pages/architecture.md"
    ]);
  });
});

describe("selectQueryContext", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("returns all pages when they fit within budget", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/a.md": "---\ndescription: Alpha\n---\n# Alpha\n\nhello\n",
      "/repo/.poe-code/memory/pages/b.md": "---\ndescription: Beta\n---\n# Beta\n\nworld\n"
    });

    const context = await selectQueryContext(
      "/repo/.poe-code/memory",
      "alpha",
      10_000
    );

    expect(context.selectedPages.map((page) => page.relPath)).toEqual([
      "pages/a.md",
      "pages/b.md"
    ]);
    expect(context.truncated).toBe(false);
    expect(context.tokensUsed).toBeGreaterThan(0);
  });

  it("throws when the budget cannot fit INDEX.md", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n- [alpha](pages/a.md)\n"
    });

    await expect(selectQueryContext("/repo/.poe-code/memory", "alpha", 1)).rejects.toThrow(
      /budget too small/i
    );
  });

  it("rejects non-finite token budgets", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/a.md": "# Alpha\n\nhello\n"
    });

    await expect(selectQueryContext("/repo/.poe-code/memory", "alpha", Number.NaN)).rejects.toThrow(
      "budget must be a finite non-negative number"
    );
  });
});

describe("queryMemory", () => {
  beforeEach(() => {
    vol.reset();
    resolveAgent.mockReset();
    resolveAgent.mockResolvedValue("claude-code");
    mockedAgentSpawn.spawnMock!.spawn.mockReset();
  });

  it("returns an empty answer without spawning when memory has no pages", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n"
    });

    const result = await queryMemory("/repo/.poe-code/memory", {
      question: "what is this repo?",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
    expect(result).toEqual({
      answer: "",
      citations: [],
      tokensUsed: 0,
      budget: 4096,
      exitCode: 0
    });
  });

  it("spawns the configured agent with memory-only context and parses citations", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        answer: "Retries happen during cleanup races.",
        citations: [
          {
            relPath: "pages/packages/superintendent.md",
            section: "checkpoints",
            confidence: "extracted"
          }
        ],
        tokensUsed: 321
      }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n- [superintendent](pages/packages/superintendent.md)\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": [
        "---",
        "description: Loop harness",
        "---",
        "# Superintendent",
        "",
        "## checkpoints",
        "",
        "<!-- memory:extracted source=src/phases.ts#L1-L4 -->",
        "Retries happen during cleanup races.",
        ""
      ].join("\n")
    });

    const result = await queryMemory("/repo/.poe-code/memory", {
      question: "why retry?",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining("Answer using only the provided memory pages")
      })
    );
    expect(mockedAgentSpawn.spawnMock!.spawn.mock.calls[0]?.[1]?.prompt).toContain("# Memory index");
    expect(mockedAgentSpawn.spawnMock!.spawn.mock.calls[0]?.[1]?.prompt).toContain(
      "pages/packages/superintendent.md"
    );
    expect(resolveAgent.mock.calls[0]?.[0].projectFilePath).toBe("/repo/.poe-code/config.json");
    expect(result).toEqual({
      answer: "Retries happen during cleanup races.",
      citations: [
        {
          relPath: "pages/packages/superintendent.md",
          section: "checkpoints",
          confidence: "extracted"
        }
      ],
      tokensUsed: 321,
      budget: 4096,
      exitCode: 0
    });
  });

  it("bounds the agent spawn with a default activity timeout", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await queryMemory("/repo/.poe-code/memory", {
      question: "what?",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({ activityTimeoutMs: 10 * 60 * 1000 })
    );
  });

  it("forwards an explicit activity timeout to the agent spawn", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await queryMemory("/repo/.poe-code/memory", {
      question: "what?",
      budget: 4096,
      activityTimeoutMs: 1_500
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({ activityTimeoutMs: 1_500 })
    );
  });

  it("forwards an explicit model override to the agent spawn", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await queryMemory("/repo/.poe-code/memory", {
      question: "what?",
      budget: 4096,
      model: "Claude-Sonnet-4.5"
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({ model: "Claude-Sonnet-4.5" })
    );
  });

  it("states the JSON contract the response is parsed against", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await queryMemory("/repo/.poe-code/memory", { question: "what?", budget: 4096 });

    expect(mockedAgentSpawn.spawnMock!.spawn.mock.calls[0]?.[1]?.prompt).toContain(
      MEMORY_AGENT_JSON_CONTRACT
    );
  });

  it("surfaces agent stderr when the agent answers with prose instead of JSON", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: "Sure! Here is what I found.",
      stderr: "warning: model unavailable",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await expect(
      queryMemory("/repo/.poe-code/memory", { question: "what?", budget: 4096 })
    ).rejects.toThrow('stderr: "warning: model unavailable"');
  });

  it("rejects malformed agent citations and impossible token counts", async () => {
    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        answer: "Looks valid at the top level.",
        citations: [null, "bad", { relPath: 123, confidence: "made-up" }],
        tokensUsed: -10
      }),
      stderr: "",
      exitCode: 0
    });

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/note.md": "# Note\n\nbody\n"
    });

    await expect(
      queryMemory("/repo/.poe-code/memory", {
        question: "what?",
        budget: 4096
      })
    ).rejects.toThrow("Memory agent returned an invalid result payload.");
  });
});
