import type { SpawnMode } from "@poe-code/agent-spawn";
import { describe, expect, it, vi } from "vitest";
import {
  createPreToolUseHookContext,
  createSessionStartHookContext,
  dispatchHook,
  type HookDispatchResult
} from "../runtime/hooks.js";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import { runPluginSetup } from "../runtime/plugin-setup.js";
import { createRunContext, type RunContext } from "../runtime/run-context.js";
import filesPlugin from "./poe-agent-plugin-files.js";
import mcpPlugin from "./poe-agent-plugin-mcp.js";
import shellPlugin from "./poe-agent-plugin-shell.js";
import policyPlugin, { spec as policyPluginSpec } from "./poe-agent-plugin-policy.js";
import spawnPlugin from "./poe-agent-plugin-spawn.js";

const mcpClientConnectMock = vi.hoisted(() => vi.fn(async () => undefined));
const mcpClientListToolsMock = vi.hoisted(() => vi.fn(async () => ({ tools: [] })));
const mcpClientCloseMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("tiny-mcp-client", () => ({
  StdioTransport: class {},
  McpClient: class {
    async connect(transport: unknown): Promise<void> {
      await mcpClientConnectMock(transport);
    }

    async listTools(params?: { cursor?: string }): Promise<{ tools: Array<Record<string, unknown>> }> {
      return mcpClientListToolsMock(params);
    }

    async close(): Promise<void> {
      await mcpClientCloseMock();
    }
  }
}));

async function setupRunContext(plugins: AgentPlugin[]): Promise<{
  runContext: RunContext;
  signal: AbortSignal;
}> {
  const runContext = createRunContext();
  const signal = new AbortController().signal;
  await runPluginSetup(plugins, runContext);
  await dispatchHook({
    registry: runContext.hooks,
    event: "sessionStart",
    ctx: createSessionStartHookContext({
      session: runContext.session,
      messages: runContext.messages,
      signal
    })
  });

  return {
    runContext,
    signal
  };
}

async function runPreToolUse(
  runContext: RunContext,
  signal: AbortSignal,
  tool: string,
  args: unknown,
  messages: RunContext["messages"] = runContext.messages
): Promise<HookDispatchResult> {
  return dispatchHook({
    registry: runContext.hooks,
    event: "preToolUse",
    ctx: createPreToolUseHookContext({
      tool,
      args,
      intentId: "intent-1",
      session: runContext.session,
      messages,
      signal
    })
  });
}

function expectToolError(result: HookDispatchResult, expectedText: string): void {
  expect(result.type).toBe("tool_error");
  if (result.type !== "tool_error") {
    return;
  }

  expect(result.error).toContain(expectedText);
}

describe("poe-agent-plugin-policy", () => {
  it("validates config options with its plugin spec", () => {
    expect(policyPluginSpec.parseOptions({ mode: "read" })).toEqual({ mode: "read" });
    expect(() => policyPluginSpec.parseOptions({ mode: "read-only" })).toThrow();
  });

  it("blocks mutating file tools in read mode while allowing read-only file tools", async () => {
    const { runContext, signal } = await setupRunContext([
      filesPlugin({ cwd: "/workspace/project" }),
      policyPlugin({ mode: "read" })
    ]);

    try {
      await expect(
        runPreToolUse(runContext, signal, "read_file", { path: "README.md" })
      ).resolves.toEqual({
        type: "continue"
      });

      const editResult = await runPreToolUse(runContext, signal, "edit_file", {
        command: "create",
        path: "README.md",
        file_text: "hello"
      });

      expectToolError(editResult, 'Tool "edit_file" is not allowed in read mode.');
    } finally {
      await runContext.dispose();
    }
  });

  it("allows read-only shell commands in read mode and rejects mutating ones", async () => {
    const { runContext, signal } = await setupRunContext([
      shellPlugin(),
      policyPlugin({ mode: "read" })
    ]);

    try {
      await expect(
        runPreToolUse(runContext, signal, "run_command", { command: "git status --short" })
      ).resolves.toEqual({ type: "continue" });

      const mkdirResult = await runPreToolUse(runContext, signal, "run_command", {
        command: "mkdir tmp"
      });

      expectToolError(mkdirResult, "read mode");
    } finally {
      await runContext.dispose();
    }
  });

  it("allows safe shell in edit mode while blocking destructive commands and network writes", async () => {
    const { runContext, signal } = await setupRunContext([
      shellPlugin(),
      policyPlugin({ mode: "edit" })
    ]);

    try {
      await expect(
        runPreToolUse(runContext, signal, "run_command", { command: "npm test" })
      ).resolves.toEqual({ type: "continue" });

      expectToolError(
        await runPreToolUse(runContext, signal, "run_command", { command: "rm -rf /tmp/demo" }),
        "rm -rf"
      );
      expectToolError(
        await runPreToolUse(runContext, signal, "run_command", {
          command: "git push origin main"
        }),
        "git push"
      );
      expectToolError(
        await runPreToolUse(runContext, signal, "run_command", {
          command: "curl -X POST https://example.com"
        }),
        "network write"
      );
    } finally {
      await runContext.dispose();
    }
  });

  it.each(["read", "edit"] as const)(
    "allows spawn in %s mode so child sessions can inherit the same policy mode",
    async (mode) => {
      const { runContext, signal } = await setupRunContext([
        spawnPlugin(),
        policyPlugin({ mode })
      ]);

      try {
        await expect(
          runPreToolUse(runContext, signal, "spawn", { task: "Investigate the regression" })
        ).resolves.toEqual({ type: "continue" });
      } finally {
        await runContext.dispose();
      }
    }
  );

  it("reads mode once at session start and keeps sessions isolated", async () => {
    const mode = { current: "read" as SpawnMode };
    const plugin = policyPlugin({ mode: () => mode.current });

    const first = await setupRunContext([filesPlugin({ cwd: "/workspace/project" }), plugin]);

    try {
      mode.current = "yolo";
      expectToolError(
        await runPreToolUse(first.runContext, first.signal, "edit_file", {
          command: "create",
          path: "README.md",
          file_text: "hello"
        }),
        'Tool "edit_file" is not allowed in read mode.'
      );
    } finally {
      await first.runContext.dispose();
    }

    const second = await setupRunContext([filesPlugin({ cwd: "/workspace/project" }), plugin]);

    try {
      await expect(
        runPreToolUse(second.runContext, second.signal, "edit_file", {
          command: "create",
          path: "README.md",
          file_text: "hello"
        })
      ).resolves.toEqual({ type: "continue" });
    } finally {
      await second.runContext.dispose();
    }
  });

  it("reads the resolved mode from session during preToolUse instead of message-array identity", async () => {
    const { runContext, signal } = await setupRunContext([
      filesPlugin({ cwd: "/workspace/project" }),
      policyPlugin({ mode: "read" })
    ]);

    try {
      expectToolError(
        await runPreToolUse(
          runContext,
          signal,
          "edit_file",
          {
            command: "create",
            path: "README.md",
            file_text: "hello"
          },
          [...runContext.messages]
        ),
        'Tool "edit_file" is not allowed in read mode.'
      );
    } finally {
      await runContext.dispose();
    }
  });

  it("blocks tools without policy metadata outside yolo even when registered after the policy plugin", async () => {
    const customPlugin: AgentPlugin = {
      name: "custom-tools",
      tools: [
        {
          name: "custom_tool",
          call: () => "ok"
        }
      ]
    };

    const readRun = await setupRunContext([policyPlugin({ mode: "read" }), customPlugin]);

    try {
      expectToolError(
        await runPreToolUse(readRun.runContext, readRun.signal, "custom_tool", {}),
        "does not declare policy metadata"
      );
    } finally {
      await readRun.runContext.dispose();
    }

    const yoloRun = await setupRunContext([policyPlugin({ mode: "yolo" }), customPlugin]);

    try {
      await expect(
        runPreToolUse(yoloRun.runContext, yoloRun.signal, "custom_tool", {})
      ).resolves.toEqual({
        type: "continue"
      });
    } finally {
      await yoloRun.runContext.dispose();
    }
  });

  it("allows discovered MCP tools in edit mode even when policy is registered first", async () => {
    const repoSearchToolName = ["repo", "search"].join("_");

    mcpClientConnectMock.mockReset();
    mcpClientListToolsMock.mockReset();
    mcpClientCloseMock.mockReset();

    mcpClientConnectMock.mockResolvedValue(undefined);
    mcpClientCloseMock.mockResolvedValue(undefined);
    mcpClientListToolsMock.mockResolvedValue({
      tools: [
        {
          name: "search",
          description: "Search repository",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      ]
    });

    const { runContext, signal } = await setupRunContext([
      policyPlugin({ mode: "edit" }),
      mcpPlugin({
        name: "repo",
        command: "node",
        args: ["server.js"]
      })
    ]);

    try {
      await expect(runPreToolUse(runContext, signal, repoSearchToolName, {})).resolves.toEqual({
        type: "continue"
      });
    } finally {
      await runContext.dispose();
    }
  });
});
