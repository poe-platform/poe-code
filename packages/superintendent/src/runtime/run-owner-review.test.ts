import type { SuperintendentDoc } from "../document/parse.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowTool } from "./workflow-tool.js";

const { autonomousMock } = vi.hoisted(() => ({
  autonomousMock: vi.fn<
    (
      agent: string,
      options: {
        mode?: string;
        prompt: string;
        cwd?: string;
        mcpServers?: Record<string, { command: string; args?: string[]; timeout?: number }>;
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
  body: "# Feature plan\n\n## Task Board\n\n- [x] Finish task 1\n- [ ] Finish task 2\n",
  frontmatter: {
    kind: "superintendent",
    version: 1,
    builder: {
      agent: "claude-code",
      prompt: "Build {{plan.path}}"
    },
    superintendent: {
      agent: "codex",
      prompt: "Review {{builder.summary}}"
    },
    owner: {
      agent: "claude-code",
      mode: "read",
      prompt: "Review {{plan.path}} after {{superintendent.summary}}"
    },
    status: {
      state: "review",
      round: 1,
      review_turn: 1
    }
  }
};

const documentWithMcpTimeout: SuperintendentDoc = {
  ...document,
  frontmatter: {
    ...document.frontmatter,
    mcp: {
      "plan-browser": {
        command: "poe-code",
        args: ["plan", "list"],
        timeout: 90
      }
    }
  }
};

describe("runOwnerReview", () => {
  beforeEach(() => {
    autonomousMock.mockReset();
  });

  it("resolves the owner prompt with the superintendent summary", async () => {
    autonomousMock.mockImplementation(async (agent, { mode, prompt, cwd }) => {
      expect(agent).toBe("claude-code");
      expect(mode).toBe("read");
      expect(cwd).toBe("/repo/docs/plans");
      expect(prompt).toContain(
        "Review /repo/docs/plans/feature.md after Superintendent says the board is complete"
      );
      expect(prompt).toContain("workflow_transition");
      expect(prompt).toContain("approve_completion");
      expect(prompt).toContain("request_changes");
      expect(prompt).not.toContain("{{plan.path}}");
      expect(prompt).not.toContain("{{superintendent.summary}}");

      return {
        toolCalls: [
          {
            name: "workflow_transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(
      runOwnerReview(
        document,
        {
          superintendent: {
            summary: "Superintendent says the board is complete"
          }
        },
        { defaultCwd: "/repo/docs/plans" }
      )
    ).resolves.toEqual({
      transition: {
        action: "approve_completion"
      }
    });
  });

  it("uses an absolute cwd from the owner config unchanged", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/other/workspace");
      return {
        toolCalls: [
          { name: "workflow_transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          owner: { ...document.frontmatter.owner, cwd: "/other/workspace" }
        }
      },
      {},
      { defaultCwd: "/repo" }
    );
  });

  it("resolves a relative owner cwd against the document directory", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/repo/packages/agent-harness-tools");
      return {
        toolCalls: [
          { name: "workflow_transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          owner: { ...document.frontmatter.owner, cwd: "../../packages/agent-harness-tools" }
        }
      },
      {},
      { defaultCwd: "/repo" }
    );
  });

  it("injects the workflow tool for the owner in review state", async () => {
    autonomousMock.mockImplementation(async (_, { mcpServers }) => {
      expect(readWorkflowTool(mcpServers)).toEqual(createWorkflowTool("owner", "review"));

      return {
        toolCalls: [
          {
            name: "workflow_transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(
      runOwnerReview(
        document,
        { superintendent: { summary: "Ready" } },
        { defaultCwd: "/repo/docs/plans" }
      )
    ).resolves.toEqual({
      transition: {
        action: "approve_completion"
      }
    });
  });

  it("propagates mcp timeout values to spawn", async () => {
    autonomousMock.mockImplementation(async (_, { mcpServers }) => {
      expect(mcpServers).toMatchObject({
        "plan-browser": {
          command: "poe-code",
          args: ["plan", "list"],
          timeout: 90
        }
      });

      return {
        toolCalls: [
          {
            name: "workflow_transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(documentWithMcpTimeout, {}, { defaultCwd: "/repo/docs/plans" })).resolves.toEqual({
      transition: {
        action: "approve_completion"
      }
    });
  });

  it("sets a timeout on the owner workflow MCP server", async () => {
    autonomousMock.mockImplementation(async (_, { mcpServers }) => {
      const workflowServer = findWorkflowServer(mcpServers);
      expect(workflowServer?.timeout).toBe(7200);

      return {
        toolCalls: [
          { name: "workflow_transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" });
  });

  it("returns approve_completion when the owner calls the workflow tool", async () => {
    autonomousMock.mockResolvedValue({
      sessionResult: {
        toolCalls: [
          {
            name: "workflow_transition",
            arguments: JSON.stringify({
              action: "approve_completion"
            })
          }
        ]
      }
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).resolves.toEqual({
      transition: {
        action: "approve_completion"
      }
    });
  });

  it("returns request_changes with feedback when the owner asks for more work", async () => {
    autonomousMock.mockResolvedValue({
      toolCalls: [
        {
          name: "workflow_transition",
          arguments: {
            action: "request_changes",
            feedback: "Task 2 is not done"
          }
        }
      ]
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).resolves.toEqual({
      transition: {
        action: "request_changes",
        feedback: "Task 2 is not done"
      }
    });
  });

  it("rejects structured text approval without an explicit workflow transition call", async () => {
    autonomousMock.mockResolvedValue({
      output: JSON.stringify({
        transition: {
          action: "approve_completion"
        }
      })
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).rejects.toThrow(
      "Owner review must end with workflow_transition"
    );
  });

  it("includes observed tool names and log path in the error when workflow_transition is not called", async () => {
    autonomousMock.mockResolvedValue({
      toolCalls: [
        { title: "Read", input: { file_path: "/repo/docs/plans/feature.md" } },
        { title: "Bash", input: { command: "ls" } }
      ],
      logFile: "/tmp/logs/owner.jsonl"
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).rejects.toThrow(
      /Owner review must end with workflow_transition\. Observed tool calls: Read, Bash\. See spawn log: \/tmp\/logs\/owner\.jsonl/
    );
  });

  it("notes when no tool calls were captured at all", async () => {
    autonomousMock.mockResolvedValue({
      stdout: "I think the work looks good."
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).rejects.toThrow(
      "Owner review must end with workflow_transition. No tool calls were captured."
    );
  });

  it("prepends a system prompt ahead of the resolved owner prompt", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt.startsWith("# System")).toBe(true);
      expect(prompt).toContain("# Task");
      expect(prompt.indexOf("# System")).toBeLessThan(prompt.indexOf("# Task"));
      expect(prompt).toContain("workflow_transition");
      expect(prompt).toContain("approve_completion");
      expect(prompt).toContain("request_changes");

      return {
        toolCalls: [
          { name: "workflow_transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" });
  });

  it("rejects transitions that are not valid for the owner review state", async () => {
    autonomousMock.mockResolvedValue({
      toolCalls: [
        {
          name: "workflow_transition",
          arguments: {
            action: "request_review",
            summary: "Ready for owner review"
          }
        }
      ]
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {}, { defaultCwd: "/repo/docs/plans" })).rejects.toThrow(
      "Owner review returned invalid transition: request_review"
    );
  });
});

function findWorkflowServer(
  mcpServers: Record<string, { command: string; args?: string[]; timeout?: number }> | undefined
): { command: string; args?: string[]; timeout?: number } | undefined {
  return Object.values(mcpServers ?? {}).find(
    (server) => server.command === "poe-superintendent-mcp" && server.args?.[0] === "workflow-transition"
  );
}

function readWorkflowTool(
  mcpServers: Record<string, { command: string; args?: string[]; timeout?: number }> | undefined
): unknown {
  const workflowServer = findWorkflowServer(mcpServers);

  expect(workflowServer).toBeDefined();

  return JSON.parse(Buffer.from(workflowServer?.args?.[1] ?? "", "base64").toString("utf8"));
}
