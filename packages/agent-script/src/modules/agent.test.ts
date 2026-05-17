import { describe, expect, it, vi } from "vitest";

import { makeAgentModule } from "./agent.js";

describe("makeAgentModule", () => {
  it("merges agent defaults into spawn inputs and prepends the system prompt", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "agent stdout",
      stderr: "",
      summary: "agent summary",
      durationMs: 42
    }));
    const agent = makeAgentModule(spawnAgent);

    const result = await agent.spawn(
      {
        agent: "codex",
        prompt: "You are careful.",
        model: "openai/gpt-5.4",
        mode: "read",
        cwd: "/repo",
        mcp: {
          search: {
            command: "mcp-search"
          }
        }
      },
      {
        prompt: "Inspect the diff.",
        timeoutMs: 5_000
      }
    );

    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "You are careful.\n\n# Task\n\nInspect the diff.",
      model: "openai/gpt-5.4",
      mode: "read",
      cwd: "/repo",
      mcp: {
        search: {
          command: "mcp-search"
        }
      },
      timeoutMs: 5_000
    });
    expect(result).toEqual({
      exitCode: 0,
      stdout: "agent stdout",
      stderr: "",
      summary: "agent summary",
      durationMs: 42
    });
  });

  it("lets call-site options override the agent definition and supports string agent ids", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);

    await agent.spawn("claude-code", {
      prompt: "Fix the failing test.",
      model: "anthropic/claude-sonnet-4.5",
      mode: "edit",
      cwd: "/workspace/task",
      mcp: {
        fs: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve"]
        }
      }
    });

    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "claude-code",
      prompt: "Fix the failing test.",
      model: "anthropic/claude-sonnet-4.5",
      mode: "edit",
      cwd: "/workspace/task",
      mcp: {
        fs: {
          command: "tiny-stdio-mcp-test-server",
          args: ["serve"]
        }
      }
    });
  });

  it("throws when the injected spawn returns a non-zero exit code", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 7,
      stdout: "partial",
      stderr: "agent failed",
      summary: "failed",
      durationMs: 10
    }));
    const agent = makeAgentModule(spawnAgent);

    await expect(agent.spawn({ agent: "codex" }, { prompt: "Try once." })).rejects.toThrow(
      "Agent spawn failed with exit code 7: agent failed"
    );
  });

  it("falls back to the summary in the failure message when stderr is empty", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 9,
      stdout: "",
      stderr: "   ",
      summary: "timeout waiting for tool",
      durationMs: 10
    }));
    const agent = makeAgentModule(spawnAgent);

    await expect(agent.spawn({ agent: "codex" }, { prompt: "Try again." })).rejects.toThrow(
      "Agent spawn failed with exit code 9: timeout waiting for tool"
    );
  });

  it("exposes spawn.retry with the same agent definition and options arity", async () => {
    const spawnAgent = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        summary: "",
        durationMs: 10
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        summary: "done",
        durationMs: 11
      });
    const agent = makeAgentModule(spawnAgent);

    const result = await agent.spawn.retry(
      { agent: "codex", prompt: "Be concise.", model: "openai/gpt-5.4" },
      { prompt: "Try this.", mode: "edit" },
      { maxAttempts: 2, backoffMs: 1 }
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      summary: "done",
      durationMs: 11
    });
    expect(spawnAgent).toHaveBeenCalledTimes(2);
    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Be concise.\n\n# Task\n\nTry this.",
      model: "openai/gpt-5.4",
      mode: "edit"
    });
  });

  it("rejects whitespace-only agent ids from either string or object definitions", async () => {
    const spawnAgent = vi.fn();
    const agent = makeAgentModule(spawnAgent);

    await expect(agent.spawn("   ", { prompt: "Inspect the diff." })).rejects.toThrow(
      "Agent definition must define a non-empty agent."
    );
    await expect(agent.spawn({ agent: "   " }, { prompt: "Inspect the diff." })).rejects.toThrow(
      "Agent definition must define a non-empty agent."
    );
    expect(spawnAgent).not.toHaveBeenCalled();
  });
});
