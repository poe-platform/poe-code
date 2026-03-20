import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUpdate } from "@poe-code/agent-spawn";
import type { AcpEvent, AcpSession, RunResult } from "./runtime/types.js";

const systemPromptPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "system-prompt" })));
const filesPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "file-tools" })));
const shellPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "shell-tools" })));
const webPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "web-tools" })));

const acpMock = vi.hoisted(
  () => vi.fn<(prompt: string, options?: Record<string, unknown>) => Promise<AcpSession>>(),
);
const useMock = vi.hoisted(() => vi.fn());
const modelMock = vi.hoisted(() => vi.fn());
const agentMock = vi.hoisted(() => vi.fn());

vi.mock("./agent.js", () => ({
  agent: agentMock,
  normalizeNonEmptyString: (value: string | null | undefined) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
}));

vi.mock("./plugins/poe-agent-plugin-system-prompt.js", () => ({
  default: systemPromptPluginMock,
}));

vi.mock("./plugins/poe-agent-plugin-files.js", () => ({
  default: filesPluginMock,
}));

vi.mock("./plugins/poe-agent-plugin-shell.js", () => ({
  default: shellPluginMock,
}));

vi.mock("./plugins/poe-agent-plugin-web.js", () => ({
  default: webPluginMock,
}));

function asAsyncIterable(events: AcpEvent[]): AsyncIterable<AcpEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

async function createAcpSession(events: AcpEvent[]): Promise<AcpSession> {
  return {
    events: asAsyncIterable(events),
    acknowledge: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("createAgentSession", () => {
  beforeEach(() => {
    systemPromptPluginMock.mockClear();
    filesPluginMock.mockClear();
    shellPluginMock.mockClear();
    webPluginMock.mockClear();
    acpMock.mockReset();
    useMock.mockReset();
    modelMock.mockReset();
    agentMock.mockReset();

    const builder = {
      model: modelMock,
      use: useMock,
      acp: acpMock,
    };

    modelMock.mockReturnValue(builder);
    useMock.mockReturnValue(builder);
    agentMock.mockReturnValue(builder);

    acpMock.mockImplementation(() =>
      createAcpSession([
        {
          type: "message.delta",
          content: "done",
        },
        {
          type: "session.complete",
          result: {
            output: "done",
            messages: [{ role: "assistant", content: "done" }],
            toolCalls: [],
          },
        },
      ]),
    );
  });

  it("exports createAgentSession from package entrypoint", async () => {
    const poeAgent = await import("./index.js");

    expect(poeAgent.createAgentSession).toBeTypeOf("function");
  });

  it("builds the agent with model and default plugins", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    const session = await createAgentSession({
      apiKey: "explicit-key",
      model: "Claude-Sonnet-4.5",
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    await session.sendMessage("hello");

    expect(agentMock).toHaveBeenCalledTimes(1);
    expect(modelMock).toHaveBeenCalledWith("Claude-Sonnet-4.5");
    expect(systemPromptPluginMock).toHaveBeenCalledTimes(1);
    expect(filesPluginMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });
    expect(shellPluginMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });
    expect(webPluginMock).toHaveBeenCalledTimes(1);
    expect(useMock).toHaveBeenCalledTimes(4);
    expect(useMock.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual([
      "system-prompt",
      "file-tools",
      "shell-tools",
      "web-tools",
    ]);

    expect(Object.keys(session).sort()).toEqual(["dispose", "sendMessage"]);
  });

  it("maps ACP stream events to legacy session updates and returns assistant message", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-1",
          tool: "read_file",
          args: { path: "README.md" },
        },
        {
          type: "tool.result",
          intentId: "call-1",
          result: "README content",
        },
        {
          type: "message.delta",
          content: "Done",
        },
        {
          type: "session.complete",
          result: {
            output: "Done",
            messages: [{ role: "assistant", content: "Done" }],
            toolCalls: [
              {
                intentId: "call-1",
                tool: "read_file",
                args: { path: "README.md" },
                status: "success",
                result: "README content",
              },
            ],
          },
        },
      ]),
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key",
    });

    const updates: SessionUpdate[] = [];
    const response = await session.sendMessage("Read README", {
      onSessionUpdate(update) {
        updates.push(update);
      },
    });

    expect(response).toEqual({
      role: "assistant",
      content: "Done",
    });
    expect(updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "read_file",
        kind: "execute",
        status: "pending",
        rawInput: { path: "README.md" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        kind: "execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        kind: "execute",
        status: "completed",
        rawOutput: "README content",
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Done",
        },
      },
    ]);
  });

  it("emits assistant chunk from final output when no message.delta events were streamed", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "Final answer",
            messages: [{ role: "assistant", content: "Final answer" }],
            toolCalls: [],
          },
        },
      ]),
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key",
    });

    const updates: SessionUpdate[] = [];
    await session.sendMessage("hello", {
      onSessionUpdate(update) {
        updates.push(update);
      },
    });

    expect(updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Final answer",
        },
      },
    ]);
  });

  it("resumes subsequent messages from the previous run result", async () => {
    let callCount = 0;
    acpMock.mockImplementation(async (_prompt, options) => {
      callCount += 1;

      if (callCount === 1) {
        expect(options?.resume).toBeUndefined();
        const firstResult: RunResult = {
          output: "first",
          messages: [{ role: "assistant", content: "first" }],
          toolCalls: [],
        };

        return await createAcpSession([
          {
            type: "session.complete",
            result: firstResult,
          },
        ]);
      }

      expect(options?.resume).toEqual({
        output: "first",
        messages: [{ role: "assistant", content: "first" }],
        toolCalls: [],
      });

      return await createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "second",
            messages: [{ role: "assistant", content: "second" }],
            toolCalls: [],
          },
        },
      ]);
    });

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key",
    });

    await session.sendMessage("first");
    await session.sendMessage("second");

    expect(acpMock).toHaveBeenCalledTimes(2);
  });

  it("passes runtime options to acp", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const signal = new AbortController().signal;

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key",
      cwd: "/workspace",
      baseUrl: "http://proxy.example.com",
      fetch: fetchMock,
      maxToolCallIterations: 7,
    });

    await session.sendMessage("hello", { signal });

    expect(acpMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        signal,
        apiKey: "test-key",
        cwd: "/workspace",
        baseUrl: "http://proxy.example.com",
        fetch: fetchMock,
        maxIterations: 7,
        __legacyAutoHandleTools: true,
      }),
    );
  });

  it("forwards undefined apiKey to ACP when not provided", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
    });

    await session.sendMessage("hello");

    expect(acpMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        apiKey: undefined,
      }),
    );
  });

  it("does not resolve API key during session creation", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    await createAgentSession({ model: "Claude-Sonnet-4.5" });
  });

  it("throws clear error when model is missing", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    await expect(
      createAgentSession({
        apiKey: "provided-api-key",
        model: "   ",
      }),
    ).rejects.toThrow("Missing model. Provide a non-empty model to createAgentSession.");
  });

  it("surfaces ACP API-key resolution errors during sendMessage", async () => {
    acpMock.mockRejectedValueOnce(
      new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'."),
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await expect(session.sendMessage("hello")).rejects.toThrow(
      "Missing Poe API key. Provide apiKey or run 'poe-code login'.",
    );
  });

  it("dispose blocks future sends and is idempotent", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
    });

    await session.dispose();
    await session.dispose();

    await expect(session.sendMessage("after dispose")).rejects.toThrow(
      "Agent session is already disposed.",
    );
  });

  it("surfaces session.error and emits failed tool updates", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-2",
          tool: "run_command",
          args: { command: "ls" },
        },
        {
          type: "tool.error",
          intentId: "call-2",
          error: "command failed",
        },
        {
          type: "session.error",
          error: new Error("Maximum tool call iterations reached"),
        },
      ]),
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key",
    });
    const updates: SessionUpdate[] = [];

    await expect(
      session.sendMessage("Run ls", {
        onSessionUpdate(update) {
          updates.push(update);
        },
      }),
    ).rejects.toThrow("Maximum tool call iterations reached");

    expect(updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "run_command",
        kind: "execute",
        status: "pending",
        rawInput: { command: "ls" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        kind: "execute",
        status: "in_progress",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        kind: "execute",
        status: "failed",
        rawOutput: "command failed",
      },
    ]);
  });
});
