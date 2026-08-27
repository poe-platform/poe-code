import { describe, expect, it, vi } from "vitest";

import {
  createSpawnUsageAccumulator,
  makeAgentModule,
  runWithSpawnUsageAccumulator
} from "./agent.js";
import type { OtelSink } from "../observability/otel.js";

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

  it("requires own fields for agent definitions, spawn options, and mcp servers", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn(Object.create({ agent: "codex" }) as never, { prompt: "Inspect." })
    ).rejects.toThrow("Agent definition must define a non-empty agent.");
    await expect(
      agent.spawn("codex", Object.create({ prompt: "Inspect." }) as never)
    ).rejects.toThrow("Agent spawn options must define a non-empty prompt.");
    await expect(
      agent.spawn(
        {
          agent: "codex",
          mcp: {
            search: Object.create({ command: "mcp-search" })
          }
        } as never,
        { prompt: "Inspect." }
      )
    ).rejects.toThrow("Agent definition mcp.search.command must be a non-empty string.");

    const inheritedMcpServer = Object.assign(
      Object.create({
        args: ["--polluted"],
        env: {
          TOKEN: "polluted"
        },
        timeout: 1
      }),
      {
        command: "mcp-search"
      }
    );

    await agent.spawn(
      {
        agent: "codex",
        mcp: {
          search: inheritedMcpServer
        }
      } as never,
      {
        prompt: "Inspect.",
        model: "openai/gpt-5.4"
      }
    );

    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Inspect.",
      model: "openai/gpt-5.4",
      mcp: {
        search: {
          command: "mcp-search"
        }
      }
    });
  });

  it("requires own fields for spawn results and retry options", async () => {
    const inheritedResultField = makeAgentModule(
      vi.fn(async () =>
        Object.assign(Object.create({ durationMs: 1 }), {
          exitCode: 0,
          stdout: "",
          stderr: "",
          summary: "done"
        })
      )
    );

    await expect(inheritedResultField.spawn("codex", { prompt: "Inspect." })).rejects.toThrow(
      "spawnAgent result durationMs must be a finite number."
    );

    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Inspect." },
        Object.create({ maxAttempts: 1, backoffMs: 0 }) as never
      )
    ).rejects.toThrow("Agent spawn retry maxAttempts must be a finite number.");
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("does not let Object.prototype fields leak into normalized agent data", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);
    const accumulator = createSpawnUsageAccumulator();

    await withObjectPrototypeProperties(
      {
        cwd: "/polluted",
        mcp: {
          search: {
            command: "polluted-mcp"
          }
        },
        mode: "read",
        model: "polluted/model",
        timeoutMs: 10,
        usage: {
          cachedTokens: 30,
          inputTokens: 10,
          outputTokens: 20
        }
      },
      async () => {
        await runWithSpawnUsageAccumulator(accumulator, async () => {
          await expect(agent.spawn("codex", { prompt: "Inspect." })).resolves.toMatchObject({
            exitCode: 0,
            summary: "done"
          });
        });
      }
    );

    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Inspect."
    });
    expect(accumulator.snapshot()).toEqual({
      cachedTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      spawnCount: 1
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

    await expect(
      agent.spawn({ agent: "codex" }, { prompt: "Try once.", check: true })
    ).rejects.toThrow("Agent spawn failed with exit code 7: agent failed");
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

    await expect(
      agent.spawn({ agent: "codex" }, { prompt: "Try again.", check: true })
    ).rejects.toThrow("Agent spawn failed with exit code 9: timeout waiting for tool");
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

  it("retries thrown spawn errors with exponential backoff and reports each lifecycle event", async () => {
    vi.useFakeTimers();
    const failure = new Error("sandbox temporarily unavailable");
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        summary: "done",
        durationMs: 11
      });
    const events: unknown[] = [];
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this." },
      { maxAttempts: 5, backoffMs: 100 }
    );

    await vi.advanceTimersByTimeAsync(300);

    await expect(result).resolves.toMatchObject({ exitCode: 0, summary: "done" });
    expect(spawnAgent).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      expect.objectContaining({
        type: "spawn.started",
        agent: "codex",
        attempt: 1,
        maxAttempts: 5
      }),
      expect.objectContaining({
        type: "spawn.retry",
        attempt: 1,
        delayMs: 100,
        error: failure.message
      }),
      expect.objectContaining({
        type: "spawn.started",
        agent: "codex",
        attempt: 2,
        maxAttempts: 5
      }),
      expect.objectContaining({
        type: "spawn.retry",
        attempt: 2,
        delayMs: 200,
        error: failure.message
      }),
      expect.objectContaining({
        type: "spawn.started",
        agent: "codex",
        attempt: 3,
        maxAttempts: 5
      }),
      expect.objectContaining({
        type: "spawn.succeeded",
        agent: "codex",
        attempt: 3,
        maxAttempts: 5
      })
    ]);
    vi.useRealTimers();
  });

  it("caps exponential retry backoff at thirty seconds", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary one"))
      .mockRejectedValueOnce(new Error("temporary two"))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        summary: "done",
        durationMs: 1
      });
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this." },
      { maxAttempts: 3, backoffMs: 20_000 }
    );
    await vi.advanceTimersByTimeAsync(50_000);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "spawn.retry", delayMs: 20_000 })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "spawn.retry", delayMs: 30_000 })
    );
    vi.useRealTimers();
  });

  it("fails after the configured maximum number of thrown spawn errors", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValue(new Error("spawn transport failed"));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry("codex", { prompt: "Try this." }, { maxAttempts: 5, backoffMs: 0 })
    ).rejects.toThrow("spawn transport failed");

    expect(spawnAgent).toHaveBeenCalledTimes(5);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.failed",
        agent: "codex",
        attempt: 5,
        maxAttempts: 5,
        error: "spawn transport failed"
      })
    );
  });

  it("rejects retry policies above the five-attempt safety limit", async () => {
    const spawnAgent = vi.fn();
    const agent = makeAgentModule(spawnAgent);

    await expect(
      agent.spawn.retry("codex", { prompt: "Try this." }, { maxAttempts: 6, backoffMs: 0 })
    ).rejects.toThrow("must not exceed 5");

    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("fails immediately when a thrown spawn error is classified as permanent", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValue(new Error('Unknown service "missing".'));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "missing",
        { prompt: "Try this." },
        {
          maxAttempts: 5,
          backoffMs: 0,
          isErrorRetryable: () => false
        }
      )
    ).rejects.toThrow('Unknown service "missing".');

    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.failed",
        task: "Try this.",
        attempt: 1,
        maxAttempts: 5
      })
    );
  });

  it("reports a final failure when the thrown-error retry classifier fails", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValue(new Error("spawn transport failed"));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this." },
        {
          maxAttempts: 5,
          backoffMs: 0,
          isErrorRetryable: () => {
            throw new Error("retry classifier failed");
          }
        }
      )
    ).rejects.toThrow("retry classifier failed");

    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.failed",
        attempt: 1,
        error: "retry classifier failed"
      })
    );
  });

  it("preserves the final thrown spawn error without invoking the retry classifier again", async () => {
    const failure = new Error("final transport failure");
    const classifier = vi.fn(() => true);
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValue(failure);
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this." },
        { maxAttempts: 2, backoffMs: 0, isErrorRetryable: classifier }
      )
    ).rejects.toBe(failure);

    expect(classifier).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "spawn.failed", attempt: 2, error: failure.message })
    );
  });

  it("fails immediately when a non-zero spawn result is classified as permanent", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "No API key found.",
      summary: "",
      durationMs: 25
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this.", check: true },
        {
          maxAttempts: 5,
          backoffMs: 0,
          isRetryable: () => false
        }
      )
    ).rejects.toThrow("No API key found.");

    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "spawn.failed", attempt: 1, maxAttempts: 5 })
    );
  });

  it("reports a final failure when the result retry classifier fails", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "temporary failure",
      summary: "",
      durationMs: 25
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this." },
        {
          maxAttempts: 5,
          backoffMs: 0,
          isRetryable: () => {
            throw new Error("result classifier failed");
          }
        }
      )
    ).rejects.toThrow("result classifier failed");

    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.failed",
        attempt: 1,
        error: "result classifier failed"
      })
    );
  });

  it("preserves the final non-zero spawn result without invoking the retry classifier again", async () => {
    const classifier = vi.fn(() => true);
    const events: unknown[] = [];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "final result failure",
      summary: "",
      durationMs: 25
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this.", check: true },
        { maxAttempts: 2, backoffMs: 0, isRetryable: classifier }
      )
    ).rejects.toThrow("final result failure");

    expect(classifier).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.failed",
        attempt: 2,
        error: expect.stringContaining("final result failure")
      })
    );
  });

  it("reports total elapsed time across retries on success", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 10
    });
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this." },
      {
        maxAttempts: 2,
        backoffMs: 1_000
      }
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await result;

    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "spawn.succeeded", durationMs: 1_000 })
    );
    vi.useRealTimers();
  });

  it("derives a concise task label from the first non-empty prompt line", async () => {
    const events: unknown[] = [];
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      })),
      { onEvent: (event) => events.push(event) }
    );

    await agent.spawn("codex", {
      prompt: "\nReview packages/safejs for retry behavior.\nReturn a concise result."
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "spawn.started",
        task: "Review packages/safejs for retry behavior."
      }),
      expect.objectContaining({
        type: "spawn.succeeded",
        task: "Review packages/safejs for retry behavior."
      })
    ]);
  });

  it("falls back to a readable task label when prompt text sanitizes to empty", async () => {
    const events: unknown[] = [];
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      })),
      { onEvent: (event) => events.push(event) }
    );

    await agent.spawn("codex", { prompt: "\u0001\u0002" });

    expect(events[0]).toEqual(expect.objectContaining({ task: "agent task" }));
  });

  it("uses the task prompt rather than the agent system prompt for lifecycle labels", async () => {
    const events: unknown[] = [];
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      })),
      { onEvent: (event) => events.push(event) }
    );

    await agent.spawn(
      { agent: "codex", prompt: "You are a careful reviewer." },
      {
        prompt: "Review retry behavior."
      }
    );

    expect(events[0]).toEqual(expect.objectContaining({ task: "Review retry behavior." }));
  });

  it("uses an explicit visual label without forwarding it to the underlying spawn", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await agent.spawn("codex", {
      label: "Review authentication",
      prompt: "Review a long generated prompt containing implementation details."
    });

    expect(events[0]).toEqual(expect.objectContaining({ task: "Review authentication" }));
    expect(spawnAgent).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Review a long generated prompt containing implementation details."
    });
  });

  it("rejects blank visual labels before launching an agent", async () => {
    const spawnAgent = vi.fn();
    const agent = makeAgentModule(spawnAgent);

    await expect(agent.spawn("codex", { label: "   ", prompt: "Inspect." })).rejects.toThrow(
      "Agent spawn options label must be a non-empty string."
    );
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it("sanitizes and truncates lifecycle labels without changing the provider prompt", async () => {
    const events: unknown[] = [];
    const prompt = `Review auth\u001b[31m\n${"details ".repeat(30)}`;
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await agent.spawn("codex", { prompt });

    const task = (events[0] as { task: string }).task;
    expect(task).not.toContain("\u001b");
    expect(task.length).toBeLessThanOrEqual(72);
    expect(spawnAgent).toHaveBeenCalledWith({ agent: "codex", prompt });
  });

  it("sanitizes and truncates lifecycle agent ids without changing the provider input", async () => {
    const events: unknown[] = [];
    const agentId = `custom\n\u001b[31m-${"agent".repeat(20)}`;
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await agent.spawn(agentId, { prompt: "Inspect." });

    expect(events[0]).toEqual(
      expect.objectContaining({ agent: expect.not.stringContaining("\n") })
    );
    expect(events[0]).toEqual(
      expect.objectContaining({ agent: expect.not.stringContaining("\u001b") })
    );
    expect((events[0] as { agent: string }).agent.length).toBeLessThanOrEqual(48);
    expect(spawnAgent).toHaveBeenCalledWith({ agent: agentId, prompt: "Inspect." });
  });

  it("sanitizes and truncates lifecycle error messages without changing the thrown error", async () => {
    const events: unknown[] = [];
    const message = `temporary\u001b[31m\n${"details ".repeat(100)}`;
    const agent = makeAgentModule(vi.fn().mockRejectedValue(new Error(message)), {
      onEvent: (event) => events.push(event)
    });

    await expect(
      agent.spawn.retry("codex", { prompt: "Try." }, { maxAttempts: 1, backoffMs: 0 })
    ).rejects.toThrow(message);

    const error = (events.at(-1) as { error: string }).error;
    expect(error).not.toContain("\u001b");
    expect(error).not.toContain("\n");
    expect(error.length).toBeLessThanOrEqual(400);
  });

  it("does not let a lifecycle observer failure break a successful spawn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      })),
      {
        onEvent: () => {
          throw new Error("observer failed");
        }
      }
    );

    await expect(agent.spawn("codex", { prompt: "Inspect." })).resolves.toMatchObject({
      exitCode: 0
    });
    expect(warn).toHaveBeenCalledWith("Agent spawn event observer failed: observer failed");
  });

  it("does not let an async lifecycle observer rejection break a successful spawn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      })),
      {
        onEvent: async () => {
          throw new Error("async observer failed");
        }
      }
    );

    await expect(agent.spawn("codex", { prompt: "Inspect." })).resolves.toMatchObject({
      exitCode: 0
    });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("Agent spawn event observer failed: async observer failed")
    );
  });

  it("recognizes sandbox-shaped abort errors without retrying", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockRejectedValue({ name: "AbortError", message: "cancelled" });
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry("codex", { prompt: "Try this." }, { maxAttempts: 5, backoffMs: 0 })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "spawn.cancelled", attempt: 1, reason: "cancelled" })
    );
  });

  it("reports cancellation without launching a spawn when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: unknown[] = [];
    const spawnAgent = vi.fn();
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.retry(
        "codex",
        { prompt: "Try this.", signal: controller.signal },
        { maxAttempts: 5, backoffMs: 0 }
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(spawnAgent).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: "spawn.cancelled",
        attempt: 1,
        maxAttempts: 5,
        reason: "This operation was aborted"
      })
    ]);
  });

  it("reports cancellation without launching a one-shot spawn when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: unknown[] = [];
    const spawnAgent = vi.fn();
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn("codex", { prompt: "Try this.", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(spawnAgent).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: "spawn.cancelled",
        attempt: 1,
        maxAttempts: 1,
        reason: "This operation was aborted"
      })
    ]);
  });

  it("reports cancellation when a one-shot provider ignores abort and later returns success", async () => {
    const controller = new AbortController();
    const providerResult = createDeferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
      summary: string;
      durationMs: number;
    }>();
    const events: unknown[] = [];
    const spawnAgent = vi.fn(() => providerResult.promise);
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn("codex", { prompt: "Try this.", signal: controller.signal });
    controller.abort();
    providerResult.resolve({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      summary: "done",
      durationMs: 1
    });

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "spawn.cancelled" }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "spawn.succeeded" }));
  });

  it("rejects without launching another retry after abort during backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: unknown[] = [];
    const spawnAgent = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "retry",
      summary: "",
      durationMs: 1
    });
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this.", signal: controller.signal },
      { maxAttempts: 2, backoffMs: 1_000 }
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: "spawn.cancelled",
        attempt: 1,
        reason: "This operation was aborted"
      })
    );
    vi.useRealTimers();
  });

  it("reports cancellation when a retrying provider ignores abort and later returns success", async () => {
    const controller = new AbortController();
    const providerResult = createDeferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
      summary: string;
      durationMs: number;
    }>();
    const events: unknown[] = [];
    const spawnAgent = vi.fn(() => providerResult.promise);
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this.", signal: controller.signal },
      { maxAttempts: 5, backoffMs: 0 }
    );
    controller.abort();
    providerResult.resolve({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      summary: "done",
      durationMs: 1
    });

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(spawnAgent).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "spawn.cancelled" }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "spawn.succeeded" }));
  });

  it("exposes spawn.parallel with agent definitions and preserves non-zero results when failFast is false", async () => {
    const spawnAgent = vi.fn(async (input: { prompt: string }) => ({
      exitCode: input.prompt.includes("Fail") ? 2 : 0,
      stdout: input.prompt,
      stderr: input.prompt.includes("Fail") ? "failed" : "",
      summary: "",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);

    const results = await agent.spawn.parallel(
      [
        [{ agent: "codex", prompt: "Be precise." }, { prompt: "Build" }],
        ["claude-code", { prompt: "Fail this" }]
      ],
      { maxConcurrent: 1, failFast: false }
    );

    expect(results.map((result) => result.exitCode)).toEqual([0, 2]);
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        prompt: "Be precise.\n\n# Task\n\nBuild",
        signal: expect.objectContaining({ aborted: false })
      })
    );
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude-code",
        prompt: "Fail this",
        signal: expect.objectContaining({ aborted: false })
      })
    );
  });

  it("applies default retry and lifecycle events to parallel tuple calls", async () => {
    const events: unknown[] = [];
    const spawnAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("sandbox temporarily unavailable"))
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "built",
        stderr: "",
        summary: "built",
        durationMs: 2
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "reviewed",
        stderr: "",
        summary: "reviewed",
        durationMs: 3
      });
    const agent = makeAgentModule(spawnAgent, {
      defaultRetry: { maxAttempts: 2, backoffMs: 0 },
      onEvent: (event) => events.push(event)
    });

    const results = await agent.spawn.parallel(
      [
        ["codex", { prompt: "Build feature" }],
        ["codex", { prompt: "Review feature" }]
      ],
      { maxConcurrent: 1 }
    );

    expect(results.map((result) => result.summary)).toEqual(["built", "reviewed"]);
    expect(spawnAgent).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      expect.objectContaining({ type: "spawn.started", spawnId: 1, task: "Build feature" }),
      expect.objectContaining({ type: "spawn.retry", spawnId: 1, task: "Build feature" }),
      expect.objectContaining({ type: "spawn.started", spawnId: 1, attempt: 2 }),
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 1, attempt: 2 }),
      expect.objectContaining({ type: "spawn.started", spawnId: 2, task: "Review feature" }),
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 2, task: "Review feature" })
    ]);
  });

  it("reports fail-fast parallel siblings as cancelled without duplicate failures", async () => {
    const slow = createDeferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
      summary: string;
      durationMs: number;
    }>();
    const events: unknown[] = [];
    const spawnAgent = vi.fn((input: { prompt: string; signal?: AbortSignal }) => {
      if (input.prompt === "Fail") {
        return Promise.resolve({
          exitCode: 2,
          stdout: "",
          stderr: "primary failure",
          summary: "",
          durationMs: 1
        });
      }
      input.signal?.addEventListener("abort", () => {
        slow.resolve({ exitCode: 0, stdout: "late", stderr: "", summary: "late", durationMs: 2 });
      });
      return slow.promise;
    });
    const agent = makeAgentModule(spawnAgent, { onEvent: (event) => events.push(event) });

    await expect(
      agent.spawn.parallel(
        [
          ["codex", { prompt: "Slow" }],
          ["codex", { prompt: "Fail" }]
        ],
        { maxConcurrent: 2, check: true }
      )
    ).rejects.toMatchObject({ name: "SpawnParallelError" });

    expect(events).toContainEqual(expect.objectContaining({ type: "spawn.failed", spawnId: 2 }));
    expect(events).toContainEqual(expect.objectContaining({ type: "spawn.cancelled", spawnId: 1 }));
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "spawn.failed", spawnId: 1 })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "spawn.succeeded", spawnId: 1 })
    );
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

  it("does not require an otel sink to run spawns", async () => {
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "done",
      durationMs: 1
    }));
    const agent = makeAgentModule(spawnAgent);

    await expect(agent.spawn("codex", { prompt: "Inspect." })).resolves.toMatchObject({
      exitCode: 0,
      summary: "done"
    });
  });

  it("records the expected otel span lifecycle for a spawn", async () => {
    const events: string[] = [];
    const sink = createRecordingOtelSink(events);
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      summary: "finished",
      durationMs: 12
    }));
    const agent = makeAgentModule(spawnAgent, { otelSink: sink });

    await agent.spawn({ agent: "codex", mode: "read", cwd: "/repo" }, { prompt: "Inspect." });

    expect(events).toEqual([
      'start:agent.spawn:{"agent":"codex","mode":"read","cwd":"/repo"}',
      'event:prompt:{"prompt":"Inspect."}',
      'event:summary:{"summary":"finished"}',
      'event:exit:{"exitCode":0,"durationMs":12}',
      "end"
    ]);
  });

  it("records the shared auto mode when a spawn omits mode", async () => {
    const events: string[] = [];
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "finished",
        durationMs: 1
      })),
      { otelSink: createRecordingOtelSink(events) }
    );

    await agent.spawn("codex", { prompt: "Inspect.", cwd: "/repo" });

    expect(events[0]).toBe(
      'start:agent.spawn:{"agent":"codex","mode":"auto","cwd":"/repo"}'
    );
  });

  it("reports a controlled error when spawn default cwd cannot be resolved", async () => {
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw Object.assign(new Error("uv_cwd"), { code: "ENOENT" });
    });
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "done",
        durationMs: 1
      }))
    );

    try {
      await expect(agent.spawn("codex", { prompt: "Inspect." })).rejects.toThrow(
        "Unable to resolve current working directory: uv_cwd"
      );
    } finally {
      cwd.mockRestore();
    }
  });

  it("records an otel exception when a spawn fails", async () => {
    const events: string[] = [];
    const sink = createRecordingOtelSink(events);
    const failure = new Error("spawn failed");
    const agent = makeAgentModule(
      vi.fn(async () => Promise.reject(failure)),
      { otelSink: sink }
    );

    await expect(agent.spawn("codex", { prompt: "Try." })).rejects.toThrow("spawn failed");

    expect(events.filter((event) => event === "exception:spawn failed")).toHaveLength(1);
    expect(events.at(-1)).toBe("end");
  });

  it("does not crash when otel sink methods throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const span = {
      setAttribute: vi.fn(() => {
        throw new Error("set failed");
      }),
      addEvent: vi.fn(() => {
        throw new Error("event failed");
      }),
      end: vi.fn(() => {
        throw new Error("end failed");
      })
    };
    const sink: OtelSink = {
      startSpan: vi.fn(() => span),
      recordException: vi.fn(() => {
        throw new Error("exception failed");
      })
    };
    const agent = makeAgentModule(
      vi.fn(async () => ({
        exitCode: 3,
        stdout: "",
        stderr: "denied",
        summary: "",
        durationMs: 1
      })),
      { otelSink: sink }
    );

    await expect(agent.spawn("codex", { prompt: "Try.", check: true })).rejects.toThrow(
      "Agent spawn failed with exit code 3: denied"
    );

    expect(warn).toHaveBeenCalled();
  });
});

function createRecordingOtelSink(events: string[]): OtelSink {
  return {
    startSpan(name, attrs) {
      events.push(`start:${name}:${JSON.stringify(attrs)}`);
      return {
        setAttribute(key, value) {
          events.push(`attr:${key}:${JSON.stringify(value)}`);
        },
        addEvent(name, attrs) {
          events.push(`event:${name}:${JSON.stringify(attrs)}`);
        },
        end() {
          events.push("end");
        }
      };
    },
    recordException(_span, error) {
      events.push(`exception:${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
