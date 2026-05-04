import type { AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "../client.js";
import { createSpawnMiddleware } from "./spawn.js";
import { logSpawnSession } from "../span-builder.js";

vi.mock("../span-builder.js", () => ({
  logSpawnSession: vi.fn(),
}));

const mockLogSpawnSession = vi.mocked(logSpawnSession);

describe("createSpawnMiddleware", () => {
  beforeEach(() => {
    mockLogSpawnSession.mockReset();
  });

  it("runs next before logging the populated spawn context", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const middleware = createSpawnMiddleware(client);
    const next = vi.fn(async () => {
      ctx.events.push({ event: "agent_message", text: "done" } as never);
      ctx.usage.inputTokens = 4;
      ctx.sessionResult = {
        output: "done",
        messages: ["done"],
        toolCalls: [],
      };
    });

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockLogSpawnSession).toHaveBeenCalledTimes(1);
    expect(mockLogSpawnSession).toHaveBeenCalledWith(client, ctx);
    expect(ctx).toMatchObject({
      events: [{ event: "agent_message", text: "done" }],
      usage: { inputTokens: 4 },
      sessionResult: { output: "done" },
    });
  });

  it("logs aborted metadata when next throws and re-throws the original error", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const middleware = createSpawnMiddleware(client);
    const error = new Error("spawn failed");
    const next = vi.fn(async () => {
      ctx.events.push({ event: "error", message: "failed" } as never);
      throw error;
    });

    await expect(middleware(ctx, next)).rejects.toBe(error);

    expect(mockLogSpawnSession).toHaveBeenCalledTimes(1);
    expect(mockLogSpawnSession).toHaveBeenCalledWith(client, {
      ...ctx,
      metadata: {
        aborted: true,
      },
    });
  });

  it("does not fail when logSpawnSession swallows SDK errors through the client", async () => {
    const client = createMockClient();
    const ctx = createSpawnContext();
    const middleware = createSpawnMiddleware(client);
    const sdkError = new Error("sdk unavailable");
    mockLogSpawnSession.mockImplementation(async (targetClient) => {
      targetClient.recordError(sdkError, "log spawn session");
    });

    await expect(middleware(ctx, async () => undefined)).resolves.toBeUndefined();

    expect(client.recordError).toHaveBeenCalledWith(sdkError, "log spawn session");
    expect(mockLogSpawnSession).toHaveBeenCalledWith(client, ctx);
  });
});

function createSpawnContext(): SpawnContext {
  return {
    sessionId: "session-1",
    agent: "codex",
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
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
      project: "project",
    })),
  };
}
