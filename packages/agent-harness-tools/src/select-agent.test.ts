import { describe, expect, it } from "vitest";
import { resolveLoopAgent } from "./select-agent.js";

function createInput(
  overrides: Partial<Parameters<typeof resolveLoopAgent>[0]> = {}
): Parameters<typeof resolveLoopAgent>[0] {
  return {
    assumeYes: false,
    fallbackAgent: "goose",
    message: "Select an agent",
    select: async () => {
      throw new Error("select should not be called");
    },
    isCancel: () => false,
    ...overrides
  };
}

describe("resolveLoopAgent", () => {
  it("uses providedAgent before every other source", async () => {
    let selectCalls = 0;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => {
      selectCalls += 1;
      return "codex";
    };

    const result = await resolveLoopAgent(
      createInput({
        providedAgent: "claude:anthropic/claude-opus-4.6",
        configuredDefaultAgent: "codex",
        frontmatterAgent: "goose",
        assumeYes: true,
        fallbackAgent: "kimi",
        select
      })
    );

    expect(result).toEqual({
      agent: "claude-code:anthropic/claude-opus-4.6"
    });
    expect(selectCalls).toBe(0);
  });

  it("resolves the gemini alias for loop execution", async () => {
    const result = await resolveLoopAgent(
      createInput({
        providedAgent: "GeMiNi"
      })
    );

    expect(result).toEqual({ agent: "gemini-cli" });
  });

  it("uses a string frontmatter agent when CLI agent is absent", async () => {
    let selectCalls = 0;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => {
      selectCalls += 1;
      return "codex";
    };

    const result = await resolveLoopAgent(
      createInput({
        frontmatterAgent: "claude",
        configuredDefaultAgent: "codex",
        assumeYes: true,
        fallbackAgent: "kimi",
        select
      })
    );

    expect(result).toEqual({ agent: "claude-code" });
    expect(selectCalls).toBe(0);
  });

  it("rejects array frontmatter because that case is handled by the caller", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          frontmatterAgent: ["claude", "codex"]
        })
      )
    ).rejects.toThrow("array handled by caller");
  });

  it("uses the configured default agent with assumeYes when CLI and frontmatter are absent", async () => {
    let selectCalls = 0;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => {
      selectCalls += 1;
      return "goose";
    };

    const result = await resolveLoopAgent(
      createInput({
        configuredDefaultAgent: "codex:openai/gpt-5.4",
        assumeYes: true,
        select
      })
    );

    expect(result).toEqual({ agent: "codex:openai/gpt-5.4" });
    expect(selectCalls).toBe(0);
  });

  it("prompts instead of accepting the configured default agent without assumeYes", async () => {
    let selectCalls = 0;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => {
      selectCalls += 1;
      return "goose";
    };

    const result = await resolveLoopAgent(
      createInput({
        configuredDefaultAgent: "codex:openai/gpt-5.4",
        select
      })
    );

    expect(result).toEqual({ agent: "goose" });
    expect(selectCalls).toBe(1);
  });

  it("uses fallbackAgent when assumeYes is enabled and no earlier source exists", async () => {
    let selectCalls = 0;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => {
      selectCalls += 1;
      return "codex";
    };

    const result = await resolveLoopAgent(
      createInput({
        assumeYes: true,
        fallbackAgent: "kimi",
        select
      })
    );

    expect(result).toEqual({ agent: "kimi" });
    expect(selectCalls).toBe(0);
  });

  it("prompts interactively when no earlier source exists", async () => {
    let selectCalls = 0;
    let receivedOptions:
      | Parameters<Parameters<typeof resolveLoopAgent>[0]["select"]>[0]
      | undefined;
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async (options) => {
      selectCalls += 1;
      receivedOptions = options;
      return "claude";
    };

    const result = await resolveLoopAgent(
      createInput({
        select
      })
    );

    expect(result).toEqual({ agent: "claude-code" });
    expect(selectCalls).toBe(1);
    expect(receivedOptions).toEqual({
      message: "Select an agent",
      options: expect.arrayContaining([
        expect.objectContaining({
          value: "claude-code"
        }),
        expect.objectContaining({
          value: "codex"
        })
      ])
    });
    expect(receivedOptions?.options).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "poe-agent"
        }),
        expect.objectContaining({
          value: "claude-desktop"
        })
      ])
    );
    expect(receivedOptions?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "claude-code",
          hint: "Anthropic's agentic coding tool for the terminal."
        }),
        expect.objectContaining({
          value: "codex",
          hint: "OpenAI's coding agent for the terminal."
        }),
        expect.objectContaining({
          value: "gemini-cli",
          hint: "Google's open-source AI agent for the terminal."
        }),
        expect.objectContaining({
          value: "opencode",
          hint: "Open-source AI coding agent for the terminal."
        }),
        expect.objectContaining({
          value: "kimi",
          hint: "Moonshot AI's coding agent for the terminal."
        }),
        expect.objectContaining({
          value: "pi",
          hint: "Minimal AI coding agent for the terminal."
        })
      ])
    );
  });

  it("rejects bare poe-agent specifiers because the loop runner requires a model", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          providedAgent: "poe-agent"
        })
      )
    ).rejects.toThrow(
      'poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4").'
    );
  });

  it("accepts poe-agent specifiers with an explicit model", async () => {
    const result = await resolveLoopAgent(
      createInput({
        providedAgent: "poe-agent:openai/gpt-5.4"
      })
    );

    expect(result).toEqual({ agent: "poe-agent:openai/gpt-5.4" });
  });

  it("rejects interactively selected bare poe-agent specifiers", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          select: async () => "poe-agent"
        })
      )
    ).rejects.toThrow(
      'poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4").'
    );
  });

  it("rejects configured bare poe-agent defaults with assumeYes", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          assumeYes: true,
          configuredDefaultAgent: "poe-agent"
        })
      )
    ).rejects.toThrow(
      'poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4").'
    );
  });

  it("rejects frontmatter bare poe-agent defaults", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          frontmatterAgent: "poe-agent"
        })
      )
    ).rejects.toThrow(
      'poe-agent requires a model in the agent specifier (e.g. "poe-agent:openai/gpt-5.4").'
    );
  });

  it("rejects GUI-only agents for loop execution", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          providedAgent: "claude-desktop"
        })
      )
    ).rejects.toThrow(
      'Unsupported agent "claude-desktop". Supported agents: claude-code, codex, cursor, gemini-cli, opencode, kimi, goose, pi, poe-agent:<model>'
    );
  });

  it("returns cancelled when the interactive prompt is cancelled", async () => {
    const cancelled = Symbol("cancelled");
    const select: Parameters<typeof resolveLoopAgent>[0]["select"] = async () => cancelled;
    const isCancel: Parameters<typeof resolveLoopAgent>[0]["isCancel"] = (value) =>
      value === cancelled;

    const result = await resolveLoopAgent(
      createInput({
        select,
        isCancel
      })
    );

    expect(result).toEqual({ cancelled: true });
  });

  it("throws a plain Error listing supported agents when validation fails", async () => {
    await expect(
      resolveLoopAgent(
        createInput({
          providedAgent: "not-an-agent"
        })
      )
    ).rejects.toThrow(
      'Unsupported agent "not-an-agent". Supported agents: claude-code, codex, cursor, gemini-cli, opencode, kimi, goose, pi, poe-agent:<model>'
    );
  });
});
