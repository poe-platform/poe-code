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
      expect(prompt).toContain(
        "Review /repo/docs/plans/feature.md after Builder finished task 1 and Needs one more pass"
      );
      expect(prompt).toContain("workflow_transition");
      expect(prompt).toContain("request_review");
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

  it("uses an absolute cwd from the superintendent config unchanged", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/other/workspace");
      return "ok";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await runSuperintendent(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          superintendent: { ...document.frontmatter.superintendent, cwd: "/other/workspace" }
        }
      },
      {}
    );
  });

  it("resolves a relative superintendent cwd against the document directory", async () => {
    autonomousMock.mockImplementation(async (_, { cwd }) => {
      expect(cwd).toBe("/repo/packages/agent-kit");
      return "ok";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await runSuperintendent(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          superintendent: {
            ...document.frontmatter.superintendent,
            cwd: "../../packages/agent-kit"
          }
        }
      },
      {}
    );
  });

  it("parses a workflow transition from a structured tool call", async () => {
    autonomousMock.mockResolvedValue({
      summary: "All planned work is complete",
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

    const { runSuperintendent } = await import("./run-superintendent.js");

    await expect(runSuperintendent(document, {})).resolves.toEqual({
      summary: "All planned work is complete",
      transition: {
        action: "request_review",
        summary: "Ready for owner review"
      }
    });
  });

  it("extracts the transition from a Claude-Code-namespaced MCP tool call in sessionResult", async () => {
    autonomousMock.mockResolvedValue({
      sessionResult: {
        toolCalls: [
          {
            title: "mcp__superintendent-tools__workflow_transition",
            input: {
              action: "request_review",
              summary: "Ready for owner review"
            }
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

  it("prepends a system prompt ahead of the resolved plan prompt", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt.startsWith("# System")).toBe(true);
      expect(prompt).toContain("# Task");
      expect(prompt.indexOf("# System")).toBeLessThan(prompt.indexOf("# Task"));
      expect(prompt).toContain("workflow_transition");
      expect(prompt).toContain("request_review");
      expect(prompt).toContain("builder_run");

      return "ok";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await runSuperintendent(document, {});
  });

  it("lists configured inspector names in the system prompt", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt).toContain("inspector_run");
      expect(prompt).toContain("code-quality");
      expect(prompt).toContain("testing");

      return "ok";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await runSuperintendent(
      {
        ...document,
        frontmatter: {
          ...document.frontmatter,
          inspectors: {
            "code-quality": { agent: "claude-code", prompt: "Review quality" },
            testing: { agent: "claude-code", prompt: "Run tests" }
          }
        }
      },
      {}
    );
  });

  it("omits inspector_run from the system prompt when no inspectors are configured", async () => {
    autonomousMock.mockImplementation(async (_, { prompt }) => {
      expect(prompt).not.toContain("inspector_run");

      return "ok";
    });

    const { runSuperintendent } = await import("./run-superintendent.js");

    await runSuperintendent(document, {});
  });

});

function readWorkflowTool(
  mcpServers: Record<string, { command: string; args?: string[] }> | undefined
): unknown {
  const payload = readSuperintendentToolsPayload(mcpServers);
  return createWorkflowTool("superintendent", payload.state);
}

function readSuperintendentToolsPayload(
  mcpServers: Record<string, { command: string; args?: string[] }> | undefined
): { docPath: string; state: "in_progress" | "review" | "completed"; inspectorNames: string[] } {
  const server = Object.values(mcpServers ?? {}).find(
    (entry) => entry.command === "poe-superintendent-mcp" && entry.args?.[0] === "superintendent-tools"
  );

  expect(server).toBeDefined();

  return JSON.parse(Buffer.from(server?.args?.[1] ?? "", "base64").toString("utf8"));
}
