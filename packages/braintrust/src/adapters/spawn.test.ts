import {
  applyMiddlewares,
  sessionCapture,
  usageCapture,
  type AcpSpawnContext as SpawnContext
} from "@poe-code/agent-spawn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BraintrustSpanLike } from "@poe-code/acp-telemetry";

import type { BraintrustClient } from "../client.js";
import { createSpawnMiddleware } from "./spawn.js";

const mockBraintrust = vi.hoisted(() => ({
  currentSpan: vi.fn()
}));

vi.mock("braintrust", () => ({
  currentSpan: mockBraintrust.currentSpan
}));

describe("createSpawnMiddleware", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
  });

  it("runs next before logging the populated spawn context", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const parentSpan = new FakeBraintrustSpan("parent");
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const middleware = createSpawnMiddleware(client);
    const next = vi.fn(async () => {
      ctx.events.push({ event: "agent_message", text: "done" } as never);
      ctx.usage.inputTokens = 4;
      ctx.sessionResult = {
        output: "done",
        messages: ["done"],
        toolCalls: []
      };
    });

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockBraintrust.currentSpan).toHaveBeenCalledTimes(1);
    expect(parentSpan.calls).toEqual([
      {
        span: "parent",
        method: "startSpan",
        args: { name: "agent:codex:?", type: "task" }
      },
      {
        span: "agent:codex:?",
        method: "log",
        args: {
          input: {},
          output: "done",
          metadata: { sessionId: "session-1", threadId: undefined },
          metrics: {
            prompt_tokens: 4,
            completion_tokens: 0,
            tokens: 4
          }
        }
      },
      {
        span: "agent:codex:?",
        method: "end"
      }
    ]);
    expect(ctx).toMatchObject({
      events: [{ event: "agent_message", text: "done" }],
      usage: { inputTokens: 4 },
      sessionResult: { output: "done" }
    });
  });

  it("logs streamed output and usage after capture middleware consumes events", async () => {
    const client = createMockClient();
    const ctx = {
      ...createSpawnContext(),
      eventStream: (async function* () {
        yield { event: "session_start", threadId: "thread-1" } as never;
        yield { event: "agent_message", text: "done" } as never;
        yield { event: "usage", inputTokens: 2, outputTokens: 3 } as never;
      })()
    };
    const parentSpan = new FakeBraintrustSpan("parent");
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);

    await applyMiddlewares([sessionCapture, usageCapture, createSpawnMiddleware(client)], ctx);

    expect(parentSpan.calls).toEqual([]);
    const consumerSpan = new FakeBraintrustSpan("consumer");
    mockBraintrust.currentSpan.mockReturnValue(consumerSpan);
    for await (const event of ctx.eventStream ?? []) {
      void event;
    }

    expect(consumerSpan.calls).toEqual([]);
    expect(parentSpan.calls).toContainEqual({
      span: "agent:codex:?",
      method: "log",
      args: {
        input: {
          cwd: undefined,
          mode: undefined,
          prompt: undefined
        },
        output: "done",
        metadata: { sessionId: "thread-1", threadId: "thread-1" },
        metrics: {
          prompt_tokens: 2,
          completion_tokens: 3,
          tokens: 5
        }
      }
    });
  });

  it("logs aborted metadata when next throws and re-throws the original error", async () => {
    const client = createMockClient();
    const ctx = {
      ...createSpawnContext(),
      metadata: {
        mode: "test"
      }
    };
    const parentSpan = new FakeBraintrustSpan("parent");
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const middleware = createSpawnMiddleware(client);
    const error = new Error("spawn failed");
    const next = vi.fn(async () => {
      ctx.events.push({ event: "error", message: "failed" } as never);
      throw error;
    });

    await expect(middleware(ctx, next)).rejects.toBe(error);

    expect(parentSpan.calls).toContainEqual({
      span: "agent:codex:?",
      method: "log",
      args: expect.objectContaining({
        metadata: {
          sessionId: "session-1",
          threadId: undefined,
          mode: "test",
          aborted: true
        }
      })
    });
  });

  it("preserves the spawn error when Braintrust logging also fails", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const middleware = createSpawnMiddleware(client);
    const spawnError = new Error("spawn failed");
    const sdkError = new Error("log failed");
    mockBraintrust.currentSpan.mockReturnValue(new FailingBraintrustSpan(sdkError));

    await expect(
      middleware(ctx, async () => {
        throw spawnError;
      })
    ).rejects.toBe(spawnError);

    expect(client.recordError).toHaveBeenCalledWith(sdkError, "log spawn session");
  });

  it("does not fail when recording to Braintrust fails", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const middleware = createSpawnMiddleware(client);
    const sdkError = new Error("sdk unavailable");
    mockBraintrust.currentSpan.mockImplementation(() => {
      throw sdkError;
    });

    await expect(middleware(ctx, async () => undefined)).resolves.toBeUndefined();

    expect(client.recordError).toHaveBeenCalledWith(sdkError, "log spawn session");
  });
});

type FakeCall =
  | {
      span: string;
      method: "startSpan";
      args: { name: string; type: "task" | "tool" };
    }
  | {
      span: string;
      method: "log";
      args: Parameters<BraintrustSpanLike["log"]>[0];
    }
  | {
      span: string;
      method: "end";
    };

class FakeBraintrustSpan implements BraintrustSpanLike {
  readonly calls: FakeCall[];

  constructor(
    private readonly name: string,
    calls?: FakeCall[]
  ) {
    this.calls = calls ?? [];
  }

  startSpan(args: { name: string; type: "task" | "tool" }): BraintrustSpanLike {
    this.calls.push({ span: this.name, method: "startSpan", args });
    return new FakeBraintrustSpan(args.name, this.calls);
  }

  log(event: Parameters<BraintrustSpanLike["log"]>[0]): void {
    this.calls.push({ span: this.name, method: "log", args: event });
  }

  end(): void {
    this.calls.push({ span: this.name, method: "end" });
  }
}

class FailingBraintrustSpan implements BraintrustSpanLike {
  constructor(private readonly error: Error) {}

  startSpan(): BraintrustSpanLike {
    return this;
  }

  log(): void {
    throw this.error;
  }

  end(): void {}
}

function createSpawnContext(): SpawnContext {
  return {
    sessionId: "session-1",
    agent: "codex",
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    }
  };
}

function createMockClient(): BraintrustClient {
  return {
    getSdk: vi.fn(),
    getRootLogger: vi.fn(),
    getExperiment: vi.fn(),
    flush: vi.fn(),
    recordError: vi.fn(),
    status: vi.fn(() => ({
      lastError: null,
      errorCount: 0,
      project: "project"
    }))
  };
}
