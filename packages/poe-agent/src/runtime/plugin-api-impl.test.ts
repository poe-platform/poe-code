import { afterAll, afterEach, beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { ToolContext } from "./types.js";
import { PluginApiImpl } from "./plugin-api-impl.js";
import { createRunContext } from "./run-context.js";

const stdioTransportConstructorMock = vi.fn();
const mcpClientConstructorMock = vi.fn();
const mcpClientConnectMock = vi.fn<(transport: unknown) => Promise<void>>();
const mcpClientListToolsMock = vi.fn<(params?: { cursor?: string }) => Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>>();
const mcpClientCallToolMock = vi.fn<
  (
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>
>();
const mcpClientCloseMock = vi.fn<() => Promise<void>>();

vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {
    constructor(options: unknown) {
      stdioTransportConstructorMock(options);
    }
  },
  McpClient: class {
    constructor(options: unknown) {
      mcpClientConstructorMock(options);
    }

    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }

    async listTools(params?: { cursor?: string }): Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }> {
      return mcpClientListToolsMock(params);
    }

    async callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      options?: { signal?: AbortSignal },
    ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
      return mcpClientCallToolMock(params, options);
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  },
}));

function createToolContext(): ToolContext {
  return {
    fork: async () => ({ output: "", messages: [] }),
    spawn: async () => ({ output: "", messages: [] }),
    signal: new AbortController().signal,
  };
}

describe("PluginApiImpl", () => {
  const originalCollisionEnv = process.env.POE_AGENT_MCP_ENV_COLLISION;
  const originalBaseEnv = process.env.POE_AGENT_MCP_ENV_BASE;

  beforeEach(() => {
    stdioTransportConstructorMock.mockReset();
    mcpClientConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCallToolMock.mockReset();
    mcpClientCloseMock.mockReset();

    mcpClientConnectMock.mockResolvedValue(undefined);
    mcpClientCloseMock.mockResolvedValue(undefined);

    process.env.POE_AGENT_MCP_ENV_COLLISION = "from-process";
    process.env.POE_AGENT_MCP_ENV_BASE = "from-process";
  });

  afterEach(() => {
    if (originalCollisionEnv === undefined) {
      delete process.env.POE_AGENT_MCP_ENV_COLLISION;
    } else {
      process.env.POE_AGENT_MCP_ENV_COLLISION = originalCollisionEnv;
    }

    if (originalBaseEnv === undefined) {
      delete process.env.POE_AGENT_MCP_ENV_BASE;
    } else {
      process.env.POE_AGENT_MCP_ENV_BASE = originalBaseEnv;
    }
  });

  afterAll(() => {
    mock.restore();
  });

  it("adds regular tools through the run context registry", () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);

    api.addTool({
      name: "custom.tool",
      call: () => "ok",
    });

    expect(context.tools.get("custom.tool")?.name).toBe("custom.tool");
  });

  it("creates stdio MCP transport, discovers tools during setup, and namespaces them", async () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);

    mcpClientListToolsMock.mockResolvedValueOnce({
      tools: [
        {
          name: "search",
          description: "Search docs",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
      nextCursor: "page-2",
    });
    mcpClientListToolsMock.mockResolvedValueOnce({
      tools: [
        {
          name: "status",
          description: "Status",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    });
    mcpClientCallToolMock.mockResolvedValue({
      content: [{ type: "text", text: "mcp-result" }],
    });

    api.addMcp({
      name: "repo",
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
      visibility: "skill",
    });

    await api.flushSetup();

    expect(stdioTransportConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        args: ["server.js"],
        env: expect.objectContaining({ NODE_ENV: "test" }),
      }),
    );
    expect(mcpClientConstructorMock).toHaveBeenCalledWith({
      clientInfo: { name: "poe-agent", version: "0.0.1" },
    });
    expect(mcpClientConnectMock).toHaveBeenCalledTimes(1);
    expect(mcpClientListToolsMock).toHaveBeenNthCalledWith(1, undefined);
    expect(mcpClientListToolsMock).toHaveBeenNthCalledWith(2, { cursor: "page-2" });

    expect(context.tools.get("repo.search")?.visibility).toBe("skill");
    expect(context.tools.get("repo.status")?.visibility).toBe("skill");

    const toolContext = createToolContext();
    const invocation = context.tools.get("repo.search")?.invoke({ query: "errors" }, toolContext);
    await expect(invocation?.next()).resolves.toEqual({
      done: true,
      value: "mcp-result",
    });
    expect(mcpClientCallToolMock).toHaveBeenCalledWith(
      {
        name: "search",
        arguments: { query: "errors" },
      },
      {
        signal: toolContext.signal,
      },
    );

    await context.dispose();
    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
  });

  it("registers MCP client disposal even when connect fails", async () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);
    const connectError = new Error("connect failed");

    mcpClientConnectMock.mockRejectedValueOnce(connectError);

    api.addMcp({
      name: "repo",
      command: "node",
      args: ["server.js"],
    });

    await expect(api.flushSetup()).rejects.toBe(connectError);

    await context.dispose();

    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
    expect(mcpClientListToolsMock).not.toHaveBeenCalled();
  });

  it("passes tool context signal to MCP callTool", async () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);
    const signalController = new AbortController();

    mcpClientListToolsMock.mockResolvedValueOnce({
      tools: [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ],
    });
    mcpClientCallToolMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    api.addMcp({
      name: "repo",
      command: "node",
      args: ["server.js"],
    });
    await api.flushSetup();

    const invocation = context.tools.get("repo.search")?.invoke(
      { query: "errors" },
      {
        fork: async () => ({ output: "", messages: [] }),
        spawn: async () => ({ output: "", messages: [] }),
        signal: signalController.signal,
      },
    );
    await expect(invocation?.next()).resolves.toEqual({
      done: true,
      value: "ok",
    });

    expect(mcpClientCallToolMock).toHaveBeenCalledWith(
      {
        name: "search",
        arguments: { query: "errors" },
      },
      {
        signal: signalController.signal,
      },
    );
  });

  it("merges process env with MCP env overrides", async () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);

    mcpClientListToolsMock.mockResolvedValueOnce({ tools: [] });

    api.addMcp({
      name: "repo",
      command: "node",
      env: {
        POE_AGENT_MCP_ENV_COLLISION: "from-plugin",
        POE_AGENT_MCP_ENV_PLUGIN_ONLY: "plugin-only",
      },
    });

    await api.flushSetup();

    expect(stdioTransportConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "node",
        env: expect.objectContaining({
          POE_AGENT_MCP_ENV_BASE: "from-process",
          POE_AGENT_MCP_ENV_COLLISION: "from-plugin",
          POE_AGENT_MCP_ENV_PLUGIN_ONLY: "plugin-only",
        }),
      }),
    );
  });
});
