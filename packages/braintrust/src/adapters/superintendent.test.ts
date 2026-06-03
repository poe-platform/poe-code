import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "../client.js";
import { createSpawnMiddleware } from "./spawn.js";
import { createSuperintendentCallbacks, type LoopCallbacks } from "./superintendent.js";

const mockBraintrust = vi.hoisted(() => ({
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => ({
  currentSpan: mockBraintrust.currentSpan,
}));

vi.mock("../row-builder.js", () => ({
  buildSuperintendentLog: vi.fn((_role: string, result: unknown) => result),
}));

describe("createSuperintendentCallbacks", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
  });

  it("traces role execution and logs successful results inside its current span", async () => {
    const client = createMockClient();
    const roleSpan = createMockSpan();
    vi.mocked(client.getSdk).mockResolvedValue({
      currentSpan: vi.fn(() => roleSpan),
      traced: vi.fn(async (run) => run())
    } as never);
    const callbacks = createSuperintendentCallbacks(client);
    const result = { output: "built" };

    await expect(callbacks.runRole?.("builder", undefined, async () => result)).resolves.toBe(result);

    expect(roleSpan.log).toHaveBeenCalledWith({ output: "built" });
  });

  it("keeps spawned agent traces beneath the active role span", async () => {
    const rootSpan = createMockSpan();
    const roleSpan = createMockSpan();
    const agentSpan = createMockSpan();
    let currentSpan = rootSpan;
    roleSpan.startSpan.mockReturnValue(agentSpan);
    mockBraintrust.currentSpan.mockImplementation(() => currentSpan);
    const client = createMockClient();
    vi.mocked(client.getSdk).mockResolvedValue({
      currentSpan: vi.fn(() => currentSpan),
      traced: vi.fn(async (run) => {
        currentSpan = roleSpan;
        try {
          return await run();
        } finally {
          currentSpan = rootSpan;
        }
      })
    } as never);
    const callbacks = createSuperintendentCallbacks(client);
    const spawn = createSpawnMiddleware(client);

    await callbacks.runRole?.("builder", undefined, async () => {
      await spawn(
        {
          sessionId: "session",
          agent: "codex",
          model: "gpt-5",
          events: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          sessionResult: { output: "done", messages: ["done"], toolCalls: [] }
        },
        async () => undefined
      );
      return { output: "built" };
    });

    expect(roleSpan.startSpan).toHaveBeenCalledWith({ name: "agent:codex:gpt-5", type: "task" });
    expect(rootSpan.startSpan).not.toHaveBeenCalled();
  });

  it("logs builder failures as failed Braintrust spans", async () => {
    const failureSpan = createMockSpan();
    const client = createMockClient();
    vi.mocked(client.getSdk).mockResolvedValue({
      currentSpan: vi.fn(() => failureSpan),
      traced: vi.fn(async (run) => run())
    } as never);
    const callbacks = createSuperintendentCallbacks(client);
    const error = new Error("builder failed");

    await expect(callbacks.runRole?.("builder", undefined, async () => { throw error; })).rejects.toBe(error);

    expect(failureSpan.log).toHaveBeenCalledWith({
      metadata: {
        role: "builder",
        error: "builder failed",
      },
      scores: {
        passed: 0,
      },
    });
  });

  it("logs inspector failures as failed Braintrust spans with the inspector name", async () => {
    const failureSpan = createMockSpan();
    const client = createMockClient();
    vi.mocked(client.getSdk).mockResolvedValue({
      currentSpan: vi.fn(() => failureSpan),
      traced: vi.fn(async (run) => run())
    } as never);
    const callbacks = createSuperintendentCallbacks(client);
    const error = new Error("inspector failed");

    await expect(callbacks.runRole?.("inspector", "docs", async () => { throw error; })).rejects.toBe(error);

    expect(failureSpan.log).toHaveBeenCalledWith({
      metadata: {
        role: "inspector",
        name: "docs",
        error: "inspector failed",
      },
      scores: {
        passed: 0,
      },
    });
  });
});

function createMockSpan() {
  return {
    startSpan: vi.fn(() => createMockSpan()),
    log: vi.fn(),
    end: vi.fn(),
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

type ignoredLoopCallbacks = LoopCallbacks;
