import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./types.js";
import { PluginApiImpl } from "./plugin-api-impl.js";
import { PluginSetupError } from "./errors.js";
import { createPreToolUseHookContext } from "./hooks.js";
import { runPluginSetup } from "./plugin-setup.js";
import { createRunContext } from "./run-context.js";

const stdioTransportConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(() => vi.fn<(transport: unknown) => Promise<void>>());
const mcpClientListToolsMock = vi.hoisted(
  () => vi.fn<(params?: { cursor?: string }) => Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>>(),
);
const mcpClientCallToolMock = vi.hoisted(
  () =>
    vi.fn<
      (
        params: { name: string; arguments?: Record<string, unknown> },
        options?: { signal?: AbortSignal },
      ) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>
    >(),
);
const mcpClientCloseMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

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

    expect(context.mcpServers).toEqual([
      {
        name: "repo",
        command: "node",
        args: ["server.js"],
        env: { NODE_ENV: "test" },
        visibility: "skill",
      },
    ]);

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
    expect(context.tools.get("repo.search")?.policy).toEqual({
      read: false,
      edit: true,
    });
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

  it("preserves MCP multimodal content and structured errors", async () => {
    const context = createRunContext();
    const api = new PluginApiImpl(context);

    mcpClientListToolsMock.mockResolvedValueOnce({
      tools: [
        {
          name: "inspect",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ],
    });
    mcpClientCallToolMock
      .mockResolvedValueOnce({
        content: [
          { type: "text", text: "Screenshot captured" },
          { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
        ],
      })
      .mockResolvedValueOnce({
        isError: true,
        content: [{ type: "text", text: "MCP rejected the request" }],
      });

    api.addMcp({
      name: "repo",
      command: "node",
      args: ["server.js"],
    });
    await api.flushSetup();

    const tool = context.tools.get("repo.inspect");
    const successInvocation = tool?.invoke({ query: "diagram" }, createToolContext());
    await expect(successInvocation?.next()).resolves.toEqual({
      done: true,
      value: [
        { type: "text", text: "Screenshot captured" },
        { type: "image", mimeType: "image/png", data: "YmFzZTY0LWltYWdl" },
      ],
    });

    const errorInvocation = tool?.invoke({ query: "broken" }, createToolContext());
    await expect(errorInvocation?.next()).resolves.toEqual({
      done: true,
      value: {
        type: "error",
        code: "mcp_tool_error",
        message: "MCP rejected the request",
        retriable: false,
      },
    });
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

// === plugin-setup.test.ts ===

describe("runPluginSetup", () => {
  beforeEach(() => {
    stdioTransportConstructorMock.mockReset();
    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCloseMock.mockReset();

    mcpClientConnectMock.mockResolvedValue(undefined);
    mcpClientCloseMock.mockResolvedValue(undefined);
  });

  it("runs plugin setup in registration order and registers static declarations first", async () => {
    const context = createRunContext();
    const setupOrder: string[] = [];
    const hookOrder: string[] = [];
    let staticToolVisibleDuringSetup = false;

    const plugins = [
      {
        name: "alpha",
        tools: [
          {
            name: "alpha.static",
            call: () => "alpha-static",
          },
        ],
        prompt(ctx) {
          return {
            ...ctx,
            system: ctx.system ? `${ctx.system}|alpha` : "alpha",
          };
        },
        hooks: {
          preToolUse() {
            hookOrder.push("alpha");
          },
        },
        setup(api) {
          setupOrder.push("alpha");
          staticToolVisibleDuringSetup = context.tools.get("alpha.static") !== undefined;
          api.addTool({
            name: "alpha.dynamic",
            call: () => "alpha-dynamic",
          });
        },
      },
      {
        name: "beta",
        prompt(ctx) {
          return {
            ...ctx,
            system: ctx.system ? `${ctx.system}|beta` : "beta",
          };
        },
        hooks: {
          preToolUse() {
            hookOrder.push("beta");
          },
        },
        setup() {
          setupOrder.push("beta");
        },
      },
    ];

    await runPluginSetup(plugins, context);

    expect(setupOrder).toEqual(["alpha", "beta"]);
    expect(staticToolVisibleDuringSetup).toBe(true);
    expect(context.tools.get("alpha.static")?.name).toBe("alpha.static");
    expect(context.tools.get("alpha.dynamic")?.name).toBe("alpha.dynamic");

    const compiled = await context.prompts.compile("run", "base");
    expect(compiled.system).toBe("base|alpha|beta");

    await context.hooks.run(
      "preToolUse",
      createPreToolUseHookContext({
        tool: "alpha.static",
        args: {},
        intentId: "intent-1",
        session: new Map(),
        messages: [],
        signal: new AbortController().signal,
      }),
    );
    expect(hookOrder).toEqual(["alpha", "beta"]);
  });

  it("wraps setup failures in PluginSetupError and disposes already-setup plugins in reverse", async () => {
    const context = createRunContext();
    const disposeOrder: string[] = [];
    const firstDispose = vi.fn(() => {
      disposeOrder.push("first");
    });
    const secondDispose = vi.fn(() => {
      disposeOrder.push("second");
    });
    const setupCause = new Error("boom");

    const plugins = [
      {
        name: "first",
        setup() {},
        dispose: firstDispose,
      },
      {
        name: "second",
        setup() {},
        dispose: secondDispose,
      },
      {
        name: "failing",
        setup() {
          throw setupCause;
        },
      },
    ];

    await expect(runPluginSetup(plugins, context)).rejects.toEqual(
      expect.objectContaining({
        name: "PluginSetupError",
        pluginName: "failing",
        cause: setupCause,
      }),
    );

    expect(disposeOrder).toEqual(["second", "first"]);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);

    await context.dispose();
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("throws PluginSetupError instances", async () => {
    const context = createRunContext();

    await expect(
      runPluginSetup(
        [
          {
            name: "broken",
            setup() {
              throw new Error("broken setup");
            },
          },
        ],
        context,
      ),
    ).rejects.toBeInstanceOf(PluginSetupError);
  });

  it("includes disposal failures when setup fails", async () => {
    const context = createRunContext();
    const setupCause = new Error("setup exploded");
    const disposeCause = new Error("dispose exploded");

    const result = await runPluginSetup(
      [
        {
          name: "ok",
          setup() {},
          dispose() {
            throw disposeCause;
          },
        },
        {
          name: "broken",
          setup() {
            throw setupCause;
          },
        },
      ],
      context,
    ).then(
      () => ({ ok: true as const }),
      error => ({ ok: false as const, error }),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        name: "PluginSetupError",
        pluginName: "broken",
        cause: expect.objectContaining({
          name: "AggregateError",
          errors: [setupCause, expect.any(AggregateError)],
        }),
      }),
    });
  });

  it("waits for queued addMcp setup before disposal when plugin setup throws", async () => {
    const context = createRunContext();
    const setupCause = new Error("setup failed");
    let resolveListTools:
      | ((value: { tools: Array<Record<string, unknown>>; nextCursor?: string }) => void)
      | undefined;

    mcpClientListToolsMock.mockImplementation(
      () =>
        new Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>(resolve => {
          resolveListTools = resolve;
        }),
    );

    const setupResultPromise = runPluginSetup(
      [
        {
          name: "mcp-failing",
          setup(api) {
            api.addMcp({
              name: "repo",
              command: "node",
              args: ["server.js"],
            });
            throw setupCause;
          },
        },
      ],
      context,
    ).then(
      () => ({ ok: true as const }),
      error => ({ ok: false as const, error }),
    );

    await vi.waitFor(() => {
      expect(mcpClientListToolsMock).toHaveBeenCalledTimes(1);
    });

    resolveListTools?.({ tools: [] });

    const setupResult = await setupResultPromise;
    expect(setupResult).toEqual({
      ok: false,
      error: expect.objectContaining({
        name: "PluginSetupError",
        pluginName: "mcp-failing",
        cause: setupCause,
      }),
    });
    expect(stdioTransportConstructorMock).toHaveBeenCalledTimes(1);
    expect(mcpClientCloseMock).toHaveBeenCalledTimes(1);
  });
});
