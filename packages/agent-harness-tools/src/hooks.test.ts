import { describe, expect, it, vi } from "vitest";
import {
  runWorkflowHook,
  type RunAgentInput,
  type WorkflowHook,
  type HookContext
} from "./hooks.js";

function createContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    cwd: "/workspace",
    participants: {
      default: {
        id: "default",
        agent: "claude-code",
        mode: "edit"
      },
      reviewer: {
        id: "reviewer",
        agent: "codex",
        mode: "read"
      }
    },
    runAgent: vi.fn(async (_input: RunAgentInput) => ({ exitCode: 0 })),
    ...overrides
  };
}

function getRunAgentInput(context: HookContext): RunAgentInput {
  return vi.mocked(context.runAgent).mock.calls[0]?.[0] as RunAgentInput;
}

function expectNoOptionalFields(input: RunAgentInput): void {
  expect("model" in input).toBe(false);
  expect("signal" in input).toBe(false);
}

describe("runWorkflowHook", () => {
  it("calls runAgent with the explicit participant agent", async () => {
    const context = createContext();
    const hook: WorkflowHook = {
      participant: "reviewer",
      prompt: "Review the workspace"
    };

    await runWorkflowHook(hook, context);

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "codex",
      prompt: "Review the workspace",
      mode: "read",
      cwd: "/workspace"
    });
    expectNoOptionalFields(input);
  });

  it("uses the default participant when the hook omits one", async () => {
    const context = createContext();

    await runWorkflowHook(
      {
        prompt: "Prepare the workspace"
      },
      context
    );

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "claude-code",
      prompt: "Prepare the workspace",
      mode: "edit",
      cwd: "/workspace"
    });
    expectNoOptionalFields(input);
  });

  it("passes the hook mode through to runAgent", async () => {
    const context = createContext();

    await runWorkflowHook(
      {
        participant: "reviewer",
        prompt: "Review in edit mode",
        mode: "edit"
      },
      context
    );

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "codex",
      prompt: "Review in edit mode",
      mode: "edit",
      cwd: "/workspace"
    });
    expectNoOptionalFields(input);
  });

  it("propagates hook failures", async () => {
    const error = new Error("hook failed");
    const context = createContext({
      runAgent: vi.fn(async () => {
        throw error;
      })
    });

    await expect(
      runWorkflowHook(
        {
          prompt: "Prepare the workspace"
        },
        context
      )
    ).rejects.toThrow(error);
  });

  it("forwards abort signals to runAgent", async () => {
    const controller = new AbortController();
    const context = createContext({
      signal: controller.signal
    });

    await runWorkflowHook(
      {
        prompt: "Prepare the workspace"
      },
      context
    );

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "claude-code",
      prompt: "Prepare the workspace",
      mode: "edit",
      cwd: "/workspace",
      signal: controller.signal
    });
    expect("signal" in input).toBe(true);
  });

  it("uses the only participant as the implicit default", async () => {
    const context = createContext({
      participants: {
        writer: {
          id: "writer",
          agent: "claude-code",
          mode: "edit"
        }
      }
    });

    await runWorkflowHook(
      {
        prompt: "Write the draft"
      },
      context
    );

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "claude-code",
      prompt: "Write the draft",
      mode: "edit",
      cwd: "/workspace"
    });
    expectNoOptionalFields(input);
  });

  it("forwards the participant model when defined", async () => {
    const context = createContext({
      participants: {
        default: {
          id: "default",
          agent: "claude-code",
          mode: "edit",
          model: "anthropic/claude-sonnet-4.5"
        }
      }
    });

    await runWorkflowHook(
      {
        prompt: "Prepare the workspace"
      },
      context
    );

    const input = getRunAgentInput(context);

    expect(input).toEqual({
      agent: "claude-code",
      prompt: "Prepare the workspace",
      mode: "edit",
      cwd: "/workspace",
      model: "anthropic/claude-sonnet-4.5"
    });
    expect("model" in input).toBe(true);
    expect("signal" in input).toBe(false);
  });

  it("throws when the hook references an unknown participant", async () => {
    const context = createContext();

    await expect(
      runWorkflowHook(
        {
          participant: "unknown",
          prompt: "Prepare the workspace"
        },
        context
      )
    ).rejects.toThrow("Unknown participant: unknown");
  });

  it("throws when the hook references an inherited participant name", async () => {
    const context = createContext({ participants: {} });

    await expect(
      runWorkflowHook(
        {
          participant: "toString",
          prompt: "Prepare the workspace",
          mode: "edit"
        },
        context
      )
    ).rejects.toThrow("Unknown participant: toString");
  });

  it("throws when the hook omits a participant without a default", async () => {
    const context = createContext({
      participants: {
        writer: {
          id: "writer",
          agent: "claude-code",
          mode: "edit"
        },
        reviewer: {
          id: "reviewer",
          agent: "codex",
          mode: "read"
        }
      }
    });

    await expect(
      runWorkflowHook(
        {
          prompt: "Prepare the workspace"
        },
        context
      )
    ).rejects.toThrow(
      "Hook is missing a participant and no default participant is defined."
    );
  });

  it("leaves mode unset when neither the hook nor participant defines one", async () => {
    const context = createContext({
      participants: {
        default: {
          id: "default",
          agent: "claude-code"
        }
      }
    });

    await runWorkflowHook(
      {
        prompt: "Prepare the workspace"
      },
      context
    );

    expect(getRunAgentInput(context)).toEqual({
      agent: "claude-code",
      prompt: "Prepare the workspace",
      cwd: "/workspace"
    });
    expect(Object.hasOwn(getRunAgentInput(context), "mode")).toBe(false);
  });
});
