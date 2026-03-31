import { describe, expect, it } from "bun:test";

import { applyMiddlewares, type AcpMiddleware, type SpawnContext } from "./middleware.js";

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

describe("acp/applyMiddlewares", () => {
  it("runs middlewares in onion order", async () => {
    const steps: string[] = [];
    const context = createContext();

    const first: AcpMiddleware = async (_ctx, next) => {
      steps.push("first:before");
      await next();
      steps.push("first:after");
    };

    const second: AcpMiddleware = async (_ctx, next) => {
      steps.push("second:before");
      await next();
      steps.push("second:after");
    };

    await applyMiddlewares([first, second], context);

    expect(steps).toEqual(["first:before", "second:before", "second:after", "first:after"]);
  });

  it("shares and mutates one context through the middleware chain", async () => {
    const context = createContext({
      prompt: "fix tests",
      model: "openai/gpt-5",
      mode: "yolo",
      cwd: "/tmp/work"
    });

    const first: AcpMiddleware = async (ctx, next) => {
      ctx.sessionId = "session-123";
      ctx.events.push({ event: "session_start", threadId: "session-123" });
      ctx.usage.inputTokens += 10;
      await next();
      ctx.events.push({ event: "agent_message", text: "done" });
    };

    const second: AcpMiddleware = async (ctx, next) => {
      ctx.usage.outputTokens += 4;
      ctx.usage.cachedTokens = 2;
      ctx.usage.costUsd = 0.01;
      await next();
    };

    await applyMiddlewares([first, second], context);

    expect(context).toEqual({
      sessionId: "session-123",
      agent: "codex",
      events: [
        { event: "session_start", threadId: "session-123" },
        { event: "agent_message", text: "done" }
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 2,
        costUsd: 0.01
      },
      prompt: "fix tests",
      model: "openai/gpt-5",
      mode: "yolo",
      cwd: "/tmp/work"
    });
  });

  it("handles empty middleware lists", async () => {
    const context = createContext();

    await expect(applyMiddlewares([], context)).resolves.toBeUndefined();
    expect(context.events).toEqual([]);
    expect(context.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("throws if next is called multiple times by the same middleware", async () => {
    const context = createContext();

    const broken: AcpMiddleware = async (_ctx, next) => {
      await next();
      await next();
    };

    await expect(applyMiddlewares([broken], context)).rejects.toThrow(
      "next() called multiple times"
    );
  });

  it("allows middleware to short-circuit the chain by skipping next", async () => {
    const context = createContext();
    const steps: string[] = [];

    const first: AcpMiddleware = async (ctx, _next) => {
      steps.push("first");
      ctx.sessionId = "stopped";
    };

    const second: AcpMiddleware = async (_ctx, _next) => {
      steps.push("second");
    };

    await applyMiddlewares([first, second], context);

    expect(steps).toEqual(["first"]);
    expect(context.sessionId).toBe("stopped");
  });

  it("propagates errors thrown by downstream middleware", async () => {
    const context = createContext();
    const steps: string[] = [];
    const expectedError = new Error("downstream failed");

    const first: AcpMiddleware = async (_ctx, next) => {
      steps.push("first:before");
      await next();
      steps.push("first:after");
    };

    const second: AcpMiddleware = async () => {
      steps.push("second");
      throw expectedError;
    };

    await expect(applyMiddlewares([first, second], context)).rejects.toThrow(expectedError);
    expect(steps).toEqual(["first:before", "second"]);
  });

  it("throws when middleware list contains an invalid entry", async () => {
    const context = createContext();
    const valid: AcpMiddleware = async (_ctx, next) => {
      await next();
    };
    const invalidMiddlewares = [valid, undefined, valid] as unknown as AcpMiddleware[];

    await expect(applyMiddlewares(invalidMiddlewares, context)).rejects.toThrow(
      "Invalid ACP middleware at index 1"
    );
  });
});
