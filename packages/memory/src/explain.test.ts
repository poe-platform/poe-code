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

const { explainPage } = await import("./explain.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("explainPage", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    resolveAgent.mockReset();
    resolveAgent.mockResolvedValue("claude-code");
    mockedAgentSpawn.spawnMock!.spawn.mockReset();
  });

  it("returns an empty answer without spawning when the target page is missing", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n"
    });

    const result = await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
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

  it("does not hide target page read errors with inherited missing codes", async () => {
    const pagePath = "/repo/.poe-code/memory/pages/packages/superintendent.md";
    vol.fromJSON({
      [pagePath]: "# Superintendent\n"
    });
    const readFile = vol.promises.readFile.bind(vol.promises);
    vi.spyOn(vol.promises, "readFile").mockImplementation(async (...args) => {
      if (String(args[0]) === pagePath) {
        throw new Error("explain read denied");
      }

      return readFile(...args);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        explainPage("/repo/.poe-code/memory", {
          relPath: "pages/packages/superintendent.md",
          budget: 4096
        })
      ).rejects.toThrow("explain read denied");
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).not.toHaveBeenCalled();
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

    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        answer: "Superintendent retries during cleanup races.",
        citations: [
          {
            relPath: "pages/packages/superintendent.md",
            section: "checkpoints",
            confidence: "extracted"
          }
        ],
        tokensUsed: 222
      }),
      stderr: "",
      exitCode: 0
    });

    const result = await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({
        prompt: expect.stringContaining(
          "Summarize the target page using only the provided memory pages"
        )
      })
    );
    const prompt = mockedAgentSpawn.spawnMock!.spawn.mock.calls[0]?.[1]?.prompt ?? "";
    expect(prompt).toContain("Target page: pages/packages/superintendent.md");
    expect(prompt).toContain("FILE: pages/packages/superintendent.md");
    expect(prompt).toContain("FILE: pages/architecture.md");
    expect(prompt).toContain("FILE: pages/incidents/retry.md");
    expect(resolveAgent.mock.calls[0]?.[0].projectFilePath).toBe("/repo/.poe-code/config.json");

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

  it("forwards an explicit model override to the agent spawn", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n\nRetries happen during cleanup races.\n"
    });

    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096,
      model: "Claude-Sonnet-4.5"
    });

    expect(mockedAgentSpawn.spawnMock!.spawn).toHaveBeenCalledWith(
      "claude-code",
      expect.objectContaining({ model: "Claude-Sonnet-4.5" })
    );
  });

  it("throws when the budget cannot fit the required explain context", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n\nRetries happen during cleanup races.\n"
    });

    await expect(
      explainPage("/repo/.poe-code/memory", {
        relPath: "pages/packages/superintendent.md",
        budget: 1
      })
    ).rejects.toThrow(/budget too small/i);
  });

  it("states the JSON contract the response is parsed against", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n"
    });

    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({ answer: "ok", citations: [], tokensUsed: 1 }),
      stderr: "",
      exitCode: 0
    });

    await explainPage("/repo/.poe-code/memory", {
      relPath: "pages/packages/superintendent.md",
      budget: 4096
    });

    expect(mockedAgentSpawn.spawnMock!.spawn.mock.calls[0]?.[1]?.prompt).toContain(
      MEMORY_AGENT_JSON_CONTRACT
    );
  });

  it("surfaces agent stderr when the agent answers with prose instead of JSON", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n"
    });

    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: "Here is the summary you asked for.",
      stderr: "warning: model unavailable",
      exitCode: 0
    });

    await expect(
      explainPage("/repo/.poe-code/memory", {
        relPath: "pages/packages/superintendent.md",
        budget: 4096
      })
    ).rejects.toThrow('stderr: "warning: model unavailable"');
  });

  it("rejects malformed agent citations and impossible token counts", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/pages/packages/superintendent.md": "# Superintendent\n"
    });

    mockedAgentSpawn.spawnMock!.spawn.mockResolvedValueOnce({
      stdout: JSON.stringify({
        answer: "Looks valid at the top level.",
        citations: [{ relPath: "pages/packages/superintendent.md", confidence: "invented" }],
        tokensUsed: -1
      }),
      stderr: "",
      exitCode: 0
    });

    await expect(
      explainPage("/repo/.poe-code/memory", {
        relPath: "pages/packages/superintendent.md",
        budget: 4096
      })
    ).rejects.toThrow("Memory agent returned an invalid result payload.");
  });
});
