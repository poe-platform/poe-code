import { describe, expect, it, vi } from "bun:test";
import { runAcpCore, type AcpModel, type AcpModelResponse } from "./acp-core.js";
import { createRunContext } from "./run-context.js";
import type { AcpEvent, AcpHost } from "./types.js";

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

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

function createHost(): AcpHost {
  return {
    handle: vi.fn(async intent => ({ status: "success", result: { ok: true, intent } })),
    fork: vi.fn(async request => ({ output: request.prompt, messages: [] })),
    spawn: vi.fn(async prompt => ({ output: prompt, messages: [] })),
  };
}

function createTokenBudget(max: number) {
  let total = 0;

  return {
    name: "token-budget",
    hooks: {
      postIteration(ctx: { tokenCount: number }) {
        total += ctx.tokenCount;
        if (total > max) {
          return "abort" as const;
        }
      },
    },
  };
}

async function waitFor(fn: () => void, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await new Promise(r => setTimeout(r, 10));
    }
  }
}

describe("runAcpCore", () => {
  it("emits intent/result events, applies hooks, and completes when the model returns final text", async () => {
    const runContext = createRunContext();
    const hookOrder: string[] = [];

    runContext.hooks.add({
      name: "hooks",
      hooks: {
        preToolUse() {
          hookOrder.push("pre-tool");
        },
        postToolUse() {
          hookOrder.push("post-tool");
        },
      },
    });

    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
      },
      {
        deltas: ["Done"],
        message: {
          content: "Done",
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);

    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      intentId: "tool-1",
      tool: "read_file",
      args: { path: "README.md" },
    });

    expect(hookOrder).toEqual(["pre-tool", "post-tool"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("Done");
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "tool-1",
          tool: "read_file",
          args: { path: "README.md" },
          status: "success",
          result: {
            ok: true,
            intent: {
              intentId: "tool-1",
              tool: "read_file",
              args: { path: "README.md" },
            },
          },
        },
      ]);
    }
  });

  it("serializes tool request messages with stable key order for snapshot playback", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
      },
      {
        message: {
          content: "Done",
          toolCalls: [],
        },
      },
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model,
      }),
    );

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { model: string; messages: unknown[] }
      | undefined;
    expect(secondRequest).toBeDefined();
    const snapshotHashInput = JSON.stringify({
      model: secondRequest?.model,
      messages: secondRequest?.messages,
    });
    expect(snapshotHashInput).toContain(
      '"role":"tool","tool_call_id":"tool-1","name":"read_file","content":"',
    );
  });

  it("preserves raw model tool argument JSON when echoing assistant tool calls", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const rawArguments = '{"command": "create", "path": "/workspace/test-document.txt"}';
    const model = createModel([
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: rawArguments,
              },
            },
          ],
        },
      },
      {
        message: {
          content: "Done",
          toolCalls: [],
        },
      },
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Create a file",
        runContext,
        host,
        model,
      }),
    );

    expect(host.handle).toHaveBeenCalledWith({
      intentId: "call-1",
      tool: "edit_file",
      args: {
        command: "create",
        path: "/workspace/test-document.txt",
      },
    });

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { messages?: Array<{ role?: string; tool_calls?: Array<{ function?: { arguments?: string } }> }> }
      | undefined;
    const assistantMessage = secondRequest?.messages?.find(message => message.role === "assistant");
    expect(assistantMessage?.tool_calls?.[0]?.function?.arguments).toBe(rawArguments);
  });

  it("preserves reasoning fields in follow-up model requests", async () => {
    const runContext = createRunContext();
    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          reasoning_content: "Need to create file first",
          reasoning: "Need to create file first",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: '{"command": "create", "path": "/workspace/test-document.txt"}',
              },
            },
          ],
        },
      },
      {
        message: {
          content: "Done",
          toolCalls: [],
        },
      },
    ]);

    await collectEvents(
      runAcpCore({
        prompt: "Create a file",
        runContext,
        host,
        model,
      }),
    );

    const secondRequest = (model.complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | { messages?: Array<Record<string, unknown>> }
      | undefined;
    const assistantMessage = secondRequest?.messages?.find(message => message.role === "assistant");
    expect(assistantMessage?.reasoning_content).toBe("Need to create file first");
    expect(assistantMessage?.reasoning).toBe("Need to create file first");
  });

  it("maps preToolUse reject into tool.error, skips host execution, and lets the run recover", async () => {
    const runContext = createRunContext();
    runContext.hooks.add({
      name: "guardrail",
      hooks: {
        preToolUse() {
          return { reject: "blocked" };
        },
      },
    });

    const host = createHost();
    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-2",
              tool: "run_command",
              args: { command: "rm -rf /" },
            },
          ],
        },
      },
      {
        message: {
          content: "Recovered",
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Do dangerous thing",
        runContext,
        host,
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.error",
      "message.delta",
      "session.complete",
    ]);

    expect(host.handle).not.toHaveBeenCalled();

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "tool-2",
          tool: "run_command",
          args: { command: "rm -rf /" },
          status: "error",
          error: "blocked",
        },
      ]);
    }
  });

  it("applies guardrails, lets the model recover with a safe command, and executes allowed commands", async () => {
    const runContext = createRunContext();

    const isForbidden = (args: unknown): boolean => {
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return false;
      }

      const command = (args as { command?: unknown }).command;
      return typeof command === "string" && command.includes("rm -rf");
    };

    runContext.hooks.add({
      name: "guardrails",
      hooks: {
        preToolUse(ctx) {
          if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
            return { reject: "Blocked forbidden command" };
          }
        },
      },
    });

    const host = createHost();
    host.handle = vi.fn(async intent => ({
      status: "success",
      result: `executed:${(intent.args as { command?: string }).command ?? ""}`,
    }));

    let callNumber = 0;
    const model: AcpModel = {
      complete: vi.fn(async request => {
        callNumber += 1;

        if (callNumber === 1) {
          return {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "blocked-command",
                  tool: "run_command",
                  args: { command: "rm -rf /tmp/demo" },
                },
              ],
            },
          };
        }

        if (callNumber === 2) {
          expect(request.messages.at(-1)).toEqual({
            role: "tool",
            content: "Error: Blocked forbidden command",
            name: "run_command",
            tool_call_id: "blocked-command",
          });

          return {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "safe-command",
                  tool: "run_command",
                  args: { command: "ls -la" },
                },
              ],
            },
          };
        }

        if (callNumber === 3) {
          expect(request.messages.at(-1)).toEqual({
            role: "tool",
            content: "executed:ls -la",
            name: "run_command",
            tool_call_id: "safe-command",
          });

          return {
            message: {
              content: "Recovered",
              toolCalls: [],
            },
          };
        }

        throw new Error("Unexpected model call");
      }),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Run shell commands",
        runContext,
        host,
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.error",
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);

    expect(host.handle).toHaveBeenCalledTimes(1);
    expect(host.handle).toHaveBeenCalledWith({
      intentId: "safe-command",
      tool: "run_command",
      args: { command: "ls -la" },
    });

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.toolCalls).toEqual([
        {
          intentId: "blocked-command",
          tool: "run_command",
          args: { command: "rm -rf /tmp/demo" },
          status: "error",
          error: "Blocked forbidden command",
        },
        {
          intentId: "safe-command",
          tool: "run_command",
          args: { command: "ls -la" },
          status: "success",
          result: "executed:ls -la",
        },
      ]);
    }
  });

  it("rejects forbidden commands while executing allowed commands from the same model response", async () => {
    const runContext = createRunContext();

    const isForbidden = (args: unknown): boolean => {
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return false;
      }

      const command = (args as { command?: unknown }).command;
      return typeof command === "string" && command.includes("rm -rf");
    };

    runContext.hooks.add({
      name: "guardrails",
      hooks: {
        preToolUse(ctx) {
          if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
            return { reject: "Blocked forbidden command" };
          }
        },
      },
    });

    const host = createHost();
    host.handle = vi.fn(async intent => ({
      status: "success",
      result: `executed:${(intent.args as { command?: string }).command ?? ""}`,
    }));

    let callNumber = 0;
    const model: AcpModel = {
      complete: vi.fn(async request => {
        callNumber += 1;

        if (callNumber === 1) {
          return {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "blocked-command",
                  tool: "run_command",
                  args: { command: "rm -rf /tmp/demo" },
                },
                {
                  id: "safe-command",
                  tool: "run_command",
                  args: { command: "ls -la" },
                },
              ],
            },
          };
        }

        if (callNumber === 2) {
          const toolMessages = request.messages.filter(message => message.role === "tool");
          expect(toolMessages).toEqual([
            {
              role: "tool",
              content: "Error: Blocked forbidden command",
              name: "run_command",
              tool_call_id: "blocked-command",
            },
            {
              role: "tool",
              content: "executed:ls -la",
              name: "run_command",
              tool_call_id: "safe-command",
            },
          ]);

          return {
            message: {
              content: "done",
              toolCalls: [],
            },
          };
        }

        throw new Error("Unexpected model call");
      }),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Run shell commands",
        runContext,
        host,
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.error",
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);

    expect(host.handle).toHaveBeenCalledTimes(1);
    expect(host.handle).toHaveBeenCalledWith({
      intentId: "safe-command",
      tool: "run_command",
      args: { command: "ls -la" },
    });
  });

  it("aborts when postIteration token budget is exceeded and emits AbortError", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(20));

    const disposeRun = vi.fn(async () => undefined);

    const host = createHost();
    host.handle = vi.fn(async () => ({ status: "success", result: "" }));

    const events = await collectEvents(
      runAcpCore({
        prompt: "0123456789",
        runContext,
        host,
        model: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-budget-1",
                  tool: "read_file",
                  args: { path: "README.md" },
                },
              ],
            },
          },
          {
            message: {
              content: "final",
              toolCalls: [],
            },
          },
        ]),
        disposeRun,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.error",
    ]);
    expect(disposeRun).toHaveBeenCalled();

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
    }
  });

  it("completes normally when postIteration token budget is not exceeded", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(40));

    const host = createHost();
    host.handle = vi.fn(async () => ({ status: "success", result: "" }));

    const events = await collectEvents(
      runAcpCore({
        prompt: "0123456789",
        runContext,
        host,
        model: createModel([
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: "tool-budget-2",
                  tool: "read_file",
                  args: { path: "README.md" },
                },
              ],
            },
          },
          {
            message: {
              content: "within budget",
              toolCalls: [],
            },
          },
        ]),
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "message.delta",
      "session.complete",
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("within budget");
    }
  });

  it("does not abort when postIteration token budget equals the threshold", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(createTokenBudget(8));

    const events = await collectEvents(
      runAcpCore({
        prompt: "abcd",
        runContext,
        host: createHost(),
        model: createModel([
          {
            message: {
              content: "efgh",
              toolCalls: [],
            },
          },
        ]),
      }),
    );

    expect(events.map(event => event.type)).toEqual(["message.delta", "session.complete"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("efgh");
    }
  });

  it("supports preIteration skip and still reaches completion", async () => {
    const runContext = createRunContext();
    let calls = 0;

    runContext.hooks.add({
      name: "skip-once",
      hooks: {
        preIteration() {
          calls += 1;
          if (calls === 1) {
            return "skip";
          }
        },
      },
    });

    const model = createModel([
      {
        message: {
          content: "ok",
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Say ok",
        runContext,
        host: createHost(),
        model,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(events.map(event => event.type)).toEqual(["message.delta", "session.complete"]);
  });

  it("emits exactly one terminal session.error event when aborted before execution", async () => {
    const runContext = createRunContext();
    const controller = new AbortController();
    controller.abort();

    const model = createModel([
      {
        message: {
          content: "should not run",
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model,
        signal: controller.signal,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");
    if (events[0]?.type === "session.error") {
      expect(events[0].error.name).toBe("AbortError");
    }
  });

  it("emits exactly one terminal session.error event for model failures", async () => {
    const runContext = createRunContext();
    const events = await collectEvents(
      runAcpCore({
        prompt: "Hello",
        runContext,
        host: createHost(),
        model: createModel([new Error("model failed")]),
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("session.error");
    if (events[0]?.type === "session.error") {
      expect(events[0].error.message).toContain("model failed");
    }
  });

  it("emits session.error when the host fails while handling an intent", async () => {
    const runContext = createRunContext();
    const host = createHost();
    host.handle = vi.fn(async () => {
      throw new Error("host offline");
    });

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-host-fail",
              tool: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual(["tool.intent", "session.error"]);
    expect(events.filter(event => event.type === "session.error")).toHaveLength(1);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.message).toContain("host offline");
    }
  });

  it("aborts while waiting for host ack and emits one terminal error", async () => {
    const runContext = createRunContext();
    const controller = new AbortController();
    let releaseHost: (() => void) | undefined;

    const host = createHost();
    host.handle = vi.fn(
      () =>
        new Promise(resolve => {
          releaseHost = () => resolve({ status: "success", result: "late" });
        }),
    );

    const model = createModel([
      {
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-waiting",
              tool: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
      },
    ]);

    const eventsPromise = collectEvents(
      runAcpCore({
        prompt: "Read the README",
        runContext,
        host,
        model,
        signal: controller.signal,
      }),
    );

    await waitFor(() => {
      expect(host.handle).toHaveBeenCalledTimes(1);
    });

    controller.abort(new Error("stop now"));

    const events = await eventsPromise;

    expect(events.filter(event => event.type === "session.error")).toHaveLength(1);
    expect(events.map(event => event.type)).toEqual(["tool.intent", "session.error"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
    }

    releaseHost?.();
  });

  it("stores streamed deltas in assistant history when message content is missing", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        deltas: ["Hello", " ", "stream"],
        message: {
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Say hello",
        runContext,
        host: createHost(),
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual([
      "message.delta",
      "message.delta",
      "message.delta",
      "session.complete",
    ]);

    expect(runContext.messages).toEqual([
      { role: "user", content: "Say hello" },
      { role: "assistant", content: "Hello stream" },
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("Hello stream");
    }
  });

  it("returns the final model output even when it is an empty string", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        message: {
          content: "thinking",
          toolCalls: [
            {
              id: "tool-3",
              tool: "read_file",
              args: { path: "README.md" },
            },
          ],
        },
      },
      {
        message: {
          content: "",
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Read and stay quiet",
        runContext,
        host: createHost(),
        model,
      }),
    );

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.complete");
    if (terminal?.type === "session.complete") {
      expect(terminal.result.output).toBe("");
    }
  });

  it("emits session.error when the model delta stream throws", async () => {
    const runContext = createRunContext();
    const model = createModel([
      {
        deltas: (async function* () {
          yield "partial";
          throw new Error("stream failed");
        })(),
        message: {
          toolCalls: [],
        },
      },
    ]);

    const events = await collectEvents(
      runAcpCore({
        prompt: "Stream then fail",
        runContext,
        host: createHost(),
        model,
      }),
    );

    expect(events.map(event => event.type)).toEqual(["message.delta", "session.error"]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.message).toContain("stream failed");
    }
  });
});
