import { defineSchema, type ToolDefinition } from "tiny-stdio-mcp-server";
import type { TerminalKey, TerminalPilot } from "terminal-pilot";

export type TerminalPilotMcpTool<T = Record<string, unknown>> = ToolDefinition<T>;

export function terminalCreateSessionTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  command: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  observe?: boolean;
}> {
  return {
    name: "terminal_create_session",
    description: "Spawn an interactive CLI in a PTY",
    inputSchema: defineSchema({
      command: { type: "string", description: "Command to execute" },
      args: { type: "array", description: "Command arguments", optional: true },
      cwd: { type: "string", description: "Working directory", optional: true },
      cols: { type: "number", description: "Terminal width in columns", optional: true },
      rows: { type: "number", description: "Terminal height in rows", optional: true },
      observe: { type: "boolean", description: "Mirror PTY output to stderr", optional: true }
    }),
    async handler(input) {
      const session = await agent.newSession(input);
      return { sessionId: session.id, pid: session.pid };
    }
  };
}

export function terminalTypeTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  text: string;
}> {
  return {
    name: "terminal_type",
    description: "Write text to an active terminal session",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      text: { type: "string", description: "Text to write to the session" }
    }),
    async handler(input) {
      await agent.getSession(input.sessionId).fill(input.text);
      return undefined;
    }
  };
}

export function terminalPressKeyTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  key: TerminalKey;
}> {
  return {
    name: "terminal_press_key",
    description: "Send a named key press to an active terminal session",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      key: { type: "string", description: "Named key to press" }
    }),
    async handler(input) {
      await agent.getSession(input.sessionId).press(input.key);
      return undefined;
    }
  };
}

export function terminalSendSignalTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  signal: string;
}> {
  return {
    name: "terminal_send_signal",
    description: "Send a process signal to an active terminal session",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      signal: { type: "string", description: "Signal to send to the session process" }
    }),
    async handler(input) {
      await agent.getSession(input.sessionId).signal(input.signal);
      return undefined;
    }
  };
}

export function terminalWaitForTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  pattern: string;
  timeout?: number;
}> {
  return {
    name: "terminal_wait_for",
    description: "Wait for terminal output to match a pattern",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      pattern: { type: "string", description: "Regular expression pattern to wait for" },
      timeout: { type: "number", description: "Maximum wait time in milliseconds", optional: true }
    }),
    async handler(input) {
      const session = agent.getSession(input.sessionId);
      const pattern = new RegExp(input.pattern);
      const line =
        input.timeout === undefined
          ? await session.waitFor(pattern)
          : await session.waitFor(pattern, { timeout: input.timeout });

      return { matched: true, line };
    }
  };
}

export function terminalReadScreenTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
}> {
  return {
    name: "terminal_read_screen",
    description: "Read the current visible terminal screen",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" }
    }),
    async handler(input) {
      const screen = await agent.getSession(input.sessionId).screen();
      return {
        lines: [...screen.lines],
        cursor: { ...screen.cursor },
        size: { ...screen.size }
      };
    }
  };
}

export function terminalReadHistoryTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  last?: number;
}> {
  return {
    name: "terminal_read_history",
    description: "Read terminal output history",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      last: { type: "number", description: "Return only the last N lines", optional: true }
    }),
    async handler(input) {
      const lines = await agent.getSession(input.sessionId).history({ last: input.last });
      return { lines };
    }
  };
}

export function terminalResizeTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
  cols: number;
  rows: number;
}> {
  return {
    name: "terminal_resize",
    description: "Resize an active terminal session",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" },
      cols: { type: "number", description: "Terminal width in columns" },
      rows: { type: "number", description: "Terminal height in rows" }
    }),
    async handler(input) {
      await agent.getSession(input.sessionId).resize(input.cols, input.rows);
      return undefined;
    }
  };
}

export function terminalCloseSessionTool(agent: TerminalPilot): TerminalPilotMcpTool<{
  sessionId: string;
}> {
  return {
    name: "terminal_close_session",
    description: "Close an active terminal session",
    inputSchema: defineSchema({
      sessionId: { type: "string", description: "Terminal session id" }
    }),
    async handler(input) {
      const exitCode = await agent.getSession(input.sessionId).close();
      return { exitCode };
    }
  };
}

export function terminalPilotMcpTools(agent: TerminalPilot): Array<TerminalPilotMcpTool<any>> {
  return [
    terminalCreateSessionTool(agent),
    terminalTypeTool(agent),
    terminalPressKeyTool(agent),
    terminalSendSignalTool(agent),
    terminalWaitForTool(agent),
    terminalReadScreenTool(agent),
    terminalReadHistoryTool(agent),
    terminalResizeTool(agent),
    terminalCloseSessionTool(agent),
    terminalListSessionsTool(agent)
  ];
}

export function terminalListSessionsTool(
  agent: TerminalPilot
): TerminalPilotMcpTool<Record<string, never>> {
  return {
    name: "terminal_list_sessions",
    description: "List active terminal sessions",
    inputSchema: defineSchema({}),
    async handler() {
      return {
        sessions: agent.sessions().map((session) => ({
          id: session.id,
          command: session.command,
          pid: session.pid
        }))
      };
    }
  };
}
