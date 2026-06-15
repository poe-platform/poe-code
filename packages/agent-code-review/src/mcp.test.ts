import { describe, expect, it, vi } from "vitest";
import { createCodeReviewState } from "./review-store.js";
import { spawn } from "@poe-code/agent-spawn";
import { toJsonSchema } from "toolcraft-schema";
import { createCodeReviewAgentMcpConfig, createCodeReviewAgentMcpGroup } from "./mcp.js";
import { parseCodeReviewAgentMcpArgs } from "./mcp.js";

vi.mock("@poe-code/agent-spawn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/agent-spawn")>()),
  spawn: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
}));

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

  it("propagates external profile directories to spawned MCP servers", () => {
    expect(
      createCodeReviewAgentMcpConfig({
        role: "orchestrator",
        session: "session-1",
        actor: "orchestrator",
        cwd: "/repo",
        agent: "codex",
        profileDirectories: ["/catalog-a", "/catalog-b"]
      }).args
    ).toContain('["/catalog-a","/catalog-b"]');
  });

  it("parses external profile directories from spawned MCP args", () => {
    expect(
      parseCodeReviewAgentMcpArgs([
        "--role",
        "orchestrator",
        "--session",
        "session-1",
        "--actor",
        "orchestrator",
        "--cwd",
        "/repo",
        "--agent",
        "codex",
        "--profile-directories",
        '["/catalog"]'
      ]).profileDirectories
    ).toEqual(["/catalog"]);
  });

  it.each([
    ["audit logging", { appendFailure: new Error("Store unavailable") }, "Store unavailable"],
    ["PR loading", { fetchFailure: new Error("GitHub unavailable") }, "GitHub unavailable"]
  ])(
    "marks %s failures as failed instead of leaving pending state",
    async (_label, failure, message) => {
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
    }
  );
});

describe("createCodeReviewAgentMcpGroup orchestrator tools", () => {
  it("exposes integer schemas for inline comment line numbers and indexes", () => {
    const group = createCodeReviewAgentMcpGroup({
      role: "orchestrator",
      session: "session-1",
      actor: "orchestrator",
      cwd: "/repo",
      agent: "codex"
    });
    const schemaFor = (name: string) => {
      const command = group.children.find((child) => child.name === name);
      expect(command).toBeDefined();
      return toJsonSchema(command?.params);
    };

    expect(schemaFor("code_review_create_draft")).toMatchObject({
      properties: {
        comments: {
          items: { properties: { line: { type: "integer", minimum: 1 } } }
        }
      }
    });
    expect(schemaFor("code_review_edit_inline_comment")).toMatchObject({
      properties: {
        index: { type: "integer", minimum: 0 },
        line: { type: "integer", minimum: 1 }
      }
    });
    expect(schemaFor("code_review_delete_inline_comment")).toMatchObject({
      properties: {
        index: { type: "integer", minimum: 0 }
      }
    });
  });

  it.each(["codex", "claude-code", "claude", "CLAUDE"])(
    "spawns %s nested reviewers using stdin-safe prompt transport",
    async (agent) => {
      const state = createCodeReviewState({
        sessionId: "session-1",
        prUrl: "https://github.com/acme/repo/pull/1",
        selectedAgent: agent,
        selectedProfiles: ["generic"]
      });
      const group = createCodeReviewAgentMcpGroup(
        {
          role: "orchestrator",
          session: "session-1",
          actor: "orchestrator",
          cwd: "/repo",
          agent
        },
        {
          store: {
            read: vi.fn(async () => state),
            addSubagent: vi.fn(async () => state),
            updateSubagent: vi.fn(async () => state),
            appendOrchestratorAction: vi.fn(async () => state)
          } as never,
          fetchPr: vi.fn(async () => ({}))
        }
      );
      const command = group.children.find(({ name }) => name === "code_review_agent_spawn");

      vi.mocked(spawn).mockClear();
      await command?.handler({
        params: { pr: "https://github.com/acme/repo/pull/1", profile: "generic" }
      } as never);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      expect(spawn).toHaveBeenCalledWith(agent, expect.objectContaining({ useStdin: true }));
    }
  );

  it.each(["kimi", "goose"])(
    "does not pass raw text stdin to the %s structured-input protocol",
    async (agent) => {
      const state = createCodeReviewState({
        sessionId: "session-1",
        prUrl: "https://github.com/acme/repo/pull/1",
        selectedAgent: agent,
        selectedProfiles: ["generic"]
      });
      const group = createCodeReviewAgentMcpGroup(
        {
          role: "orchestrator",
          session: "session-1",
          actor: "orchestrator",
          cwd: "/repo",
          agent
        },
        {
          store: {
            read: vi.fn(async () => state),
            addSubagent: vi.fn(async () => state),
            updateSubagent: vi.fn(async () => state),
            appendOrchestratorAction: vi.fn(async () => state)
          } as never,
          fetchPr: vi.fn(async () => ({}))
        }
      );
      const command = group.children.find(({ name }) => name === "code_review_agent_spawn");

      vi.mocked(spawn).mockClear();
      await command?.handler({
        params: { pr: "https://github.com/acme/repo/pull/1", profile: "generic" }
      } as never);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      expect(spawn).toHaveBeenCalledWith(agent, expect.not.objectContaining({ useStdin: true }));
    }
  );

  it("exposes local merged-draft edit, delete, and discard commands", async () => {
    const state = createCodeReviewState({
      sessionId: "session-1",
      prUrl: "https://github.com/acme/repo/pull/1",
      selectedAgent: "codex",
      selectedProfiles: ["generic"]
    });
    const editedState = {
      ...state,
      state: "merged" as const,
      mergedReview: { body: "Summary", comments: [{ path: "src/a.ts", line: 3, body: "edit" }] }
    };
    const store = {
      read: vi.fn(async () => editedState),
      editMergedInlineComment: vi.fn(async () => editedState),
      deleteMergedInlineComment: vi.fn(async () => editedState),
      discardMergedReview: vi.fn(async () => state),
      appendOrchestratorAction: vi.fn(async () => editedState)
    };
    const group = createCodeReviewAgentMcpGroup(
      {
        role: "orchestrator",
        session: "session-1",
        actor: "orchestrator",
        cwd: "/repo",
        agent: "codex"
      },
      { store: store as never }
    );
    const command = (name: string) => group.children.find((child) => child.name === name);

    await command("code_review_edit_inline_comment")?.handler({
      params: { pr: state.prUrl, index: 0, path: "src/a.ts", line: 3, body: "edit" }
    } as never);
    await command("code_review_delete_inline_comment")?.handler({
      params: { pr: state.prUrl, index: 0 }
    } as never);
    await command("code_review_discard_draft")?.handler({ params: { pr: state.prUrl } } as never);

    expect(store.editMergedInlineComment).toHaveBeenCalledWith(state.prUrl, 0, {
      path: "src/a.ts",
      line: 3,
      body: "edit"
    });
    expect(store.deleteMergedInlineComment).toHaveBeenCalledWith(state.prUrl, 0);
    expect(store.discardMergedReview).toHaveBeenCalledWith(state.prUrl);
  });
});

describe("createCodeReviewAgentMcpGroup subagent tools", () => {
  it("does not create orphan draft state for subagent raw reviews", async () => {
    const store = {
      read: vi.fn(async () => undefined),
      create: vi.fn(),
      addRawReview: vi.fn()
    };
    const group = createCodeReviewAgentMcpGroup(
      {
        role: "subagent",
        session: "session-1",
        actor: "generic",
        cwd: "/repo",
        agent: "codex",
        profiles: ["generic"]
      },
      { store: store as never }
    );
    const command = group.children.find((child) => child.name === "code_review_create_draft");

    await expect(
      command?.handler({
        params: {
          pr: "https://github.com/acme/other/pull/99",
          body: "Looks good.",
          comments: []
        }
      } as never)
    ).rejects.toThrow("No draft review exists for pull request");
    expect(store.create).not.toHaveBeenCalled();
    expect(store.addRawReview).not.toHaveBeenCalled();
  });
});
