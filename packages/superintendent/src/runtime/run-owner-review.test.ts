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

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: autonomousMock
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
      expect(prompt).toBe(
        "Review /repo/docs/plans/feature.md after Superintendent says the board is complete"
      );
      expect(prompt).not.toContain("{{plan.path}}");
      expect(prompt).not.toContain("{{superintendent.summary}}");

      return {
        toolCalls: [
          {
            name: "workflow.transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(
      runOwnerReview(document, {
        superintendent: {
          summary: "Superintendent says the board is complete"
        }
      })
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
          { name: "workflow.transition", arguments: { action: "approve_completion" } }
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
      {}
    );
  });

  it("resolves a relative owner cwd against the document directory", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/repo/packages/agent-kit");
      return {
        toolCalls: [
          { name: "workflow.transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          owner: { ...document.frontmatter.owner, cwd: "../../packages/agent-kit" }
        }
      },
      {}
    );
  });

  it("injects the workflow tool for the owner in review state", async () => {
    autonomousMock.mockImplementation(async (_, { mcpServers }) => {
      expect(readWorkflowTool(mcpServers)).toEqual(createWorkflowTool("owner", "review"));

      return {
        toolCalls: [
          {
            name: "workflow.transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(
      runOwnerReview(document, {
        superintendent: {
          summary: "Ready"
        }
      })
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
            name: "workflow.transition",
            arguments: {
              action: "approve_completion"
            }
          }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(documentWithMcpTimeout, {})).resolves.toEqual({
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
          { name: "workflow.transition", arguments: { action: "approve_completion" } }
        ]
      };
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await runOwnerReview(document, {});
  });

  it("returns approve_completion when the owner calls the workflow tool", async () => {
    autonomousMock.mockResolvedValue({
      sessionResult: {
        toolCalls: [
          {
            name: "workflow.transition",
            arguments: JSON.stringify({
              action: "approve_completion"
            })
          }
        ]
      }
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {})).resolves.toEqual({
      transition: {
        action: "approve_completion"
      }
    });
  });

  it("returns request_changes with feedback when the owner asks for more work", async () => {
    autonomousMock.mockResolvedValue({
      toolCalls: [
        {
          name: "workflow.transition",
          arguments: {
            action: "request_changes",
            feedback: "Task 2 is not done"
          }
        }
      ]
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {})).resolves.toEqual({
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

    await expect(runOwnerReview(document, {})).rejects.toThrow(
      "Owner review must end with workflow.transition"
    );
  });

  it("rejects transitions that are not valid for the owner review state", async () => {
    autonomousMock.mockResolvedValue({
      toolCalls: [
        {
          name: "workflow.transition",
          arguments: {
            action: "request_review",
            summary: "Ready for owner review"
          }
        }
      ]
    });

    const { runOwnerReview } = await import("./run-owner-review.js");

    await expect(runOwnerReview(document, {})).rejects.toThrow(
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
