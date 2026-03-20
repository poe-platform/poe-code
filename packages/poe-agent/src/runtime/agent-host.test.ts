import { describe, expect, it, vi } from "vitest";
import { runAcpCore, type AcpModel, type AcpModelResponse } from "./acp-core.js";
import { AgentHost, createInMemorySpawnSession } from "./agent-host.js";
import { createRunContext } from "./run-context.js";
import type { AcpEvent } from "./types.js";

function createModel(responses: Array<AcpModelResponse | Error>): AcpModel {
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

      return next;
    }),
  };
}

function createNeverModel(): AcpModel {
  return {
    complete: vi.fn(async () => {
      throw new Error("Unexpected model call");
    }),
  };
}

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("AgentHost.handle", () => {
  it("returns unknown tool error when tool is missing", async () => {
    const runContext = createRunContext();
    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const result = await host.handle({
      intentId: "intent-1",
      tool: "missing.tool",
      args: {},
    });

    expect(result).toEqual({
      status: "error",
      result: "Unknown tool: missing.tool",
    });
  });

  it("consumes async generator tools, emits yielded events, and returns success", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];

    runContext.tools.register({
      name: "demo",
      call: async function* () {
        yield { type: "progress", message: "working" };
        yield { type: "message.delta", content: "chunk" };
        return { ok: true };
      },
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const result = await host.handle({
      intentId: "intent-2",
      tool: "demo",
      args: {},
    });

    expect(result).toEqual({
      status: "success",
      result: { ok: true },
    });
    expect(emitted).toEqual([
      { type: "progress", message: "working" },
      { type: "message.delta", content: "chunk" },
    ]);
  });

  it("returns tool errors when invocation fails", async () => {
    const runContext = createRunContext();
    runContext.tools.register({
      name: "broken",
      call: () => {
        throw new Error("boom");
      },
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const result = await host.handle({
      intentId: "intent-3",
      tool: "broken",
      args: {},
    });

    expect(result).toEqual({
      status: "error",
      result: "boom",
    });
  });

  it("returns tool errors when async generator throws while streaming", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];

    runContext.tools.register({
      name: "broken-stream",
      call: async function* () {
        yield { type: "progress", message: "started" };
        throw new Error("stream exploded");
      },
    });

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const result = await host.handle({
      intentId: "intent-4",
      tool: "broken-stream",
      args: {},
    });

    expect(result).toEqual({
      status: "error",
      result: "stream exploded",
    });
    expect(emitted).toEqual([{ type: "progress", message: "started" }]);
  });
});

describe("AgentHost.fork", () => {
  it("forks with cloned run state and emits fork lifecycle events", async () => {
    const runContext = createRunContext({ activeSkills: ["repo"] });
    runContext.messages.push({ role: "user", content: "existing context" });
    runContext.prompts.addTransform(ctx => ({
      ...ctx,
      system: `fork-system:${ctx.userPrompt}`,
    }));
    runContext.tools.register({
      name: "echo",
      call: () => "echo-result",
    });

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [{ id: "tool-echo", tool: "echo", args: {} }],
        },
      },
      {
        message: {
          content: "fork done",
          toolCalls: [],
        },
      },
    ]);

    const emitted: AcpEvent[] = [];
    const host = new AgentHost({
      runContext,
      model,
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const result = await host.fork({
      forkId: "fork-1",
      prompt: "child task",
      context: {
        messages: [...runContext.messages],
        toolCalls: [],
      },
    });

    expect(result.output).toBe("fork done");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "existing context" },
        { role: "user", content: "child task" },
      ]),
    );
    expect(runContext.messages).toEqual([{ role: "user", content: "existing context" }]);

    const firstModelCall = (model.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstModelCall?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "echo",
        }),
      ]),
    );
    expect(firstModelCall?.messages).toEqual(
      expect.arrayContaining([
        { role: "system", content: "fork-system:child task" },
      ]),
    );

    expect(emitted.map(event => event.type)).toEqual(["fork.start", "fork.complete"]);
  });

  it("aborting the parent run aborts the forked child run", async () => {
    const runContext = createRunContext();
    const model: AcpModel = {
      complete: vi.fn(async ({ signal }) => {
        if (!signal.aborted) {
          await new Promise<void>(resolve => {
            signal.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
          });
        }

        throw new Error("child aborted");
      }),
    };

    const emitted: AcpEvent[] = [];
    const host = new AgentHost({
      runContext,
      model,
      emit(event) {
        emitted.push(event);
      },
      createSpawnSession: () => {
        throw new Error("spawn not configured");
      },
    });

    const forkRun = host.fork({
      forkId: "fork-abort",
      prompt: "will abort",
      context: {
        messages: [],
        toolCalls: [],
      },
    });

    await vi.waitFor(() => {
      expect(model.complete).toHaveBeenCalledTimes(1);
    });

    const forkRejection = expect(forkRun).rejects.toThrow("child aborted");
    runContext.abortController.abort(new Error("stop parent"));

    await forkRejection;
    expect(emitted.map(event => event.type)).toEqual(["fork.start", "fork.error"]);
  });

  it("emits fork lifecycle events once when invoked from the model loop", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "child response",
          toolCalls: [],
        },
      },
      {
        message: {
          content: "parent response",
          toolCalls: [],
        },
      },
    ]);

    runContext.hooks.add({
      name: "fork-once",
      hooks: {
        async preIteration(ctx) {
          const latestMessage = ctx.messages[ctx.messages.length - 1];
          if (latestMessage?.role === "user" && latestMessage.content === "parent prompt") {
            await ctx.fork("child prompt");
          }
        },
      },
    });

    const events = await collectEvents(
      runAcpCore({
        prompt: "parent prompt",
        runContext,
        host: new AgentHost({
          runContext,
          model,
          createSpawnSession: () => {
            throw new Error("spawn not configured");
          },
        }),
        model,
      }),
    );

    expect(events.filter(event => event.type === "fork.start")).toHaveLength(1);
    expect(events.filter(event => event.type === "fork.complete")).toHaveLength(1);
  });

  it("does not duplicate fork lifecycle events when host emit is wired", async () => {
    const runContext = createRunContext();
    const emitted: AcpEvent[] = [];
    const model = createModel([
      {
        message: {
          content: "child response",
          toolCalls: [],
        },
      },
      {
        message: {
          content: "parent response",
          toolCalls: [],
        },
      },
    ]);

    runContext.hooks.add({
      name: "fork-once",
      hooks: {
        async preIteration(ctx) {
          const latestMessage = ctx.messages[ctx.messages.length - 1];
          if (latestMessage?.role === "user" && latestMessage.content === "parent prompt") {
            await ctx.fork("child prompt");
          }
        },
      },
    });

    await collectEvents(
      runAcpCore({
        prompt: "parent prompt",
        runContext,
        host: new AgentHost({
          runContext,
          model,
          emit(event) {
            emitted.push(event);
          },
          createSpawnSession: () => {
            throw new Error("spawn not configured");
          },
        }),
        model,
      }),
    );

    expect(emitted.filter(event => event.type === "fork.start")).toHaveLength(1);
    expect(emitted.filter(event => event.type === "fork.complete")).toHaveLength(1);
  });
});

describe("AgentHost.spawn", () => {
  it("runs spawn via in-memory ACP client without propagating parent abort signal", async () => {
    const runContext = createRunContext();
    runContext.abortController.abort(new Error("parent aborted"));

    const sendMessage = vi.fn(async (prompt: string) => ({
      role: "assistant" as const,
      content: `spawned:${prompt}`,
    }));
    const disposeSession = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      sendMessage,
      dispose: disposeSession,
    }));

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () =>
        createInMemorySpawnSession({
          model: "test-model",
          cwd: "/tmp/poe-agent",
          createSession,
        }),
    });

    const result = await host.spawn("hello child");

    expect(result).toEqual({
      output: "spawned:hello child",
      messages: [{ role: "assistant", content: "spawned:hello child" }],
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        cwd: "/tmp/poe-agent",
      }),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe("hello child");
    expect(sendMessage.mock.calls[0]?.[1]).toBeUndefined();
    expect(disposeSession).toHaveBeenCalledTimes(1);
  });

  it("disposes spawned client and throws when prompt stop reason is not completed", async () => {
    const runContext = createRunContext();
    const dispose = vi.fn(async () => undefined);

    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => ({
        cwd: "/tmp/spawn",
        mcpServers: [],
        client: {
          initialize: vi.fn(async () => undefined),
          newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
          prompt: vi.fn(() => ({
            response: Promise.resolve({ stopReason: "cancelled" as const }),
            async *[Symbol.asyncIterator]() {
              yield* [];
              return;
            },
          })),
          dispose,
        },
      }),
    });

    await expect(host.spawn("hello child")).rejects.toThrow(
      "Spawned session ended with stop reason: cancelled",
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes spawned client when prompt iteration fails", async () => {
    const runContext = createRunContext();
    const dispose = vi.fn(async () => undefined);
    const host = new AgentHost({
      runContext,
      model: createNeverModel(),
      createSpawnSession: () => ({
        cwd: "/tmp/spawn",
        mcpServers: [],
        client: {
          initialize: vi.fn(async () => undefined),
          newSession: vi.fn(async () => ({ sessionId: "spawn-session" })),
          prompt: vi.fn(() => ({
            response: Promise.resolve({ stopReason: "completed" as const }),
            async *[Symbol.asyncIterator]() {
              yield* [];
              throw new Error("stream broken");
            },
          })),
          dispose,
        },
      }),
    });

    await expect(host.spawn("hello child")).rejects.toThrow("stream broken");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
