import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUpdate } from "@poe-code/agent-spawn";
import type { Tool } from "./chat.js";

const createAuthStoreMock = vi.hoisted(() => vi.fn());
const getApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

const loadSystemPromptMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

const toolExecutorConstructorMock = vi.hoisted(() => vi.fn());
const getAvailableToolsMock = vi.hoisted(() => vi.fn<() => Tool[]>());
const toolExecutorDisposeMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

const chatConstructorMock = vi.hoisted(() => vi.fn());
const chatSendMessageMock = vi.hoisted(
  () => vi.fn<(prompt: string, options?: unknown) => Promise<{ role: "assistant"; content: string }>>(),
);
const chatClearConversationHistoryMock = vi.hoisted(() => vi.fn());
const chatSetToolCallCallbackMock = vi.hoisted(() => vi.fn());
const toolCallCallbackRef = vi.hoisted(() => ({
  current: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock("@poe-code/auth", () => ({
  createAuthStore: createAuthStoreMock,
}));

vi.mock("./system-prompt.js", () => ({
  loadSystemPrompt: loadSystemPromptMock,
}));

vi.mock("./tool-executor.js", () => ({
  DefaultToolExecutor: class {
    constructor(options: unknown) {
      toolExecutorConstructorMock(options);
    }

    getAvailableTools(): Tool[] {
      return getAvailableToolsMock();
    }

    async dispose(): Promise<void> {
      await toolExecutorDisposeMock();
    }
  },
}));

vi.mock("./chat.js", () => ({
  PoeChatService: class {
    constructor(options: { onToolCall?: (event: unknown) => void }) {
      chatConstructorMock(options);
      toolCallCallbackRef.current = options.onToolCall;
    }

    async sendMessage(
      prompt: string,
      options?: unknown,
    ): Promise<{
      role: "assistant";
      content: string;
    }> {
      return chatSendMessageMock(prompt, options);
    }

    setToolCallCallback(callback: (event: unknown) => void): void {
      toolCallCallbackRef.current = callback;
      chatSetToolCallCallbackMock(callback);
    }

    clearConversationHistory(): void {
      chatClearConversationHistoryMock();
    }
  },
}));

const availableTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
          },
        },
        required: ["path"],
      },
    },
  },
];

describe("createAgentSession", () => {
  beforeEach(() => {
    createAuthStoreMock.mockReset();
    getApiKeyMock.mockReset();
    loadSystemPromptMock.mockReset();
    toolExecutorConstructorMock.mockReset();
    getAvailableToolsMock.mockReset();
    toolExecutorDisposeMock.mockReset();
    chatConstructorMock.mockReset();
    chatSendMessageMock.mockReset();
    chatClearConversationHistoryMock.mockReset();
    chatSetToolCallCallbackMock.mockReset();
    toolCallCallbackRef.current = undefined;

    getApiKeyMock.mockResolvedValue("stored-api-key");
    createAuthStoreMock.mockReturnValue({
      backend: "file",
      store: {
        getApiKey: getApiKeyMock,
      },
    });

    loadSystemPromptMock.mockResolvedValue("system prompt content");
    getAvailableToolsMock.mockReturnValue(availableTools);
    chatSendMessageMock.mockResolvedValue({ role: "assistant", content: "done" });
  });

  it("exports createAgentSession from package entrypoint", async () => {
    const poeAgent = await import("./index.js");

    expect(poeAgent.createAgentSession).toBeTypeOf("function");
  });

  it("wires tool executor, chat service, and system prompt", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "  explicit-key  ",
      model: "Claude-Sonnet-4.5",
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    const signal = new AbortController().signal;
    const response = await session.sendMessage("hello", { signal });

    expect(response).toEqual({ role: "assistant", content: "done" });
    expect(createAuthStoreMock).not.toHaveBeenCalled();
    expect(loadSystemPromptMock).toHaveBeenCalledTimes(1);
    expect(toolExecutorConstructorMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    expect(chatConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "explicit-key",
        model: "Claude-Sonnet-4.5",
        systemPrompt: "system prompt content",
        toolExecutor: expect.any(Object),
      }),
    );

    expect(chatSendMessageMock).toHaveBeenCalledWith("hello", {
      signal,
      tools: availableTools,
    });

    expect(Object.keys(session).sort()).toEqual(["dispose", "sendMessage"]);
  });

  it("resolves api key from @poe-code/auth when not provided", async () => {
    const { createAgentSession } = await import("./agent-session.js");

    await createAgentSession({ model: "Claude-Sonnet-4.5" });

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(getApiKeyMock).toHaveBeenCalledTimes(1);
    expect(chatConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "stored-api-key" }),
    );
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

  it("throws clear error when API key is missing everywhere", async () => {
    getApiKeyMock.mockResolvedValueOnce("   ");

    const { createAgentSession } = await import("./agent-session.js");

    await expect(createAgentSession({ model: "Claude-Sonnet-4.5" })).rejects.toThrow(
      "Missing Poe API key. Provide apiKey or run 'poe-code login'.",
    );
  });

  it("dispose releases resources and blocks future sends", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
    });

    await session.dispose();

    expect(chatClearConversationHistoryMock).toHaveBeenCalledTimes(1);
    expect(toolExecutorDisposeMock).toHaveBeenCalledTimes(1);

    await expect(session.sendMessage("after dispose")).rejects.toThrow(
      "Agent session is already disposed.",
    );
  });

  it("emits ACP sessionUpdate events for tool lifecycle and assistant message", async () => {
    chatSendMessageMock.mockImplementationOnce(async () => {
      toolCallCallbackRef.current?.({
        phase: "started",
        toolCallId: "call-1",
        toolName: "read_file",
        args: { path: "README.md" },
      });
      toolCallCallbackRef.current?.({
        phase: "completed",
        toolCallId: "call-1",
        toolName: "read_file",
        args: { path: "README.md" },
        result: "README content",
      });

      return {
        role: "assistant",
        content: "Done",
      };
    });

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
    });
    const updates: SessionUpdate[] = [];

    await session.sendMessage("Read the README", {
      onSessionUpdate(update) {
        updates.push(update);
      },
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

  it("emits failed tool_call_update event when tool execution fails", async () => {
    chatSendMessageMock.mockImplementationOnce(async () => {
      toolCallCallbackRef.current?.({
        phase: "started",
        toolCallId: "call-2",
        toolName: "run_command",
        args: { command: "ls" },
      });
      toolCallCallbackRef.current?.({
        phase: "failed",
        toolCallId: "call-2",
        toolName: "run_command",
        args: { command: "ls" },
        error: "command failed",
      });

      return {
        role: "assistant",
        content: "I could not run that.",
      };
    });

    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
    });
    const updates: SessionUpdate[] = [];

    await session.sendMessage("Run ls", {
      onSessionUpdate(update) {
        updates.push(update);
      },
    });

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
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "I could not run that.",
        },
      },
    ]);
  });
});
