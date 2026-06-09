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

    await expect(
      inheritedResultField.spawn("codex", { prompt: "Inspect." })
    ).rejects.toThrow("spawnAgent result durationMs must be a finite number.");

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

  it("rejects without launching another retry after abort during backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const spawnAgent = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "retry",
      summary: "",
      durationMs: 1
    });
    const agent = makeAgentModule(spawnAgent);

    const result = agent.spawn.retry(
      "codex",
      { prompt: "Try this.", signal: controller.signal },
      { maxAttempts: 2, backoffMs: 1_000 }
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(spawnAgent).toHaveBeenCalledOnce();
    vi.useRealTimers();
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

    await expect(agent.spawn("codex", { prompt: "Try." })).rejects.toThrow(
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
