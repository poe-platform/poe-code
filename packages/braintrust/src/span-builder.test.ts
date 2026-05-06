import type { AcpEvent, AcpSpawnContext as SpawnContext } from "@poe-code/agent-spawn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { logSpawnSession } from "./span-builder.js";

const mockBraintrust = vi.hoisted(() => ({
  currentSpan: vi.fn(),
}));

vi.mock("braintrust", () => ({
  currentSpan: mockBraintrust.currentSpan,
}));

describe("logSpawnSession", () => {
  beforeEach(() => {
    mockBraintrust.currentSpan.mockReset();
  });

  it("logs agent and tool spans in order with canonical token metrics", async () => {
    const calls: string[] = [];
    const agentSpan = createMockSpan("agent", calls);
    const toolSpan = createMockSpan("tool", calls);
    const parentSpan = {
      startSpan: vi.fn((args: unknown) => {
        calls.push(`parent.startSpan:${JSON.stringify(args)}`);
        return agentSpan;
      }),
    };
    agentSpan.startSpan.mockImplementation((args: unknown) => {
      calls.push(`agent.startSpan:${JSON.stringify(args)}`);
      return toolSpan;
    });
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const client = createMockClient();

    const events = [
      { event: "agent_message", text: "Hello " },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read file",
        kind: "read",
        input: { path: "README.md" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        content: [{ type: "text", text: "file contents" }],
        status: "completed",
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      },
    ] as unknown as AcpEvent[];
    const ctx: SpawnContext = {
      sessionId: "session-1",
      agent: "codex",
      model: "gpt-5",
      events,
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cachedTokens: 3,
      },
      threadId: "thread-1",
      prompt: "Say hello",
      mode: "edit",
      cwd: "/repo",
    };

    await logSpawnSession(client, ctx);

    expect(calls).toEqual([
      'parent.startSpan:{"name":"agent:codex:gpt-5","type":"task"}',
      'agent.startSpan:{"name":"tool_call:read","type":"tool"}',
      'tool.log:{"input":{"path":"README.md"},"output":"file contents"}',
      "tool.end",
      'agent.log:{"input":{"prompt":"Say hello","mode":"edit","cwd":"/repo"},"output":"Hello world","metadata":{"sessionId":"session-1","threadId":"thread-1"},"metrics":{"prompt_tokens":11,"completion_tokens":7,"tokens":18,"prompt_cached_tokens":3}}',
      "agent.end",
    ]);
    expect(client.recordError).not.toHaveBeenCalled();
  });

  it("records span-building errors and does not throw", async () => {
    mockBraintrust.currentSpan.mockReturnValue({});
    const client = createMockClient();
    const ctx: SpawnContext = {
      sessionId: "session-1",
      agent: "codex",
      events: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };

    await expect(logSpawnSession(client, ctx)).resolves.toBeUndefined();

    expect(client.recordError).toHaveBeenCalledTimes(1);
    expect(client.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      "log spawn session",
    );
  });

  it("merges _meta from tool_call and tool_call_update into tool span metadata", async () => {
    const calls: string[] = [];
    const agentSpan = createMockSpan("agent", calls);
    const toolSpan = createMockSpan("tool", calls);
    const parentSpan = {
      startSpan: vi.fn(() => agentSpan),
    };
    agentSpan.startSpan.mockImplementation(() => toolSpan);
    mockBraintrust.currentSpan.mockReturnValue(parentSpan);
    const client = createMockClient();

    const events = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Read file",
        kind: "read",
        input: { path: "x" },
        _meta: { ts: 100, toolName: "Read" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        content: [{ type: "text", text: "ok" }],
        status: "completed",
        _meta: { ts: 250 },
      },
    ] as unknown as AcpEvent[];
    const ctx: SpawnContext = {
      sessionId: "s",
      agent: "codex",
      events,
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    await logSpawnSession(client, ctx);

    expect(calls).toContain(
      'tool.log:{"input":{"path":"x"},"output":"ok","metadata":{"startTs":100,"toolName":"Read","endTs":250}}',
    );
  });

  it("includes spawn metadata on the agent span", async () => {
    const calls: string[] = [];
    const agentSpan = createMockSpan("agent", calls);
    mockBraintrust.currentSpan.mockReturnValue({
      startSpan: vi.fn(() => agentSpan),
    });
    const client = createMockClient();
    const ctx: SpawnContext & { metadata: Record<string, unknown> } = {
      sessionId: "session-1",
      agent: "codex",
      events: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      metadata: {
        aborted: true,
      },
    };

    await logSpawnSession(client, ctx);

    expect(calls).toContain(
      'agent.log:{"input":{},"output":"","metadata":{"sessionId":"session-1","aborted":true},"metrics":{"prompt_tokens":0,"completion_tokens":0,"tokens":0}}',
    );
  });
});

function createMockSpan(name: string, calls: string[]) {
  return {
    startSpan: vi.fn(),
    log: vi.fn((event: unknown) => {
      calls.push(`${name}.log:${JSON.stringify(event)}`);
    }),
    end: vi.fn(() => {
      calls.push(`${name}.end`);
    }),
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
