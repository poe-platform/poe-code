import type { AcpSpawnContext } from "@poe-code/agent-spawn";
import { describe, expect, it, vi } from "vitest";

import { createTraceSinkMiddleware } from "./trace-sink.js";

describe("createTraceSinkMiddleware", () => {
  it("emits exactly once after the completed trace is available", async () => {
    const sink = vi.fn();
    const middleware = createTraceSinkMiddleware(sink);
    const ctx = createContext();

    await middleware(ctx, async () => {
      ctx.events.push({ event: "agent_message", text: "done" });
    });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ root: expect.objectContaining({ output: "done" }) })
    );
  });

  it("emits the available trace when the spawn fails", async () => {
    const sink = vi.fn();
    const middleware = createTraceSinkMiddleware(sink);
    const ctx = createContext();

    await expect(
      middleware(ctx, async () => {
        ctx.events.push({ event: "error", message: "failed" });
        throw new Error("failed");
      })
    ).rejects.toThrow("failed");

    expect(sink).toHaveBeenCalledTimes(1);
  });
});

function createContext(): AcpSpawnContext {
  return {
    sessionId: "session-1",
    agent: "codex",
    events: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    prompt: "test",
    model: "gpt-5"
  };
}
