import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUpdate } from "@poe-code/agent-spawn";
import type { AcpSession } from "./agent.js";
import type { AcpEvent, RunResult } from "./runtime/types.js";

const openaiResponsesPluginMock = vi.hoisted(() =>
  vi.fn(() => ({ name: "openai-responses-plugin" }))
);
const openaiChatCompletionsPluginMock = vi.hoisted(() =>
  vi.fn(() => ({ name: "openai-chat-completions-plugin" }))
);
const systemPromptPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "system-prompt" })));
const filesPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "file-tools" })));
const shellPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "shell-tools" })));
const webPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "web-tools" })));
const policyPluginMock = vi.hoisted(() => vi.fn(() => ({ name: "policy" })));
const resolvePluginsFromConfigMock = vi.hoisted(() => vi.fn());

const acpMock = vi.hoisted(() =>
  vi.fn<(prompt: string, options?: Record<string, unknown>) => Promise<AcpSession>>()
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
  }
}));

vi.mock("./plugins/poe-agent-plugin-system-prompt.js", () => ({
  default: systemPromptPluginMock,
  spec: { name: "system-prompt" }
}));

vi.mock("./plugins/poe-agent-plugin-files.js", () => ({
  default: filesPluginMock,
  spec: { name: "files" }
}));

vi.mock("./plugins/poe-agent-plugin-openai-responses.js", () => ({
  openaiResponsesPlugin: openaiResponsesPluginMock,
  default: openaiResponsesPluginMock,
  spec: { name: "openai-responses" }
}));

vi.mock("./plugins/poe-agent-plugin-openai-chat-completions.js", () => ({
  openaiChatCompletionsPlugin: openaiChatCompletionsPluginMock,
  default: openaiChatCompletionsPluginMock,
  spec: { name: "openai-chat-completions" }
}));

vi.mock("./plugins/poe-agent-plugin-shell.js", () => ({
  default: shellPluginMock,
  spec: { name: "shell" }
}));

vi.mock("./plugins/poe-agent-plugin-web.js", () => ({
  default: webPluginMock,
  spec: { name: "web" }
}));

vi.mock("./plugins/poe-agent-plugin-policy.js", () => ({
  default: policyPluginMock,
  spec: { name: "policy" }
}));

vi.mock("./plugins/resolve-plugins.js", () => ({
  resolvePluginsFromConfig: resolvePluginsFromConfigMock
}));

function asAsyncIterable(events: AcpEvent[]): AsyncIterable<AcpEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    }
  };
}

async function createAcpSession(events: AcpEvent[]): Promise<AcpSession> {
  return {
    events: asAsyncIterable(events),
    acknowledge: vi.fn(),
    dispose: vi.fn()
  };
}

describe("createAgentSession", () => {
  beforeEach(() => {
    openaiResponsesPluginMock.mockClear();
    openaiChatCompletionsPluginMock.mockClear();
    systemPromptPluginMock.mockClear();
    filesPluginMock.mockClear();
    shellPluginMock.mockClear();
    webPluginMock.mockClear();
    policyPluginMock.mockClear();
    resolvePluginsFromConfigMock.mockReset();
    acpMock.mockReset();
    useMock.mockReset();
    modelMock.mockReset();
    agentMock.mockReset();

    const builder = {
      model: modelMock,
      use: useMock,
      acp: acpMock
    };

    modelMock.mockReturnValue(builder);
    useMock.mockReturnValue(builder);
    agentMock.mockReturnValue(builder);

    acpMock.mockImplementation(() =>
      createAcpSession([
        {
          type: "message.delta",
          content: "done"
        },
        {
          type: "session.complete",
          result: {
            output: "done",
            stdout: "done",
            summary: "done",
            messages: [{ role: "assistant", content: "done" }],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
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
      allowedPaths: ["/workspace/project"]
    });

    await session.sendMessage("hello");

    expect(agentMock).toHaveBeenCalledTimes(1);
    expect(modelMock).toHaveBeenCalledWith("Claude-Sonnet-4.5");
    expect(openaiResponsesPluginMock).toHaveBeenCalledTimes(1);
    expect(openaiChatCompletionsPluginMock).toHaveBeenCalledTimes(1);
    expect(systemPromptPluginMock).toHaveBeenCalledTimes(1);
    expect(filesPluginMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"]
    });
    expect(shellPluginMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"]
    });
    expect(webPluginMock).toHaveBeenCalledTimes(1);
    expect(useMock).toHaveBeenCalledTimes(6);
    expect(useMock.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      "openai-responses-plugin",
      "openai-chat-completions-plugin",
      "system-prompt",
      "file-tools",
      "shell-tools",
      "web-tools"
    ]);

    expect(Object.keys(session).sort()).toEqual([
      "dispose",
      "fork",
      "getHistory",
      "id",
      "navigateTo",
      "sendMessage",
      "tree"
    ]);
  });

  it("adds the policy plugin when mode is provided", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      mode: "read"
    });

    await session.sendMessage("hello");

    expect(policyPluginMock).toHaveBeenCalledWith({ mode: "read" });
    expect(useMock.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      "openai-responses-plugin",
      "openai-chat-completions-plugin",
      "system-prompt",
      "file-tools",
      "shell-tools",
      "web-tools",
      "policy"
    ]);
  });

  it("uses explicit session plugins instead of the default plugin bundle", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const customPlugins = [{ name: "custom-a" }, { name: "custom-b" }];

    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      mode: "edit",
      plugins: customPlugins
    });

    await session.sendMessage("hello");

    expect(systemPromptPluginMock).not.toHaveBeenCalled();
    expect(filesPluginMock).not.toHaveBeenCalled();
    expect(openaiResponsesPluginMock).not.toHaveBeenCalled();
    expect(openaiChatCompletionsPluginMock).not.toHaveBeenCalled();
    expect(shellPluginMock).not.toHaveBeenCalled();
    expect(webPluginMock).not.toHaveBeenCalled();
    expect(useMock.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      "custom-a",
      "custom-b",
      "policy"
    ]);
  });

  it("uses pluginsConfig instead of the default plugin bundle", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    resolvePluginsFromConfigMock.mockReturnValue([{ name: "config-a" }, { name: "config-b" }]);

    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      pluginsConfig: [{ name: "web" }]
    });

    await session.sendMessage("hello");

    expect(resolvePluginsFromConfigMock).toHaveBeenCalledWith([{ name: "web" }]);
    expect(systemPromptPluginMock).not.toHaveBeenCalled();
    expect(filesPluginMock).not.toHaveBeenCalled();
    expect(openaiResponsesPluginMock).not.toHaveBeenCalled();
    expect(openaiChatCompletionsPluginMock).not.toHaveBeenCalled();
    expect(shellPluginMock).not.toHaveBeenCalled();
    expect(webPluginMock).not.toHaveBeenCalled();
    expect(useMock.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual([
      "config-a",
      "config-b"
    ]);
  });

  it("rejects using plugins and pluginsConfig together", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    await expect(
      createAgentSession({
        model: "Claude-Sonnet-4.5",
        plugins: [{ name: "custom" }],
        pluginsConfig: [{ name: "web" }]
      })
    ).rejects.toThrow("plugins and pluginsConfig");
  });

  it("maps ACP stream events to legacy session updates and returns assistant message", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-1",
          tool: "read_file",
          args: { path: "README.md" }
        },
        {
          type: "tool.result",
          intentId: "call-1",
          result: "README content"
        },
        {
          type: "message.delta",
          content: "Done"
        },
        {
          type: "session.complete",
          result: {
            output: "Done",
            stdout: "Done",
            summary: "Done",
            messages: [{ role: "assistant", content: "Done" }],
            toolCalls: [
              {
                intentId: "call-1",
                tool: "read_file",
                args: { path: "README.md" },
                status: "success",
                result: "README content"
              }
            ],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key"
    });

    const updates: SessionUpdate[] = [];
    const response = await session.sendMessage("Read README", {
      onSessionUpdate(update) {
        updates.push(update);
      }
    });

    expect(response).toEqual({
      role: "assistant",
      content: "Done"
    });
    expect(updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "read_file",
        kind: "execute",
        status: "pending",
        rawInput: { path: "README.md" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        kind: "execute",
        status: "in_progress"
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        kind: "execute",
        status: "completed",
        rawOutput: "README content"
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Done"
        }
      }
    ]);
  });

  it("maps multimodal tool results into legacy tool_call_update content", async () => {
    const multimodalResult = [
      { type: "text", text: "Screenshot captured" },
      { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" }
    ] as const;

    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-1",
          tool: "read_file",
          args: { path: "diagram.png" }
        },
        {
          type: "tool.result",
          intentId: "call-1",
          result: multimodalResult
        },
        {
          type: "session.complete",
          result: {
            output: "Done",
            stdout: "Done",
            summary: "Done",
            messages: [{ role: "assistant", content: "Done" }],
            toolCalls: [
              {
                intentId: "call-1",
                tool: "read_file",
                args: { path: "diagram.png" },
                status: "success",
                result: multimodalResult
              }
            ],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key"
    });

    const updates: SessionUpdate[] = [];
    await session.sendMessage("Read diagram", {
      onSessionUpdate(update) {
        updates.push(update);
      }
    });

    expect(updates).toContainEqual({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      kind: "execute",
      status: "completed",
      rawOutput: multimodalResult,
      content: [
        { type: "text", text: "Screenshot captured" },
        { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" }
      ]
    });
  });

  it("emits assistant chunk from final output when no message.delta events were streamed", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "Final answer",
            stdout: "Final answer",
            summary: "Final answer",
            messages: [{ role: "assistant", content: "Final answer" }],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key"
    });

    const updates: SessionUpdate[] = [];
    await session.sendMessage("hello", {
      onSessionUpdate(update) {
        updates.push(update);
      }
    });

    expect(updates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Final answer"
        }
      }
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
          stdout: "first",
          summary: "first",
          messages: [{ role: "assistant", content: "first" }],
          toolCalls: [],
          exitCode: 0,
          stderr: ""
        };

        return await createAcpSession([
          {
            type: "session.complete",
            result: firstResult
          }
        ]);
      }

      expect(options?.resume).toEqual({
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "first" }
        ]
      });

      return await createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "second",
            stdout: "second",
            summary: "second",
            messages: [{ role: "assistant", content: "second" }],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ]);
    });

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key"
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
      maxToolCallIterations: 7
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
        __legacyAutoHandleTools: true
      })
    );
  });

  it("seeds the first run with resumed messages", async () => {
    const messages = [
      { role: "user" as const, content: "remember zebra" },
      { role: "assistant" as const, content: "remembered" }
    ];
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      resume: { messages }
    });

    await session.sendMessage("what word?");

    expect(session.tree().map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
    expect(acpMock).toHaveBeenCalledWith(
      "what word?",
      expect.objectContaining({ resume: { messages } })
    );
  });

  it("exposes the latest completed message history", async () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "done" }
    ];
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "done",
            stdout: "done",
            summary: "done",
            messages,
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await session.sendMessage("hello");

    expect(session.getHistory()).toEqual(messages);
  });

  it("records session tree entries from ACP events", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-1",
          tool: "read_file",
          args: { path: "README.md" }
        },
        {
          type: "tool.result",
          intentId: "call-1",
          result: "README content"
        },
        {
          type: "session.complete",
          result: {
            output: "Done",
            stdout: "Done",
            summary: "Done",
            messages: [{ role: "assistant", content: "Done" }],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await session.sendMessage("Read README");

    expect((await session.tree()).map((entry) => entry.kind)).toEqual([
      "user",
      "tool_call",
      "tool_result",
      "assistant"
    ]);
  });

  it("records the submitted prompt after userPromptSubmit transforms it", async () => {
    acpMock.mockImplementationOnce(async (_prompt, options) => {
      const callback = options?.onPromptSubmitted as ((prompt: string) => Promise<void>) | undefined;
      await callback?.("redacted prompt");

      return createAcpSession([
        {
          type: "session.complete",
          result: {
            output: "Done",
            stdout: "Done",
            summary: "Done",
            messages: [
              { role: "user", content: "redacted prompt" },
              { role: "assistant", content: "Done" }
            ],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ]);
    });
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await session.sendMessage("original prompt");

    expect(session.tree()).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "redacted prompt"
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "Done"
      })
    ]);
  });

  it("records compaction entries from completed session messages", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-1",
          tool: "read_file",
          args: { path: "README.md" }
        },
        {
          type: "tool.result",
          intentId: "call-1",
          result: "README content"
        },
        {
          type: "session.complete",
          result: {
            output: "Done",
            stdout: "Done",
            summary: "Done",
            messages: [
              {
                role: "system",
                name: "compaction",
                content: "Compacted context summary:\nEarlier context"
              },
              { role: "assistant", content: "Done" }
            ],
            toolCalls: [],
            exitCode: 0,
            stderr: ""
          }
        }
      ])
    );
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      cwd: "/workspace/project"
    });

    await session.sendMessage("Read README");

    expect(await session.tree()).toContainEqual(
      expect.objectContaining({
        kind: "compaction",
        summary: "Earlier context",
        readFiles: ["/workspace/project/README.md"],
        modifiedFiles: []
      })
    );
  });

  it("navigates to an earlier entry and resumes from that branch", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await session.sendMessage("first");
    const firstTree = await session.tree();
    const firstUser = firstTree.find((entry) => entry.kind === "user");
    expect(firstUser).toBeDefined();

    await session.navigateTo(firstUser!.id);
    await session.sendMessage("second");

    expect(acpMock).toHaveBeenLastCalledWith(
      "second",
      expect.objectContaining({
        resume: {
          messages: [{ role: "user", content: "first" }]
        }
      })
    );
    expect((await session.tree()).map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("forks from an existing entry into a new session", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await session.sendMessage("first");
    const fromEntry = (await session.tree()).find((entry) => entry.kind === "user");
    expect(fromEntry).toBeDefined();

    const fork = await session.fork(fromEntry!.id);

    expect(fork.id).not.toBe(session.id);
    expect((await fork.tree()).map((entry) => entry.kind)).toEqual(["user", "fork_marker"]);
    expect((await session.tree()).map((entry) => entry.kind)).toEqual([
      "user",
      "assistant",
      "branch_summary"
    ]);
  });

  it("forwards undefined apiKey to ACP when not provided", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5"
    });

    await session.sendMessage("hello");

    expect(acpMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        apiKey: undefined
      })
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
        model: "   "
      })
    ).rejects.toThrow("Missing model. Provide a non-empty model to createAgentSession.");
  });

  it("surfaces ACP API-key resolution errors during sendMessage", async () => {
    acpMock.mockRejectedValueOnce(
      new Error("Missing Poe API key. Provide apiKey or run 'poe-code login'.")
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({ model: "Claude-Sonnet-4.5" });

    await expect(session.sendMessage("hello")).rejects.toThrow(
      "Missing Poe API key. Provide apiKey or run 'poe-code login'."
    );
  });

  it("dispose blocks future sends and is idempotent", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5"
    });

    await session.dispose();
    await session.dispose();

    await expect(session.sendMessage("after dispose")).rejects.toThrow(
      "Agent session is already disposed."
    );
  });

  it("dispose cancels an in-flight send", async () => {
    let finishEvents: (() => void) | undefined;
    const disposeRun = vi.fn(async () => {
      finishEvents?.();
    });
    acpMock.mockResolvedValueOnce({
      events: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              await new Promise<void>((resolve) => {
                finishEvents = resolve;
              });
              return { done: true, value: undefined };
            }
          };
        }
      },
      acknowledge: vi.fn(),
      dispose: disposeRun
    });

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5"
    });
    const sending = session.sendMessage("keep working");
    await Promise.resolve();

    await session.dispose();

    await expect(sending).rejects.toThrow("Run ended without a terminal event.");
    expect(disposeRun).toHaveBeenCalled();
  });

  it("surfaces session.error and emits failed tool updates", async () => {
    acpMock.mockImplementationOnce(() =>
      createAcpSession([
        {
          type: "tool.intent",
          intentId: "call-2",
          tool: "run_command",
          args: { command: "ls" }
        },
        {
          type: "tool.error",
          intentId: "call-2",
          error: "command failed"
        },
        {
          type: "session.error",
          error: new Error("Maximum tool call iterations reached")
        }
      ])
    );

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      model: "Claude-Sonnet-4.5",
      apiKey: "test-key"
    });
    const updates: SessionUpdate[] = [];

    await expect(
      session.sendMessage("Run ls", {
        onSessionUpdate(update) {
          updates.push(update);
        }
      })
    ).rejects.toThrow("Maximum tool call iterations reached");

    expect(updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "run_command",
        kind: "execute",
        status: "pending",
        rawInput: { command: "ls" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        kind: "execute",
        status: "in_progress"
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-2",
        kind: "execute",
        status: "failed",
        rawOutput: "command failed"
      }
    ]);
  });
});
