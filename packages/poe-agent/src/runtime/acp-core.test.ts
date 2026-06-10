import { describe, expect, it, vi } from "vitest";
import { runAcpCore, type AcpModel } from "./acp-core.js";
import { createRunContext } from "./run-context.js";
import type { ProviderStreamEvent } from "./plugin-types.js";
import type { AcpEvent, AcpHost } from "./types.js";

function createHost(): AcpHost {
  return {
    handle: vi.fn(async (intent) => ({ status: "success", result: { ok: true, intent } })),
    fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
    spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
  };
}

function createModel(iterations: ProviderStreamEvent[][]): AcpModel {
  const queue = [...iterations];

  return {
    complete: vi.fn(async () => {
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected model call");
      }

      return {
        events: {
          async *[Symbol.asyncIterator]() {
            for (const event of next) {
              yield event;
            }
          }
        }
      };
    })
  };
}

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("acp-core event stream", () => {
  it("keeps the compiled system prompt alongside compaction summaries", async () => {
    const runContext = createRunContext();
    runContext.messages.push({
      role: "system",
      name: "compaction",
      content: "Compacted context summary:\nEarlier work"
    });
    const model = createModel([[{ type: "stop", reason: "end_turn" }]]);

    await collectEvents(
      runAcpCore({
        prompt: "Continue",
        baseSystemPrompt: "Follow the system instructions",
        runContext,
        host: createHost(),
        model
      })
    );

    expect(model.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: "system", content: "Follow the system instructions" },
          {
            role: "system",
            name: "compaction",
            content: "Compacted context summary:\nEarlier work"
          }
        ])
      })
    );
  });

  it.each(["error", "max_tokens"] as const)(
    "reports %s model stops as session errors",
    async (reason) => {
      const events = await collectEvents(
        runAcpCore({
          prompt: "Continue",
          runContext: createRunContext(),
          host: createHost(),
          model: createModel([[{ type: "stop", reason }]])
        })
      );

      expect(events.at(-1)?.type).toBe("session.error");
    }
  );

  it("aborts the run when a stream consumer returns early", async () => {
    const runContext = createRunContext();
    const model: AcpModel = {
      complete: vi.fn(async ({ signal }) => ({
        events: {
          async *[Symbol.asyncIterator]() {
            yield { type: "text", text: "first" } as const;
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
            yield { type: "stop", reason: "end_turn" } as const;
          }
        }
      }))
    };

    for await (const event of runAcpCore({
      prompt: "Continue",
      runContext,
      host: createHost(),
      model
    })) {
      expect(event.type).toBe("message.delta");
      break;
    }

    expect(runContext.abortController.signal.aborted).toBe(true);
  });

  it("reconstructs final assistant text from text events", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Say hello",
        runContext,
        host: createHost(),
        model: createModel([
          [
            { type: "text", text: "Hello" },
            { type: "text", text: " world" },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.delta",
      "session.complete"
    ]);
    expect(runContext.messages).toEqual([
      { role: "user", content: "Say hello" },
      { role: "assistant", content: "Hello world" }
    ]);
  });

  it("accumulates tool_use_complete events into assistant tool_calls", async () => {
    const runContext = createRunContext();
    const host = createHost();

    await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model: createModel([
          [
            {
              type: "tool_use_complete",
              id: "tool-1",
              name: "read_file",
              args: { path: "README.md" }
            },
            { type: "stop", reason: "tool_use" }
          ],
          [
            { type: "text", text: "Done" },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(host.handle).toHaveBeenCalledWith({
      intentId: "tool-1",
      tool: "read_file",
      args: { path: "README.md" }
    });
    expect(
      (runContext.messages[1] as (typeof runContext.messages)[number] & { tool_calls?: unknown })
        .tool_calls
    ).toEqual([
      {
        id: "tool-1",
        type: "function",
        function: {
          name: "read_file",
          arguments: '{"path":"README.md"}'
        }
      }
    ]);
  });

  it("emits a single tool.intent from tool_use_delta before tool execution", async () => {
    const runContext = createRunContext();
    const host = createHost();

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model: createModel([
          [
            { type: "tool_use_delta", id: "tool-1", name: "read_file" },
            { type: "tool_use_delta", id: "tool-1", argsDelta: '{"path":"README.md"}' },
            {
              type: "tool_use_complete",
              id: "tool-1",
              name: "read_file",
              args: { path: "README.md" }
            },
            { type: "stop", reason: "tool_use" }
          ],
          [
            { type: "text", text: "Done" },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(events.filter((event) => event.type === "tool.intent")).toEqual([
      {
        type: "tool.intent",
        intentId: "tool-1",
        tool: "read_file",
        args: { path: "README.md" }
      }
    ]);
    expect(host.handle).toHaveBeenCalledTimes(1);
  });

  it("preserves thinking and reasoning details on the assistant message", async () => {
    const runContext = createRunContext();

    await collectEvents(
      runAcpCore({
        prompt: "Think first",
        runContext,
        host: createHost(),
        model: createModel([
          [
            { type: "thinking", text: "Need more context", signature: "sig-1" },
            { type: "reasoning_details", payload: { id: "reasoning-1" } },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(runContext.messages[1]).toEqual({
      role: "assistant",
      content: "",
      thinking: [{ text: "Need more context", signature: "sig-1" }],
      reasoning_content: "Need more context",
      reasoning: "Need more context",
      reasoning_details: [{ id: "reasoning-1" }]
    });
  });

  it("emits usage exactly once per iteration", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Use tools then finish",
        runContext,
        host: createHost(),
        model: createModel([
          [
            {
              type: "tool_use_complete",
              id: "tool-1",
              name: "read_file",
              args: { path: "README.md" }
            },
            {
              type: "usage",
              inputTokens: 10,
              outputTokens: 2,
              cachedTokens: 3,
              cacheCreationTokens: 4
            },
            { type: "stop", reason: "tool_use" }
          ],
          [
            { type: "text", text: "Done" },
            {
              type: "usage",
              inputTokens: 20,
              outputTokens: 5,
              cachedTokens: 6,
              cacheCreationTokens: 7
            },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(events.filter((event) => event.type === "usage")).toEqual([
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cachedTokens: 3,
          cacheCreationTokens: 4
        }
      },
      {
        type: "usage",
        usage: {
          inputTokens: 20,
          outputTokens: 5,
          cachedTokens: 6,
          cacheCreationTokens: 7
        }
      }
    ]);
  });

  it("routes tool_use_json_parse_error through the tool-error path", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Call a tool with bad JSON",
        runContext,
        host: createHost(),
        model: createModel([
          [
            { type: "tool_use_delta", id: "tool-1", name: "read_file" },
            {
              type: "tool_use_json_parse_error",
              id: "tool-1",
              raw: '{"path":',
              error: "Unexpected end of JSON input"
            },
            { type: "stop", reason: "tool_use" }
          ],
          [
            { type: "text", text: "Recovered" },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool.error",
      "message.delta",
      "session.complete"
    ]);
    expect(runContext.messages[1]).toEqual({
      role: "assistant",
      content: ""
    });
    expect(runContext.messages[2]).toEqual({
      role: "tool",
      name: "read_file",
      toolCallId: "tool-1",
      content: "Error: Unexpected end of JSON input"
    });
  });

  it("terminates reasoning-only responses without a tool call", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Just think",
        runContext,
        host: createHost(),
        model: createModel([
          [
            { type: "thinking", text: "Quiet reasoning" },
            { type: "reasoning_details", payload: { id: "reasoning-quiet" } },
            { type: "stop", reason: "end_turn" }
          ]
        ])
      })
    );

    expect(events.map((event) => event.type)).toEqual(["session.complete"]);
    const terminal = events[0];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("");
      expect(terminal.result.toolCalls).toEqual([]);
    }
  });
});
