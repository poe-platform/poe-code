import { describe, expect, it, vi } from "vitest";
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

    await vi.waitFor(() => {
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
