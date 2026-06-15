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

async function withClient<T>(
  terminalPilotRuntime: TerminalPilotRuntime,
  callback: (client: McpClient) => Promise<T>
): Promise<T> {
  const server = createMCPServer(createTerminalPilotMCPGroup(), {
    name: "terminal-pilot",
    version: "0.0.1",
    omitRootToolNamePrefix: true,
    services: {
      terminalPilotRuntime
    }
  });
  const { client, cleanup } = await createSdkTestPair(
    server,
    () =>
      new McpClient({
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      })
  );

  try {
    return await callback(client);
  } finally {
    await cleanup();
  }
}

describe("terminal-pilot-mcp tool surface", () => {
  it("exposes current and documented terminal-prefixed MCP command names", async () => {
    await withClient(runtime, async (client) => {
      expect(client.serverInfo).toEqual({
        name: "terminal-pilot",
        version: "0.0.1"
      });

      const result = await client.listTools();

      expect(result.tools).toHaveLength(EXPECTED_TOOL_NAMES.length);
      expect(result.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOL_NAMES);
      expect(result.tools.find((tool) => tool.name === "terminal_create_session")).toMatchObject({
        outputSchema: {
          type: "object",
          properties: {
            session: { type: "string" },
            pid: { type: "integer", minimum: 1 }
          },
          required: ["session", "pid"]
        }
      });
      expect(
        await client.callTool({
          name: "terminal_create_session",
          arguments: { command: "bash" }
        })
      ).toEqual({
        content: [{ type: "text", text: JSON.stringify({ session: "s1", pid: 1234 }) }],
        structuredContent: { session: "s1", pid: 1234 }
      });
    });
  });

  it("advertises constrained numeric, timeout, and key schemas", async () => {
    await withClient(runtime, async (client) => {
      const result = await client.listTools();
      const toolByName = new Map(result.tools.map((tool) => [tool.name, tool]));

      expect(toolByName.get("terminal_create_session")).toMatchObject({
        inputSchema: {
          properties: {
            command: { minLength: 1, pattern: "\\S" },
            session: { minLength: 1, pattern: "\\S" },
            cols: { type: "integer", minimum: 1 },
            rows: { type: "integer", minimum: 1 }
          }
        },
        outputSchema: {
          properties: {
            pid: { type: "integer", minimum: 1 }
          }
        }
      });
      expect(toolByName.get("terminal_wait_for")).toMatchObject({
        inputSchema: {
          properties: {
            pattern: { minLength: 1, pattern: "\\S" },
            timeout: { type: "number", minimum: 0 }
          }
        },
        outputSchema: {
          properties: {
            matched: { type: "boolean" },
            line: { type: "string" }
          }
        }
      });
      expect(toolByName.get("terminal_wait_for_exit")).toMatchObject({
        inputSchema: {
          properties: {
            timeout: { type: "number", minimum: 0 }
          }
        },
        outputSchema: {
          properties: {
            exit_code: { type: "integer", nullable: true }
          }
        }
      });
      const pressKeySchema = toolByName.get("terminal_press_key")?.inputSchema.properties?.key;
      expect(pressKeySchema).toMatchObject({
        type: "string"
      });
      const keyPattern = new RegExp(String(pressKeySchema?.pattern));
      expect(keyPattern.test("Control+c")).toBe(true);
      expect(keyPattern.test("NotAKey")).toBe(false);
      expect(toolByName.get("terminal_press_key")).toMatchObject({
        inputSchema: {
          properties: {
            key: { type: "string" }
          }
        }
      });
      expect(toolByName.get("terminal_read_history")).toMatchObject({
        inputSchema: {
          properties: {
            last: { type: "integer", minimum: 0 }
          }
        },
        outputSchema: {
          properties: {
            exit_code: { type: "integer", nullable: true }
          }
        }
      });
      expect(toolByName.get("terminal_read_screen")).toMatchObject({
        outputSchema: {
          properties: {
            cursor: {
              properties: {
                row: { type: "integer", minimum: 0 },
                col: { type: "integer", minimum: 0 }
              }
            },
            size: {
              properties: {
                rows: { type: "integer", minimum: 1 },
                cols: { type: "integer", minimum: 1 }
              }
            },
            exit_code: { type: "integer", nullable: true }
          }
        }
      });
      expect(toolByName.get("terminal_resize")).toMatchObject({
        inputSchema: {
          properties: {
            cols: { type: "integer", minimum: 1 },
            rows: { type: "integer", minimum: 1 }
          }
        }
      });
      expect(toolByName.get("terminal_get_session")).toMatchObject({
        outputSchema: {
          properties: {
            session: { type: "string" },
            pid: { type: "integer", minimum: 1 },
            exit_code: { type: "integer", nullable: true }
          }
        }
      });
      expect(toolByName.get("terminal_list_sessions")).toMatchObject({
        outputSchema: {
          properties: {
            sessions: {
              items: {
                properties: {
                  session: { type: "string" },
                  pid: { type: "integer", minimum: 1 }
                }
              }
            }
          }
        }
      });
    });
  });

  it("rejects invalid key values before invoking the terminal runtime", async () => {
    const calls: string[] = [];
    const keyRuntime: TerminalPilotRuntime = {
      ...runtime,
      resolveSession: async () => ({
        name: "s1",
        session: {
          id: "session-1",
          command: "bash",
          pid: 1234,
          exitCode: null,
          fill: async () => undefined,
          type: async () => undefined,
          press: async (key) => {
            calls.push(key);
          },
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
      })
    };

    await withClient(keyRuntime, async (client) => {
      await expect(
        client.callTool({
          name: "terminal_press_key",
          arguments: { session: "s1", key: "NotAKey" }
        })
      ).rejects.toMatchObject({
        code: -32602,
        message: expect.stringContaining("Unknown terminal key")
      });
    });

    expect(calls).toEqual([]);
  });

  it("rejects impossible PID output before returning structured content", async () => {
    const invalidPidRuntime: TerminalPilotRuntime = {
      ...runtime,
      createSession: async (params) => ({
        name: params.session ?? "s1",
        session: {
          id: "session-1",
          command: params.command,
          pid: -12,
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
      })
    };

    await withClient(invalidPidRuntime, async (client) => {
      await expect(
        client.callTool({
          name: "terminal_create_session",
          arguments: { command: "bash" }
        })
      ).rejects.toMatchObject({
        code: -32603,
        message: expect.stringContaining("pid")
      });
    });
  });
});
