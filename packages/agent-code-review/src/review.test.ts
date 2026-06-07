import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CodeReviewYamlStore } from "./review-store.js";
import { createCodeReviewState } from "./review-store.js";
import { runCodeReview } from "./review.js";
import { spawn } from "@poe-code/agent-spawn";
import { discoverCodeReviewProfiles } from "./assets.js";

vi.mock("@poe-code/agent-spawn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/agent-spawn")>()),
  spawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
}));

const assetMocks = vi.hoisted(() => ({
  loadProfile: vi.fn(async () => "custom profile"),
  loadPrompt: vi.fn(async () => "custom prompt")
}));

vi.mock("./assets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assets.js")>();
  return {
    ...actual,
    discoverCodeReviewProfiles: vi.fn(async () => [
      {
        name: "generic",
        content: "generic profile",
        source: "built-in" as const
      }
    ]),
    loadCodeReviewProfile: assetMocks.loadProfile,
    loadCodeReviewPrompt: assetMocks.loadPrompt
  };
});

const prUrl = "https://github.com/acme/widgets/pull/123";

function createStore(): CodeReviewYamlStore {
  const state = {
    ...createCodeReviewState({
      sessionId: "session-1",
      prUrl,
      selectedAgent: "codex",
      selectedProfiles: ["generic"]
    }),
    mergedReview: { body: "Looks good.", comments: [] }
  };
  return {
    startRun: vi.fn(async () => state),
    appendOrchestratorAction: vi.fn(async () => state),
    read: vi.fn(async () => state)
  } as unknown as CodeReviewYamlStore;
}

describe("runCodeReview asset paths", () => {
  it("uses and propagates configured external profile directories", async () => {
    const spawnAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    await runCodeReview(
      { prUrl, cwd: "/repo/worktree" },
      {
        resolveOptions: async (input) => ({
          ...input,
          agent: "codex",
          draftStore: ".poe-code/code-review/reviews",
          humanGate: { provider: "none" },
          profileDirectories: ["/catalog"]
        }),
        fetchPr: async () => ({}),
        fetchDiff: async () => "",
        fetchComments: async () => ({}),
        store: createStore(),
        spawnAgent
      }
    );

    expect(discoverCodeReviewProfiles).toHaveBeenCalledWith({
      cwd: "/repo/worktree",
      filters: undefined,
      profileDirectories: ["/catalog"]
    });
    expect(spawnAgent.mock.calls[0]?.[2].mcpServers["code-review"].args).toContain(
      "[\"/catalog\"]"
    );
  });

  it("resolves explicit profile and prompt paths relative to cwd", async () => {
    const cwd = "/repo/worktree";

    await runCodeReview(
      { prUrl, cwd, profilePath: "profiles/security.md", promptPath: "prompts/review.md" },
      {
        resolveOptions: async (input) => ({
          ...input,
          agent: "codex",
          draftStore: ".poe-code/code-review/reviews",
          humanGate: { provider: "none" }
        }),
        fetchPr: async () => ({}),
        fetchDiff: async () => "",
        fetchComments: async () => ({}),
        store: createStore(),
        spawnAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
      }
    );

    expect(assetMocks.loadProfile).toHaveBeenCalledWith(resolve(cwd, "profiles/security.md"));
    expect(assetMocks.loadPrompt).toHaveBeenCalledWith(resolve(cwd, "prompts/review.md"));
  });

  it.each(["codex", "claude-code", "claude", "CLAUDE"])(
    "pipes %s text-safe orchestrator prompts through stdin",
    async (agent) => {
      vi.mocked(spawn).mockClear();
      await runCodeReview(
        { prUrl, cwd: "/repo/worktree" },
        {
          resolveOptions: async (input) => ({
            ...input,
            agent,
            draftStore: ".poe-code/code-review/reviews",
            humanGate: { provider: "none" }
          }),
          fetchPr: async () => ({}),
          fetchDiff: async () => "",
          fetchComments: async () => ({}),
          store: createStore()
        }
      );

      expect(spawn).toHaveBeenCalledWith(agent, expect.objectContaining({ useStdin: true }));
    }
  );

  it.each(["kimi", "goose"])(
    "does not pipe raw text into the %s structured-input orchestrator",
    async (agent) => {
      vi.mocked(spawn).mockClear();
      await runCodeReview(
        { prUrl, cwd: "/repo/worktree" },
        {
          resolveOptions: async (input) => ({
            ...input,
            agent,
            draftStore: ".poe-code/code-review/reviews",
            humanGate: { provider: "none" }
          }),
          fetchPr: async () => ({}),
          fetchDiff: async () => "",
          fetchComments: async () => ({}),
          store: createStore()
        }
      );

      expect(spawn).toHaveBeenCalledWith(agent, expect.not.objectContaining({ useStdin: true }));
    }
  );
});
