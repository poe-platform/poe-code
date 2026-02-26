import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUpdate } from "@poe-code/agent-spawn";
import type { Tool } from "./chat.js";

const createAuthStoreMock = vi.hoisted(() => vi.fn());
const getApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

const loadSystemPromptMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

const toolExecutorConstructorMock = vi.hoisted(() => vi.fn());
const getAvailableToolsMock = vi.hoisted(() => vi.fn<() => Tool[]>());
const toolExecutorExecuteToolMock = vi.hoisted(
  () => vi.fn<(name: string, args: Record<string, unknown>) => Promise<string>>(),
);
const toolExecutorDisposeMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

const mcpToolExecutorConstructorMock = vi.hoisted(() => vi.fn());
const mcpToolExecutorAddServerMock = vi.hoisted(
  () => vi.fn<(serverName: string, client: unknown) => Promise<void>>(),
);
const mcpToolExecutorGetAvailableToolsMock = vi.hoisted(() => vi.fn<() => Tool[]>());
const mcpToolExecutorExecuteToolMock = vi.hoisted(
  () => vi.fn<(name: string, args: Record<string, unknown>) => Promise<string>>(),
);
const mcpToolExecutorDisposeMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

const mcpClientConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(
  () => vi.fn<(transport: unknown) => Promise<unknown>>(),
);
const stdioTransportConstructorMock = vi.hoisted(() => vi.fn());
const httpTransportConstructorMock = vi.hoisted(() => vi.fn());

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

    async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
      return toolExecutorExecuteToolMock(name, args);
    }

    async dispose(): Promise<void> {
      await toolExecutorDisposeMock();
    }
  },
}));

vi.mock("./mcp-tool-executor.js", () => ({
  McpToolExecutor: class {
    constructor() {
      mcpToolExecutorConstructorMock();
    }

    async addServer(serverName: string, client: unknown): Promise<void> {
      await mcpToolExecutorAddServerMock(serverName, client);
    }

    getAvailableTools(): Tool[] {
      return mcpToolExecutorGetAvailableToolsMock();
    }

    async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
      return mcpToolExecutorExecuteToolMock(name, args);
    }

    async dispose(): Promise<void> {
      await mcpToolExecutorDisposeMock();
    }
  },
}));

vi.mock("tiny-mcp-client", () => ({
  McpClient: class {
    constructor(options: unknown) {
      mcpClientConstructorMock(options);
    }

    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }
  },
  StdioTransport: class {
    readonly transportType = "stdio";

    constructor(options: unknown) {
      stdioTransportConstructorMock(options);
    }
  },
  HttpTransport: class {
    readonly transportType = "http";

    constructor(options: unknown) {
      httpTransportConstructorMock(options);
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

const mcpAvailableTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "mcp__test-server__word_of_the_day",
      description: "Word of the day",
      parameters: {
        type: "object",
        properties: {},
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
    toolExecutorExecuteToolMock.mockReset();
    toolExecutorDisposeMock.mockReset();
    mcpToolExecutorConstructorMock.mockReset();
    mcpToolExecutorAddServerMock.mockReset();
    mcpToolExecutorGetAvailableToolsMock.mockReset();
    mcpToolExecutorExecuteToolMock.mockReset();
    mcpToolExecutorDisposeMock.mockReset();
    mcpClientConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    stdioTransportConstructorMock.mockReset();
    httpTransportConstructorMock.mockReset();
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
    toolExecutorExecuteToolMock.mockResolvedValue("builtin-result");
    mcpToolExecutorGetAvailableToolsMock.mockReturnValue(mcpAvailableTools);
    mcpToolExecutorExecuteToolMock.mockResolvedValue("mcp-result");
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

  it("keeps built-in only behavior when mcpServers is undefined", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    await session.sendMessage("hello");

    expect(toolExecutorConstructorMock).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });
    expect(chatSendMessageMock).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({ tools: availableTools }),
    );
    expect(mcpToolExecutorConstructorMock).not.toHaveBeenCalled();
  });

  it("creates and initializes McpToolExecutor, merges tools, and builds transports", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
      mcpServers: {
        "test-server": {
          transport: "stdio",
          command: "tiny-stdio-mcp-test-server",
          args: ["serve", "word-of-the-day"],
          env: { FOO: "bar" },
        },
        "http-server": {
          transport: "http",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer token",
          },
        },
      },
    });

    await session.sendMessage("hello");

    expect(mcpToolExecutorConstructorMock).toHaveBeenCalledTimes(1);
    expect(mcpClientConstructorMock).toHaveBeenCalledTimes(2);
    expect(stdioTransportConstructorMock).toHaveBeenCalledWith({
      command: "tiny-stdio-mcp-test-server",
      args: ["serve", "word-of-the-day"],
      env: { FOO: "bar" },
    });
    expect(httpTransportConstructorMock).toHaveBeenCalledWith({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer token",
      },
    });
    expect(mcpClientConnectMock).toHaveBeenCalledTimes(2);
    expect(mcpToolExecutorAddServerMock).toHaveBeenCalledTimes(2);
    expect(mcpToolExecutorAddServerMock).toHaveBeenNthCalledWith(1, "test-server", expect.any(Object));
    expect(mcpToolExecutorAddServerMock).toHaveBeenNthCalledWith(2, "http-server", expect.any(Object));
    expect(chatSendMessageMock).toHaveBeenCalledWith("hello", {
      tools: [...availableTools, ...mcpAvailableTools],
      signal: undefined,
    });
  });

  it("routes built-in tools to DefaultToolExecutor and MCP tools to McpToolExecutor", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
      mcpServers: {
        "test-server": {
          transport: "stdio",
          command: "tiny-stdio-mcp-test-server",
        },
      },
    });
    const chatOptions = chatConstructorMock.mock.calls[0]?.[0] as {
      toolExecutor: {
        executeTool(name: string, args: Record<string, unknown>): Promise<string>;
      };
    };

    await expect(chatOptions.toolExecutor.executeTool("read_file", { path: "README.md" })).resolves.toBe(
      "builtin-result",
    );
    await expect(
      chatOptions.toolExecutor.executeTool("mcp__test-server__word_of_the_day", {}),
    ).resolves.toBe("mcp-result");
    expect(toolExecutorExecuteToolMock).toHaveBeenCalledWith("read_file", {
      path: "README.md",
    });
    expect(mcpToolExecutorExecuteToolMock).toHaveBeenCalledWith(
      "mcp__test-server__word_of_the_day",
      {},
    );
  });

  it("cleans up already-connected MCP servers when connect fails", async () => {
    mcpClientConnectMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("connect failed"));

    const { createAgentSession } = await import("./agent-session.js");

    await expect(
      createAgentSession({
        apiKey: "provided-api-key",
        model: "Claude-Sonnet-4.5",
        mcpServers: {
          "test-server": {
            transport: "stdio",
            command: "tiny-stdio-mcp-test-server",
          },
          "second-server": {
            transport: "stdio",
            command: "tiny-stdio-mcp-test-server",
          },
        },
      }),
    ).rejects.toThrow("connect failed");

    expect(mcpToolExecutorAddServerMock).toHaveBeenCalledTimes(1);
    expect(mcpToolExecutorAddServerMock).toHaveBeenCalledWith("test-server", expect.any(Object));
    expect(mcpToolExecutorDisposeMock).toHaveBeenCalledTimes(1);
  });

  it("dispose calls McpToolExecutor.dispose when MCP is configured", async () => {
    const { createAgentSession } = await import("./agent-session.js");
    const session = await createAgentSession({
      apiKey: "provided-api-key",
      model: "Claude-Sonnet-4.5",
      mcpServers: {
        "test-server": {
          transport: "stdio",
          command: "tiny-stdio-mcp-test-server",
        },
      },
    });

    await session.dispose();

    expect(mcpToolExecutorDisposeMock).toHaveBeenCalledTimes(1);
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
