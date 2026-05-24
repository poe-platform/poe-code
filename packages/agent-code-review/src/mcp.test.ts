import { describe, expect, it, vi } from "vitest";
import { createCodeReviewState } from "./review-store.js";
import { createCodeReviewAgentMcpConfig, createCodeReviewAgentMcpGroup } from "./mcp.js";

describe("createCodeReviewAgentMcpConfig", () => {
  it("launches the MCP server through the shipped root executable", () => {
    expect(
      createCodeReviewAgentMcpConfig({
        role: "agent",
        session: "session-1",
        actor: "reviewer",
        cwd: "/repo",
        agent: "codex"
      })
    ).toEqual({
      transport: "stdio",
      command: "poe-code",
      args: [
        "code-review",
        "agent-mcp",
        "--role",
        "agent",
        "--session",
        "session-1",
        "--actor",
        "reviewer",
        "--cwd",
        "/repo",
        "--agent",
        "codex"
      ]
    });
  });

  it.each([
    ["audit logging", { appendFailure: new Error("Store unavailable") }, "Store unavailable"],
    ["PR loading", { fetchFailure: new Error("GitHub unavailable") }, "GitHub unavailable"]
  ])("marks %s failures as failed instead of leaving pending state", async (_label, failure, message) => {
    const states: Array<{ status: string; error?: string }> = [];
    const state = createCodeReviewState({
      sessionId: "session-1",
      prUrl: "https://github.com/acme/repo/pull/1",
      selectedAgent: "codex",
      selectedProfiles: ["generic"]
    });
    const group = createCodeReviewAgentMcpGroup(
      {
        role: "orchestrator",
        session: "session-1",
        actor: "orchestrator",
        cwd: "/repo",
        agent: "codex"
      },
      {
        store: {
          read: vi.fn(async () => state),
          addSubagent: vi.fn(async (_pr, _actor, status) => {
            states.push(status);
            return state;
          }),
          updateSubagent: vi.fn(async (_pr, _actor, status) => {
            states.push(status);
            return state;
          }),
          appendOrchestratorAction: vi.fn(async () => {
            if ("appendFailure" in failure) throw failure.appendFailure;
            return state;
          })
        } as never,
        fetchPr: vi.fn(async () => {
          if ("fetchFailure" in failure) throw failure.fetchFailure;
          return {};
        })
      }
    );
    const spawnCommand = group.children.find(({ name }) => name === "code_review_agent_spawn");

    expect(spawnCommand).toBeDefined();
    await expect(
      spawnCommand?.handler({
        params: { pr: "https://github.com/acme/repo/pull/1", profile: "generic" }
      } as never)
    ).resolves.toEqual({ actor: "generic", agent: "codex", status: "pending" });
    await vi.waitFor(() => {
      expect(states.at(-1)).toMatchObject({ status: "failed", error: message });
    });
  });
});
