import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSetupError } from "./errors.js";
import { createPreToolUseHookContext } from "./hooks.js";
import { runPluginSetup } from "./plugin-setup.js";
import { createRunContext } from "./run-context.js";

const stdioTransportConstructorMock = vi.hoisted(() => vi.fn());
const mcpClientConnectMock = vi.hoisted(() => vi.fn<(transport: unknown) => Promise<void>>());
const mcpClientListToolsMock = vi.hoisted(
  () => vi.fn<(params?: { cursor?: string }) => Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>>(),
);
const mcpClientCloseMock = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {
    constructor(options: unknown) {
      stdioTransportConstructorMock(options);
    }
  },
  McpClient: class {
    constructor() {}

    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }

    async listTools(params?: { cursor?: string }): Promise<{ tools: Array<Record<string, unknown>>; nextCursor?: string }> {
      return mcpClientListToolsMock(params);
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  },
}));

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
