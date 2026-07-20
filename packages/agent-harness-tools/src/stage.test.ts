import { describe, expect, it, vi } from "vitest";
import { runWorkflowStage, type WorkflowStage, type StageContext } from "./stage.js";
import type { RunAgentInput } from "./hooks.js";

function createContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    cwd: "/workspace",
    iteration: 0,
    participants: {
      builder: {
        id: "builder",
        agent: "claude-code",
        mode: "edit"
      },
      reviewer: {
        id: "reviewer",
        agent: ["codex", "kimi"],
        mode: "read"
      },
      planner: {
        id: "planner",
        agent: "codex",
        prompt: "Plan the work",
        model: "openai/gpt-5.4"
      }
    },
    runAgent: vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 })),
    ...overrides
  };
}

function getRunAgentInput(context: StageContext): RunAgentInput {
  return vi.mocked(context.runAgent).mock.calls[0]?.[0] as RunAgentInput;
}

describe("runWorkflowStage", () => {
  it("resolves the correct participant and agent", async () => {
    const context = createContext();
    const stage: WorkflowStage = {
      id: "review",
      participant: "reviewer",
      prompt: "Review the changes"
    };

    await expect(runWorkflowStage(stage, context)).resolves.toEqual({ success: true });

    expect(getRunAgentInput(context)).toEqual({
      agent: "codex",
      prompt: "Review the changes",
      mode: "read",
      cwd: "/workspace"
    });
  });

  it("selects round-robin agents across iterations", async () => {
    const context = createContext({ iteration: 1 });

    await runWorkflowStage(
      {
        id: "review",
        participant: "reviewer",
        prompt: "Review the changes"
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "kimi",
      prompt: "Review the changes",
      mode: "read",
      cwd: "/workspace"
    });
  });

  it("lets the stage mode override the participant mode", async () => {
    const context = createContext();

    await runWorkflowStage(
      {
        id: "review",
        participant: "reviewer",
        prompt: "Review in edit mode",
        mode: "edit"
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "codex",
      prompt: "Review in edit mode",
      mode: "edit",
      cwd: "/workspace"
    });
  });

  it("falls back to participant prompt and model", async () => {
    const context = createContext();

    await runWorkflowStage(
      {
        id: "plan",
        participant: "planner",
        mode: "read"
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "codex",
      prompt: "Plan the work",
      mode: "read",
      cwd: "/workspace",
      model: "openai/gpt-5.4"
    });
  });

  it("forwards stage skills to runAgent", async () => {
    const context = createContext();

    await runWorkflowStage(
      {
        id: "build",
        participant: "builder",
        prompt: "Build the feature",
        skills: ["foo", "claude/bar"]
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "claude-code",
      prompt: "Build the feature",
      mode: "edit",
      cwd: "/workspace",
      skills: ["foo", "claude/bar"]
    });
  });

  it("forwards stage hooks to runAgent", async () => {
    const context = createContext();

    await runWorkflowStage(
      {
        id: "build",
        participant: "builder",
        prompt: "Build the feature",
        hooks: { from: "claude" }
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "claude-code",
      prompt: "Build the feature",
      mode: "edit",
      cwd: "/workspace",
      hooks: { from: "claude" }
    });
  });

  it("throws for an unknown participant", async () => {
    const context = createContext();

    await expect(
      runWorkflowStage(
        {
          id: "review",
          participant: "unknown",
          prompt: "Review the changes"
        },
        context
      )
    ).rejects.toThrow("Unknown participant: unknown");
  });

  it("throws for an inherited participant name", async () => {
    await expect(
      runWorkflowStage(
        {
          id: "review",
          participant: "toString",
          prompt: "Review the changes",
          mode: "read"
        },
        createContext({ participants: {} })
      )
    ).rejects.toThrow("Unknown participant: toString");
  });

  it("leaves mode unset when neither the stage nor participant define one", async () => {
    const context = createContext();

    await expect(
      runWorkflowStage(
        {
          id: "plan",
          participant: "planner"
        },
        context
      )
    ).resolves.toEqual({ success: true });

    expect(getRunAgentInput(context)).toEqual({
      agent: "codex",
      prompt: "Plan the work",
      cwd: "/workspace",
      model: "openai/gpt-5.4"
    });
    expect(Object.hasOwn(getRunAgentInput(context), "mode")).toBe(false);
  });

  it('throws on error when onFailure is "stop"', async () => {
    const error = new Error("stage failed");
    const context = createContext({
      runAgent: vi.fn(async () => {
        throw error;
      })
    });

    await expect(
      runWorkflowStage(
        {
          id: "build",
          participant: "builder",
          prompt: "Build the feature",
          onFailure: "stop"
        },
        context
      )
    ).rejects.toThrow(error);
  });

  it('returns success false on error when onFailure is "continue"', async () => {
    const error = new Error("stage failed");
    const context = createContext({
      runAgent: vi.fn(async () => {
        throw error;
      })
    });

    await expect(
      runWorkflowStage(
        {
          id: "build",
          participant: "builder",
          prompt: "Build the feature",
          onFailure: "continue"
        },
        context
      )
    ).resolves.toEqual({ success: false, error });
  });

  it("normalizes thrown non-Error values when continuing on failure", async () => {
    const context = createContext({
      runAgent: vi.fn(async () => {
        throw "stage failed";
      })
    });

    await expect(
      runWorkflowStage(
        {
          id: "build",
          participant: "builder",
          prompt: "Build the feature",
          onFailure: "continue"
        },
        context
      )
    ).resolves.toEqual({
      success: false,
      error: new Error("stage failed")
    });
  });

  it("forwards abort signals to runAgent", async () => {
    const controller = new AbortController();
    const context = createContext({
      signal: controller.signal
    });

    await runWorkflowStage(
      {
        id: "build",
        participant: "builder",
        prompt: "Build the feature"
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "claude-code",
      prompt: "Build the feature",
      mode: "edit",
      cwd: "/workspace",
      signal: controller.signal
    });
  });
});
