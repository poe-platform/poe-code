import { describe, expect, it, vi } from "vitest";
import {
  terminalCloseSessionTool,
  terminalCreateSessionTool,
  terminalListSessionsTool,
  terminalPressKeyTool,
  terminalReadHistoryTool,
  terminalReadScreenTool,
  terminalResizeTool,
  terminalSendSignalTool,
  terminalTypeTool,
  terminalWaitForTool
} from "./mcp-tools.js";

function createSessionMock(overrides: Partial<SessionMock> = {}): SessionMock {
  return {
    id: "session-1",
    command: "poe-code",
    pid: 1234,
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    signal: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue("matched output"),
    screen: vi.fn().mockResolvedValue({
      lines: ["line 1", "line 2"],
      cursor: { row: 2, col: 3 },
      size: { rows: 40, cols: 120 }
    }),
    history: vi.fn().mockResolvedValue(["line 1", "line 2"]),
    resize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(0),
    ...overrides
  };
}

function createPilotMock(session = createSessionMock()): TerminalPilotMock {
  return {
    newSession: vi.fn().mockResolvedValue(session),
    getSession: vi.fn().mockReturnValue(session),
    sessions: vi.fn().mockReturnValue([session])
  };
}

type SessionMock = {
  id: string;
  command: string;
  pid: number;
  fill: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  signal: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
  screen: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type TerminalPilotMock = {
  newSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  sessions: ReturnType<typeof vi.fn>;
};

describe("mcp terminal tools", () => {
  it("creates a session via terminal_create_session", async () => {
    const session = createSessionMock({ id: "session-42", pid: 4242 });
    const pilot = createPilotMock(session);
    const tool = terminalCreateSessionTool(pilot as never);

    expect(tool.name).toBe("terminal_create_session");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        args: { type: "array", description: "Command arguments" },
        cwd: { type: "string", description: "Working directory" },
        cols: { type: "number", description: "Terminal width in columns" },
        rows: { type: "number", description: "Terminal height in rows" },
        observe: { type: "boolean", description: "Mirror PTY output to stderr" }
      },
      required: ["command"]
    });

    await expect(
      tool.handler({
        command: "poe-code",
        args: ["configure"],
        cwd: "/tmp/project",
        cols: 90,
        rows: 30,
        observe: true
      })
    ).resolves.toEqual({ sessionId: "session-42", pid: 4242 });

    expect(pilot.newSession).toHaveBeenCalledWith({
      command: "poe-code",
      args: ["configure"],
      cwd: "/tmp/project",
      cols: 90,
      rows: 30,
      observe: true
    });
  });

  it("creates a session with only the required command", async () => {
    const session = createSessionMock({ id: "session-minimal", pid: 2024 });
    const pilot = createPilotMock(session);
    const tool = terminalCreateSessionTool(pilot as never);

    await expect(tool.handler({ command: "bash" })).resolves.toEqual({
      sessionId: "session-minimal",
      pid: 2024
    });

    expect(pilot.newSession).toHaveBeenCalledWith({ command: "bash" });
  });

  it("types text via terminal_type", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalTypeTool(pilot as never);

    expect(tool.name).toBe("terminal_type");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        text: { type: "string", description: "Text to write to the session" }
      },
      required: ["sessionId", "text"]
    });

    await expect(tool.handler({ sessionId: "session-1", text: "hello" })).resolves.toBeUndefined();

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.fill).toHaveBeenCalledWith("hello");
  });

  it("presses a key via terminal_press_key", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalPressKeyTool(pilot as never);

    expect(tool.name).toBe("terminal_press_key");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        key: { type: "string", description: "Named key to press" }
      },
      required: ["sessionId", "key"]
    });

    await expect(tool.handler({ sessionId: "session-1", key: "Enter" })).resolves.toBeUndefined();

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.press).toHaveBeenCalledWith("Enter");
  });

  it("sends a signal via terminal_send_signal", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalSendSignalTool(pilot as never);

    expect(tool.name).toBe("terminal_send_signal");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        signal: { type: "string", description: "Signal to send to the session process" }
      },
      required: ["sessionId", "signal"]
    });

    await expect(
      tool.handler({ sessionId: "session-1", signal: "SIGINT" })
    ).resolves.toBeUndefined();

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.signal).toHaveBeenCalledWith("SIGINT");
  });

  it("waits for a pattern via terminal_wait_for", async () => {
    const session = createSessionMock({ waitFor: vi.fn().mockResolvedValue("Select an agent") });
    const pilot = createPilotMock(session);
    const tool = terminalWaitForTool(pilot as never);

    expect(tool.name).toBe("terminal_wait_for");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        pattern: { type: "string", description: "Regular expression pattern to wait for" },
        timeout: { type: "number", description: "Maximum wait time in milliseconds" }
      },
      required: ["sessionId", "pattern"]
    });

    await expect(
      tool.handler({ sessionId: "session-1", pattern: "Select.*agent", timeout: 5000 })
    ).resolves.toEqual({ matched: true, line: "Select an agent" });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.waitFor).toHaveBeenCalledTimes(1);

    const [pattern, options] = session.waitFor.mock.calls[0] as [RegExp, { timeout: number }];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.source).toBe("Select.*agent");
    expect(options).toEqual({ timeout: 5000 });
  });

  it("waits for a pattern without timeout options when timeout is omitted", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalWaitForTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1", pattern: "ready" })).resolves.toEqual({
      matched: true,
      line: "matched output"
    });

    const [pattern, options] = session.waitFor.mock.calls[0] as [RegExp, unknown];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.source).toBe("ready");
    expect(options).toBeUndefined();
  });

  it("reads the screen via terminal_read_screen", async () => {
    const session = createSessionMock({
      screen: vi.fn().mockResolvedValue({
        lines: ["menu", "  > item"],
        cursor: { row: 1, col: 4 },
        size: { rows: 24, cols: 80 }
      })
    });
    const pilot = createPilotMock(session);
    const tool = terminalReadScreenTool(pilot as never);

    expect(tool.name).toBe("terminal_read_screen");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" }
      },
      required: ["sessionId"]
    });

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({
      lines: ["menu", "  > item"],
      cursor: { row: 1, col: 4 },
      size: { rows: 24, cols: 80 }
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.screen).toHaveBeenCalledWith();
  });

  it("reads history via terminal_read_history", async () => {
    const session = createSessionMock({ history: vi.fn().mockResolvedValue(["first", "second"]) });
    const pilot = createPilotMock(session);
    const tool = terminalReadHistoryTool(pilot as never);

    expect(tool.name).toBe("terminal_read_history");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        last: { type: "number", description: "Return only the last N lines" }
      },
      required: ["sessionId"]
    });

    await expect(tool.handler({ sessionId: "session-1", last: 50 })).resolves.toEqual({
      lines: ["first", "second"]
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.history).toHaveBeenCalledWith({ last: 50 });
  });

  it("reads full history when last is omitted", async () => {
    const session = createSessionMock({ history: vi.fn().mockResolvedValue(["line 1", "line 2"]) });
    const pilot = createPilotMock(session);
    const tool = terminalReadHistoryTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({
      lines: ["line 1", "line 2"]
    });

    expect(session.history).toHaveBeenCalledWith({ last: undefined });
  });

  it("resizes the terminal via terminal_resize", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalResizeTool(pilot as never);

    expect(tool.name).toBe("terminal_resize");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        cols: { type: "number", description: "Terminal width in columns" },
        rows: { type: "number", description: "Terminal height in rows" }
      },
      required: ["sessionId", "cols", "rows"]
    });

    await expect(
      tool.handler({ sessionId: "session-1", cols: 100, rows: 40 })
    ).resolves.toBeUndefined();

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.resize).toHaveBeenCalledWith(100, 40);
  });

  it("closes a session via terminal_close_session", async () => {
    const session = createSessionMock({ close: vi.fn().mockResolvedValue(143) });
    const pilot = createPilotMock(session);
    const tool = terminalCloseSessionTool(pilot as never);

    expect(tool.name).toBe("terminal_close_session");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" }
      },
      required: ["sessionId"]
    });

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({ exitCode: 143 });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.close).toHaveBeenCalledWith();
  });

  it("lists sessions via terminal_list_sessions", async () => {
    const first = createSessionMock({ id: "session-1", command: "poe-code", pid: 1111 });
    const second = createSessionMock({ id: "session-2", command: "bash", pid: 2222 });
    const pilot = {
      newSession: vi.fn(),
      getSession: vi.fn(),
      sessions: vi.fn().mockReturnValue([first, second])
    };
    const tool = terminalListSessionsTool(pilot as never);

    expect(tool.name).toBe("terminal_list_sessions");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: []
    });

    await expect(tool.handler({})).resolves.toEqual({
      sessions: [
        { id: "session-1", command: "poe-code", pid: 1111 },
        { id: "session-2", command: "bash", pid: 2222 }
      ]
    });

    expect(pilot.sessions).toHaveBeenCalledWith();
  });

  it("returns an empty session list when no sessions are active", async () => {
    const pilot = {
      newSession: vi.fn(),
      getSession: vi.fn(),
      sessions: vi.fn().mockReturnValue([])
    };
    const tool = terminalListSessionsTool(pilot as never);

    await expect(tool.handler({})).resolves.toEqual({ sessions: [] });
  });
});
