import { describe, expect, it } from "vitest";

import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "../middleware.js";
import { usageCapture } from "./usage-capture.js";
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

describe("acp/middlewares/usageCapture", () => {
  it("accumulates usage totals while preserving event stream", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "session_start", threadId: "thread-123" },
      { event: "usage", inputTokens: 1, outputTokens: 2 },
      { event: "agent_message", text: "hello" },
      { event: "usage", inputTokens: 3, outputTokens: 4, cachedTokens: 5 },
      { event: "usage", inputTokens: 6, outputTokens: 7, cachedTokens: 0 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    const observed = await collect(ctx.eventStream!);

    expect(observed).toEqual(sourceEvents);
    expect(observed[0]).toBe(sourceEvents[0]);
    expect(observed[1]).toBe(sourceEvents[1]);
    expect(observed[2]).toBe(sourceEvents[2]);

    expect(ctx.usage).toEqual({
      inputTokens: 10,
      outputTokens: 13,
      cachedTokens: 5
    });
  });

  it("accumulates usage from preloaded events without an event stream", async () => {
    const preloadedEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 10, outputTokens: 20 },
      { event: "agent_message", text: "ignored" },
      { event: "usage", inputTokens: 30, outputTokens: 40, cachedTokens: 50 }
    ];

    const ctx = createContext({ events: [...preloadedEvents] });
    await applyMiddlewares([usageCapture], ctx);

    expect(ctx.eventStream).toBeUndefined();
    expect(ctx.usage).toEqual({
      inputTokens: 40,
      outputTokens: 60,
      cachedTokens: 50
    });
  });

  it("ignores malformed usage payloads", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 1, outputTokens: 2 },
      { event: "usage", inputTokens: "bad", outputTokens: 3 } as unknown as AcpEvent,
      { event: "usage", inputTokens: 4, outputTokens: null } as unknown as AcpEvent,
      { event: "usage", inputTokens: 5, outputTokens: 6, cachedTokens: "bad" } as unknown as AcpEvent
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 10,
      outputTokens: 11
    });
  });

  it("ignores non-finite usage values", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 1, outputTokens: 2, cachedTokens: 3 },
      {
        event: "usage",
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        cachedTokens: Number.NEGATIVE_INFINITY
      } as unknown as AcpEvent,
      { event: "usage", inputTokens: 4, outputTokens: 5, cachedTokens: 6 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      cachedTokens: 9
    });
  });

  it("ignores negative usage values", async () => {
    const sourceEvents: AcpEvent[] = [
      { event: "usage", inputTokens: 3, outputTokens: 4, cachedTokens: 5 },
      { event: "usage", inputTokens: -1, outputTokens: -2, cachedTokens: -3 } as unknown as AcpEvent,
      { event: "usage", inputTokens: 6, outputTokens: 7, cachedTokens: 8 }
    ];

    const source: AcpMiddleware = async (ctx) => {
      ctx.eventStream = (async function* () {
        for (const event of sourceEvents) {
          yield event;
        }
      })();
    };

    const ctx = createContext();
    await applyMiddlewares([usageCapture, source], ctx);

    await collect(ctx.eventStream!);

    expect(ctx.usage).toEqual({
      inputTokens: 9,
      outputTokens: 11,
      cachedTokens: 13
    });
  });
});
