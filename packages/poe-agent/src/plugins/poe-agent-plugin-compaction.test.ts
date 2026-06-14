import { describe, expect, it, vi } from "vitest";
import { createRunContext } from "../runtime/run-context.js";
import { runAcpCore, type AcpModel, type AcpModelResponse } from "../runtime/acp-core.js";
import { toAcpModelResponse, type LegacyAcpModelResponse } from "../testing/model-response.js";
import type { AcpEvent, AcpHost, ChatMessage } from "../runtime/types.js";
import compactionPlugin, { spec as compactionPluginSpec } from "./poe-agent-plugin-compaction.js";

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function createHost(): AcpHost {
  return {
    handle: vi.fn(async (intent) => ({ status: "success", result: { ok: true, intent } })),
    fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
    spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
  };
}

function createQueuedModel(
  responses: Array<LegacyAcpModelResponse | AcpModelResponse | Error>
): AcpModel {
  const queue = [...responses];

  return {
    complete: vi.fn(async () => {
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected model call");
      }

      if (next instanceof Error) {
        throw next;
      }

      return toAcpModelResponse(next);
    })
  };
}

function getSessionMessages(events: AcpEvent[]): ChatMessage[] {
  const terminal = events.at(-1);
  if (!terminal || terminal.type !== "session.complete") {
    throw new Error("Expected a session.complete event");
  }

  return terminal.result.messages;
}

describe("poe-agent-plugin-compaction", () => {
  it("validates config options with its plugin spec", () => {
    expect(
      compactionPluginSpec.parseOptions({
        threshold: 20,
        contextWindow: 100,
        keepLastTurns: 2
      })
    ).toEqual({
      threshold: 20,
      contextWindow: 100,
      keepLastTurns: 2
    });
    expect(() => compactionPluginSpec.parseOptions({ threshold: "20" })).toThrow();
  });

  it("uses the plugin contextWindow option to derive the default threshold", async () => {
    const runContext = createRunContext();
    runContext.messages.push(
      { role: "user", content: "old" },
      { role: "assistant", content: "reply" }
    );
    runContext.hooks.add(compactionPlugin({ contextWindow: 10, keepLastTurns: 1 }));

    const model = createQueuedModel([
      {
        message: {
          content: "latest",
          toolCalls: []
        }
      },
      {
        message: {
          content: "summary from option",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "new",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(getSessionMessages(events)).toEqual([
      {
        role: "system",
        name: "compaction",
        content: "Compacted context summary:\nsummary from option"
      },
      { role: "user", content: "new" },
      { role: "assistant", content: "latest" }
    ]);
  });

  it("summarises older messages into one system note and keeps the latest turns verbatim", async () => {
    const runContext = createRunContext();
    const postCompactionCalls: Array<{
      summary: string;
      droppedMessages: ChatMessage[];
      tokenCount: number;
    }> = [];

    runContext.messages.push(
      { role: "system", content: "Project memory" },
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" }
    );
    runContext.hooks.add(compactionPlugin({ threshold: 20, keepLastTurns: 1 }));
    runContext.hooks.add({
      name: "observer",
      hooks: {
        postCompaction(ctx) {
          postCompactionCalls.push({
            summary: ctx.summary,
            droppedMessages: [...ctx.droppedMessages],
            tokenCount: ctx.tokenCount
          });
        }
      }
    });

    const model = createQueuedModel([
      {
        message: {
          content: "Latest answer",
          toolCalls: []
        }
      },
      {
        message: {
          content: "Compact summary",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Newest request",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(postCompactionCalls).toEqual([
      {
        summary: "Compact summary",
        droppedMessages: [
          { role: "user", content: "Older request" },
          { role: "assistant", content: "Older answer" }
        ],
        tokenCount: expect.any(Number)
      }
    ]);

    expect(getSessionMessages(events)).toEqual([
      { role: "system", content: "Project memory" },
      {
        role: "system",
        name: "compaction",
        content: "Compacted context summary:\nCompact summary"
      },
      { role: "user", content: "Newest request" },
      { role: "assistant", content: "Latest answer" }
    ]);
  });

  it("lets preCompaction hooks skip compaction", async () => {
    const runContext = createRunContext();
    runContext.messages.push(
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" }
    );
    runContext.hooks.add(compactionPlugin({ threshold: 1, keepLastTurns: 1 }));
    runContext.hooks.add({
      name: "skip-compaction",
      hooks: {
        preCompaction() {
          return "skip";
        }
      }
    });

    const model = createQueuedModel([
      {
        message: {
          content: "Latest answer",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Newest request",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(getSessionMessages(events)).toEqual([
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" },
      { role: "user", content: "Newest request" },
      { role: "assistant", content: "Latest answer" }
    ]);
  });

  it("keeps an explicit keepLastTurns: 0 instead of defaulting it", async () => {
    const runContext = createRunContext();
    runContext.messages.push(
      { role: "user", content: "Request 1" },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Request 2" },
      { role: "assistant", content: "Answer 2" },
      { role: "user", content: "Request 3" },
      { role: "assistant", content: "Answer 3" }
    );
    runContext.hooks.add(
      compactionPlugin({
        threshold: 1,
        keepLastTurns: 0,
        summarise() {
          return "Summary for every turn";
        }
      })
    );

    const model = createQueuedModel([
      {
        message: {
          content: "Answer 4",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Request 4",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(getSessionMessages(events)).toEqual([
      {
        role: "system",
        name: "compaction",
        content: "Compacted context summary:\nSummary for every turn"
      }
    ]);
  });

  it("uses a custom summarise function without making an extra model call", async () => {
    const runContext = createRunContext();
    runContext.messages.push(
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" }
    );
    runContext.hooks.add(
      compactionPlugin({
        threshold: 1,
        keepLastTurns: 1,
        async summarise(messages) {
          return `Custom summary for ${messages.length} messages`;
        }
      })
    );

    const model = createQueuedModel([
      {
        message: {
          content: "Latest answer",
          toolCalls: []
        }
      }
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Newest request",
        runContext,
        host: createHost(),
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(getSessionMessages(events)).toEqual([
      {
        role: "system",
        name: "compaction",
        content: "Compacted context summary:\nCustom summary for 2 messages"
      },
      { role: "user", content: "Newest request" },
      { role: "assistant", content: "Latest answer" }
    ]);
  });

  it("passes file awareness to custom summarise functions that accept it", async () => {
    const runContext = createRunContext({ cwd: "/workspace/project" });
    runContext.fileAwareness.recordRead("README.md");
    runContext.fileAwareness.recordWrite("src/index.ts");
    runContext.messages.push(
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" }
    );
    runContext.hooks.add(
      compactionPlugin({
        threshold: 1,
        keepLastTurns: 1,
        summarise(_messages, awareness) {
          return `read=${Array.from(awareness.readFiles).join(",")} modified=${Array.from(
            awareness.modifiedFiles
          ).join(",")}`;
        }
      })
    );

    const model = createQueuedModel([{ message: { content: "Latest answer", toolCalls: [] } }]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Newest request",
        runContext,
        host: createHost(),
        model
      })
    );

    expect(getSessionMessages(events)[0]).toEqual({
      role: "system",
      name: "compaction",
      content:
        "Compacted context summary:\nread=/workspace/project/README.md modified=/workspace/project/src/index.ts"
    });
  });

  it("includes file awareness in the default summariser request", async () => {
    const runContext = createRunContext({ cwd: "/workspace/project" });
    runContext.fileAwareness.recordRead("README.md");
    runContext.fileAwareness.recordWrite("src/index.ts");
    runContext.messages.push(
      { role: "user", content: "Older request" },
      { role: "assistant", content: "Older answer" }
    );
    runContext.hooks.add(compactionPlugin({ threshold: 1, keepLastTurns: 1 }));

    const model = createQueuedModel([
      { message: { content: "Latest answer", toolCalls: [] } },
      { message: { content: "Compact summary", toolCalls: [] } }
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Newest request",
        runContext,
        host: createHost(),
        model
      })
    );

    const summaryRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { messages?: ChatMessage[] }
      | undefined;
    expect(summaryRequest?.messages?.[0]?.content).toContain(
      "Files read before compaction:\n- /workspace/project/README.md"
    );
    expect(summaryRequest?.messages?.[0]?.content).toContain(
      "Files modified before compaction:\n- /workspace/project/src/index.ts"
    );
  });
});
