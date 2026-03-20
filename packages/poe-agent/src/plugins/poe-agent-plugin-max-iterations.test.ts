import { describe, expect, it, vi } from "vitest";
import { createRunContext } from "../runtime/run-context.js";
import { runAcpCore, type AcpModel } from "../runtime/acp-core.js";
import type { AcpEvent, AcpHost } from "../runtime/types.js";
import maxIterations from "./poe-agent-plugin-max-iterations.js";

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("poe-agent-plugin-max-iterations", () => {
  it("aborts after the configured iteration limit", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(maxIterations(2));

    const host: AcpHost = {
      handle: vi.fn(async () => ({ status: "success", result: "ok" })),
      fork: vi.fn(async request => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async prompt => ({ output: prompt, messages: [] })),
    };

    let callCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        callCount += 1;
        return {
          message: {
            content: "",
            toolCalls: [
              {
                id: `tool-${callCount}`,
                tool: "always_call_tool",
                args: { iteration: callCount },
              },
            ],
          },
        };
      }),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "tool.intent",
      "tool.result",
      "session.error",
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("preIteration");
    }
  });

  it("aborts immediately when limit is zero", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(maxIterations(0));

    const host: AcpHost = {
      handle: vi.fn(async () => ({ status: "success", result: "ok" })),
      fork: vi.fn(async request => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async prompt => ({ output: prompt, messages: [] })),
    };

    const model: AcpModel = {
      complete: vi.fn(async () => ({
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "always_call_tool",
              args: { iteration: 1 },
            },
          ],
        },
      })),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(events).toHaveLength(1);

    const terminal = events[0];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("preIteration");
    }
  });
});
