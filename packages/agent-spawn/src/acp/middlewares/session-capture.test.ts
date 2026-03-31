import { describe, expect, it } from "bun:test";

import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "../middleware.js";
import { sessionCapture } from "./session-capture.js";
import type { AcpEvent } from "../types.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function createContext(overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    sessionId: "",
    agent: "codex",
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0
    },
    ...overrides
  };
}

describe("acp/middlewares/sessionCapture", () => {
  it("accumulates events and builds sessionResult while preserving event stream", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-123" },
      { event: "tool_start", id: "tool-1", kind: "exec", title: "ls -la" },
      { event: "tool_complete", id: "tool-1", kind: "exec", path: "ok" },
      { event: "agent_message", text: "First message" },
      { event: "agent_message", text: "Second message" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(observed[0]).toBe(sourceEvents[0]);
    expect(observed[1]).toBe(sourceEvents[1]);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.threadId).toBe("thread-123");
    expect(ctx.sessionId).toBe("thread-123");
    expect(ctx.sessionResult).toEqual({
      output: "First message\nSecond message",
      messages: ["First message", "Second message"],
      toolCalls: [
        {
          id: "tool-1",
          kind: "exec",
          title: "ls -la",
          path: "ok"
        }
      ]
    });
  });

  it("records tool_complete events even when no matching tool_start exists", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "tool_complete", id: "tool-2", kind: "edit", path: "src/app.ts" },
      { event: "agent_message", text: "done" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.sessionResult).toEqual({
      output: "done",
      messages: ["done"],
      toolCalls: [
        {
          id: "tool-2",
          kind: "edit",
          path: "src/app.ts"
        }
      ]
    });
  });

  it("merges out-of-order tool events with the same id into one toolCall", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "tool_complete", id: "tool-3", kind: "read", path: "README.md" },
      { event: "tool_start", id: "tool-3", kind: "read", title: "Read readme" }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([sessionCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.events).toEqual(sourceEvents);
    expect(ctx.sessionResult).toEqual({
      output: "",
      messages: [],
      toolCalls: [
        {
          id: "tool-3",
          kind: "read",
          title: "Read readme",
          path: "README.md"
        }
      ]
    });
  });

  it("builds sessionResult from preloaded events even without an event stream", async () => {
    const preloadedEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-preloaded" },
      { event: "agent_message", text: "hello" },
      { event: "agent_message", text: "world" }
    ];

    const ctx = createContext({ events: [...preloadedEvents] });
    await applyMiddlewares([sessionCapture], ctx);

    expect(ctx.events).toEqual(preloadedEvents);
    expect(ctx.threadId).toBe("thread-preloaded");
    expect(ctx.sessionId).toBe("thread-preloaded");
    expect(ctx.eventStream).toBeUndefined();
    expect(ctx.sessionResult).toEqual({
      output: "hello\nworld",
      messages: ["hello", "world"],
      toolCalls: []
    });
  });
});
