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
        mcpServers?: Record<string, { command: string; args?: string[] }>;
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
  body: "# Feature plan\n\n## Task Board\n\n- [ ] Ship the superintendent\n",
  frontmatter: {
    kind: "superintendent",
    version: 1,
    mcp: {
      delegate: {
        command: "poe-superintendent-mcp"
      },
      plan_browser: {
        command: "poe-code",
        args: ["plan", "list"]
      }
    },
    builder: {
      agent: "claude-code",
      prompt: "Build {{plan.path}}"
    },
    superintendent: {
      agent: "codex",
      mode: "read",
      prompt: "Review {{plan.path}} after {{builder.summary}} and {{owner.feedback}}"
    },
    owner: {
      agent: "claude-code",
      prompt: "Approve {{superintendent.summary}}"
    },
    status: {
      state: "in_progress",
      round: 1,
      review_turn: 0
    }
  }
};

describe("runSuperintendent", () => {
  beforeEach(() => {
    autonomousMock.mockReset();
  });

  it("resolves the prompt and injects the workflow tool for the current state", async () => {
    autonomousMock.mockImplementation(async (agent, { mode, prompt, cwd, mcpServers }) => {
      expect(agent).toBe("codex");
      expect(mode).toBe("read");
      expect(cwd).toBe("/repo/docs/plans");
      expect(prompt).toBe(
        "Review /repo/docs/plans/feature.md after Builder finished task 1 and Needs one more pass"
      );
      expect(prompt).not.toContain("{{plan.path}}");
      expect(prompt).not.toContain("{{builder.summary}}");
      expect(prompt).not.toContain("{{owner.feedback}}");
      expect(readWorkflowTool(mcpServers)).toEqual(
        createWorkflowTool("superintendent", "review")
      );

      return {
        summary: "Continuing planning work"
      };
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(
      runSuperintendent(
        {
          ...document,
          frontmatter: {
            ...document.frontmatter,
            status: {
              ...document.frontmatter.status,
              state: "review"
            }
          }
        },
        {
          builder: {
            summary: "Builder finished task 1"
          },
          owner: {
            feedback: "Needs one more pass"
          }
        }
      )
    ).resolves.toEqual({
      summary: "Continuing planning work"
    });
  });

  it("includes additional MCP tools from frontmatter", async () => {
    autonomousMock.mockImplementation(async (_, { mcpServers }) => {
      expect(mcpServers).toMatchObject({
        delegate: {
          command: "poe-superintendent-mcp"
        },
        plan_browser: {
          command: "poe-code",
          args: ["plan", "list"]
        }
      });
      expect(readWorkflowTool(mcpServers)).toEqual(
        createWorkflowTool("superintendent", "in_progress")
      );
      expect(Object.keys(mcpServers ?? {})).toHaveLength(3);

      return "Still planning";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(runSuperintendent(document, {})).resolves.toEqual({
      summary: "Still planning"
    });
  });

  it("parses a workflow transition from a structured tool call", async () => {
    autonomousMock.mockResolvedValue({
      summary: "All planned work is complete",
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

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(runSuperintendent(document, {})).resolves.toEqual({
      summary: "All planned work is complete",
      transition: {
        action: "request_review",
        summary: "Ready for owner review"
      }
    });
  });

  it("uses the transition summary when the MCP server namespace prefixes the tool call", async () => {
    autonomousMock.mockResolvedValue({
      sessionResult: {
        toolCalls: [
          {
            name: "__superintendent_workflow_transition__.workflow.transition",
            arguments: JSON.stringify({
              action: "request_review",
              summary: "Ready for owner review"
            })
          }
        ]
      }
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(runSuperintendent(document, {})).resolves.toEqual({
      summary: "Ready for owner review",
      transition: {
        action: "request_review",
        summary: "Ready for owner review"
      }
    });
  });

  it("returns no transition when the superintendent keeps planning", async () => {
    autonomousMock.mockResolvedValue("Continue with the next batch of tasks");

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(runSuperintendent(document, {})).resolves.toEqual({
      summary: "Continue with the next batch of tasks"
    });
  });

});

function readWorkflowTool(
  mcpServers: Record<string, { command: string; args?: string[] }> | undefined
): unknown {
  const workflowServer = Object.values(mcpServers ?? {}).find(
    (server) => server.command === "poe-superintendent-mcp" && server.args?.[0] === "workflow-transition"
  );

  expect(workflowServer).toBeDefined();

  return JSON.parse(Buffer.from(workflowServer?.args?.[1] ?? "", "base64").toString("utf8"));
}
