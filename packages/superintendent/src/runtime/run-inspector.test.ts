import type { SuperintendentDoc } from "../document/parse.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { autonomousMock } = vi.hoisted(() => ({
  autonomousMock: vi.fn<
    (
      agent: string,
      options: {
        mode?: string;
        prompt: string;
        cwd?: string;
        mcpServers?: unknown;
        logPath?: string;
      }
    ) => Promise<unknown>
  >()
}));

vi.mock("./agent-runner.js", () => ({
  runAutonomousAgent: (input: {
    agent: string;
    mode?: string;
    prompt: string;
    cwd?: string;
    mcpServers?: unknown;
    logPath?: string;
  }) =>
    autonomousMock(input.agent, {
      cwd: input.cwd,
      prompt: input.prompt,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.logPath ? { logPath: input.logPath } : {})
    })
}));

const document: SuperintendentDoc = {
  filePath: "/repo/docs/plans/feature.md",
  body: "# Feature plan\n\n## Task Board\n\n- [ ] Ship the inspectors\n",
  frontmatter: {
    kind: "superintendent",
    version: 1,
    builder: {
      agent: "claude-code",
      prompt: "Build {{plan.path}}"
    },
    inspectors: {
      "code-quality": {
        agent: "codex",
        mode: "read",
        prompt: "Inspect {{plan.path}} after {{builder.summary}}"
      },
      "manual-qa": {
        agent: "claude-code",
        prompt: "Validate {{builder.log}} and {{inspectors.code-quality}}"
      }
    },
    superintendent: {
      agent: "claude-code",
      prompt: "Review {{builder.summary}}"
    },
    owner: {
      agent: "claude-code",
      prompt: "Review {{superintendent.summary}}"
    },
    status: {
      state: "in_progress",
      round: 0,
      review_turn: 0
    }
  }
};

describe("runInspector", () => {
  beforeEach(() => {
    autonomousMock.mockReset();
  });

  it("resolves the inspector prompt before invoking spawn.autonomous", async () => {
    autonomousMock.mockImplementation(async (agent, { mode, prompt, cwd }) => {
      expect(agent).toBe("codex");
      expect(mode).toBe("read");
      expect(cwd).toBe("/repo/docs/plans");
      expect(prompt).toContain("Inspect /repo/docs/plans/feature.md after Builder finished task 1");
      expect(prompt).not.toContain("{{plan.path}}");
      expect(prompt).not.toContain("{{builder.summary}}");
      return "No issues found";
    });

    const { runInspector } = await import("./run-inspector.js");

    await expect(
      runInspector(
        "code-quality",
        document.frontmatter.inspectors?.["code-quality"] ?? {
          agent: "codex",
          prompt: ""
        },
        document,
        {
          builder: {
            summary: "Builder finished task 1",
            log: "Changed files"
          }
        },
        { defaultCwd: "/repo/docs/plans" }
      )
    ).resolves.toEqual({
      name: "code-quality",
      summary: "No issues found"
    });
  });

  it("propagates spawn failures", async () => {
    autonomousMock.mockRejectedValue(new Error("inspector failed"));

    const { runInspector } = await import("./run-inspector.js");

    await expect(
      runInspector(
        "code-quality",
        document.frontmatter.inspectors?.["code-quality"] ?? {
          agent: "codex",
          prompt: ""
        },
        document,
        {},
        { defaultCwd: "/repo" }
      )
    ).rejects.toThrow("inspector failed");
  });

  it("uses an absolute cwd from the inspector config unchanged", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/other/workspace");
      return "ok";
    });

    const { runInspector } = await import("./run-inspector.js");

    await runInspector(
      "code-quality",
      {
        agent: "codex",
        cwd: "/other/workspace",
        prompt: "noop"
      },
      document,
      {},
      { defaultCwd: "/repo" }
    );
  });

  it("resolves a relative cwd against the document directory", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/repo/packages/agent-harness-tools");
      return "ok";
    });

    const { runInspector } = await import("./run-inspector.js");

    await runInspector(
      "code-quality",
      {
        agent: "codex",
        cwd: "../../packages/agent-harness-tools",
        prompt: "noop"
      },
      document,
      {},
      { defaultCwd: "/repo" }
    );
  });

  it("uses the prompt override verbatim when provided, skipping template resolution", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt).toContain("Re-check after the latest fix");
      return "Resolved";
    });

    const { runInspector } = await import("./run-inspector.js");

    await runInspector(
      "code-quality",
      document.frontmatter.inspectors?.["code-quality"] ?? {
        agent: "codex",
        prompt: ""
      },
      document,
      {},
      { defaultCwd: "/repo", promptOverride: "Re-check after the latest fix" }
    );

    expect(autonomousMock).toHaveBeenCalledTimes(1);
  });

  it("auto-injects builder summary and replay log into the inspector prompt", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt).toContain("`code-quality`");
      expect(prompt).toContain("Builder summary");
      expect(prompt).toContain("Built install.ts in packages/memory/src");
      expect(prompt).toContain(
        "npm run replay -- /tmp/spawn-logs/round-7-builder.jsonl"
      );
      expect(prompt).toContain("# Task");
      return "ok";
    });

    const { runInspector } = await import("./run-inspector.js");

    await runInspector(
      "code-quality",
      document.frontmatter.inspectors?.["code-quality"] ?? {
        agent: "codex",
        prompt: ""
      },
      document,
      {
        builder: {
          summary: "Built install.ts in packages/memory/src",
          log: "",
          log_path: "/tmp/spawn-logs/round-7-builder.jsonl"
        }
      },
      { defaultCwd: "/repo" }
    );
  });
});

describe("runAllInspectors", () => {
  beforeEach(() => {
    autonomousMock.mockReset();
  });

  it("runs inspectors sequentially and returns results in definition order", async () => {
    const activeAgents = new Set<string>();
    const calls: string[] = [];
    const resolvers = new Map<string, () => void>();
    let maxConcurrency = 0;

    autonomousMock.mockImplementation(
      (agent) =>
        new Promise((resolve) => {
          calls.push(`start:${agent}`);
          activeAgents.add(agent);
          maxConcurrency = Math.max(maxConcurrency, activeAgents.size);
          resolvers.set(agent, () => {
            calls.push(`end:${agent}`);
            activeAgents.delete(agent);
            resolve(`${agent} summary`);
          });
        })
    );

    const { runAllInspectors } = await import("./run-inspector.js");
    const runPromise = runAllInspectors(
      document,
      {
        builder: {
          summary: "Builder finished task 1",
          log: "Changed files"
        }
      },
      { defaultCwd: "/repo" }
    );

    await vi.waitFor(() => {
      expect(calls).toEqual(["start:codex"]);
      expect(autonomousMock).toHaveBeenCalledTimes(1);
    });

    resolvers.get("codex")?.();

    await vi.waitFor(() => {
      expect(calls).toEqual(["start:codex", "end:codex", "start:claude-code"]);
      expect(autonomousMock).toHaveBeenCalledTimes(2);
    });

    resolvers.get("claude-code")?.();

    await expect(runPromise).resolves.toEqual([
      { name: "code-quality", summary: "codex summary" },
      { name: "manual-qa", summary: "claude-code summary" }
    ]);
    expect(maxConcurrency).toBe(1);
  });

  it("resolves templates separately for each inspector", async () => {
    autonomousMock.mockImplementation(async (agent, { prompt }) => {
      if (agent === "codex") {
        expect(prompt).toContain("Inspect /repo/docs/plans/feature.md after Builder finished task 1");
        return "quality-ok";
      }

      expect(prompt).toContain("Validate Changed files and quality-ok");
      return "qa-ok";
    });

    const { runAllInspectors } = await import("./run-inspector.js");

    await expect(
      runAllInspectors(
        document,
        {
          builder: {
            summary: "Builder finished task 1",
            log: "Changed files"
          }
        },
        { defaultCwd: "/repo" }
      )
    ).resolves.toEqual([
      { name: "code-quality", summary: "quality-ok" },
      { name: "manual-qa", summary: "qa-ok" }
    ]);
  });

  it("returns an empty array when no inspectors are configured", async () => {
    const { runAllInspectors } = await import("./run-inspector.js");

    await expect(
      runAllInspectors(
        {
          ...document,
          frontmatter: {
            ...document.frontmatter,
            inspectors: undefined
          }
        },
        {},
        { defaultCwd: "/repo" }
      )
    ).resolves.toEqual([]);
    expect(autonomousMock).not.toHaveBeenCalled();
  });
});
