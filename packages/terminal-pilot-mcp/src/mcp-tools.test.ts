import { describe, expect, it } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { createMCPServer } from "toolcraft/mcp";
import { createTerminalPilotMCPGroup } from "./index.js";
import type { TerminalPilotRuntime } from "terminal-pilot/commands";

const EXPECTED_TOOL_NAMES = [
  "create_session",
  "fill",
  "type",
  "press_key",
  "send_signal",
  "wait_for",
  "wait_for_exit",
  "read_screen",
  "read_history",
  "resize",
  "close_session",
  "get_session",
  "list_sessions",
  "terminal_create_session",
  "terminal_fill",
  "terminal_type",
  "terminal_press_key",
  "terminal_send_signal",
  "terminal_wait_for",
  "terminal_wait_for_exit",
  "terminal_read_screen",
  "terminal_read_history",
  "terminal_resize",
  "terminal_close_session",
  "terminal_get_session",
  "terminal_list_sessions"
];

const runtime: TerminalPilotRuntime = {
  createSession: async (params) => ({
    name: params.session ?? "s1",
    session: {
      id: "session-1",
      command: params.command,
      pid: 1234,
      exitCode: null,
      fill: async () => undefined,
      type: async () => undefined,
      press: async () => undefined,
      signal: async () => undefined,
      waitFor: async () => "matched output",
      waitForExit: async () => 0,
      screen: async () => ({
        lines: ["ready"],
        cursor: { row: 0, col: 5 },
        size: { rows: 24, cols: 80 }
      }),
      history: async () => ["ready"],
      resize: async () => undefined,
      close: async () => 0
    }
  }),
  resolveSession: async () => ({
    name: "s1",
    session: {
      id: "session-1",
      command: "bash",
      pid: 1234,
      exitCode: null,
      fill: async () => undefined,
      type: async () => undefined,
      press: async () => undefined,
      signal: async () => undefined,
      waitFor: async () => "matched output",
      waitForExit: async () => 0,
      screen: async () => ({
        lines: ["ready"],
        cursor: { row: 0, col: 5 },
        size: { rows: 24, cols: 80 }
      }),
      history: async () => ["ready"],
      resize: async () => undefined,
      close: async () => 0
    }
  }),
  closeSession: async () => ({ exitCode: 0, name: "s1" }),
  listSessions: async () => [
    {
      name: "s1",
      session: {
        id: "session-1",
        command: "bash",
        pid: 1234,
        exitCode: null,
        fill: async () => undefined,
        type: async () => undefined,
        press: async () => undefined,
        signal: async () => undefined,
        waitFor: async () => "matched output",
        waitForExit: async () => 0,
        screen: async () => ({
          lines: ["ready"],
          cursor: { row: 0, col: 5 },
          size: { rows: 24, cols: 80 }
        }),
        history: async () => ["ready"],
        resize: async () => undefined,
        close: async () => 0
      }
    }
  ]
};

describe("terminal-pilot-mcp tool surface", () => {
  it("exposes current and documented terminal-prefixed MCP command names", async () => {
    const server = createMCPServer(createTerminalPilotMCPGroup(), {
      name: "terminal-pilot",
      version: "0.0.1",
      omitRootToolNamePrefix: true,
      services: {
        terminalPilotRuntime: runtime
      }
    });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
    );

    try {
      expect(client.serverInfo).toEqual({
        name: "terminal-pilot",
        version: "0.0.1"
      });

      const result = await client.listTools();

      expect(result.tools).toHaveLength(EXPECTED_TOOL_NAMES.length);
      expect(result.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);
      expect(
        await client.callTool({
          name: "terminal_create_session",
          arguments: { command: "bash" }
        })
      ).toEqual({
        content: [{ type: "text", text: JSON.stringify({ session: "s1", pid: 1234 }) }]
      });
    } finally {
      await cleanup();
    }
  });
});
