import { describe, expect, it, vi } from "vitest";
import {
  terminalCloseSessionTool,
  terminalCreateSessionTool,
  terminalFillTool,
  terminalGetSessionTool,
  terminalListSessionsTool,
  terminalPressKeyTool,
  terminalReadHistoryTool,
  terminalReadScreenTool,
  terminalResizeTool,
  terminalSendSignalTool,
  terminalTypeTool,
  terminalWaitForExitTool,
  terminalWaitForTool
} from "./mcp-tools.js";

function createSessionMock(overrides: Partial<SessionMock> = {}): SessionMock {
  return {
    id: "session-1",
    command: "poe-code",
    pid: 1234,
    exitCode: null,
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    signal: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue("matched output"),
    waitForExit: vi.fn().mockResolvedValue(0),
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
    sessions: vi.fn().mockReturnValue([session]),
    deleteSession: vi.fn()
  };
}

type SessionMock = {
  id: string;
  command: string;
  pid: number;
  exitCode: number | null;
  fill: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  signal: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
  waitForExit: ReturnType<typeof vi.fn>;
  screen: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type TerminalPilotMock = {
  newSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  sessions: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
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

  it("fills text at once via terminal_fill", async () => {
    const session = createSessionMock();
    const pilot = createPilotMock(session);
    const tool = terminalFillTool(pilot as never);

    expect(tool.name).toBe("terminal_fill");
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

  it("types text character-by-character via terminal_type", async () => {
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
    expect(session.type).toHaveBeenCalledWith("hello");
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

  it("waits for a regex pattern via terminal_wait_for", async () => {
    const session = createSessionMock({ waitFor: vi.fn().mockResolvedValue("Select an agent") });
    const pilot = createPilotMock(session);
    const tool = terminalWaitForTool(pilot as never);

    expect(tool.name).toBe("terminal_wait_for");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        pattern: { type: "string", description: "Regular expression pattern to wait for" },
        timeout: { type: "number", description: "Maximum wait time in milliseconds" },
        literal: {
          type: "boolean",
          description: "When true, treat pattern as a literal string instead of a regex"
        }
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

  it("passes a literal string to waitFor when literal is true", async () => {
    const session = createSessionMock({
      waitFor: vi.fn().mockResolvedValue("file.txt matched")
    });
    const pilot = createPilotMock(session);
    const tool = terminalWaitForTool(pilot as never);

    await expect(
      tool.handler({ sessionId: "session-1", pattern: "file.txt", literal: true })
    ).resolves.toEqual({ matched: true, line: "file.txt matched" });

    const [pattern] = session.waitFor.mock.calls[0] as [string | RegExp];
    expect(typeof pattern).toBe("string");
    expect(pattern).toBe("file.txt");
  });

  it("waits for exit via terminal_wait_for_exit", async () => {
    const session = createSessionMock({ waitForExit: vi.fn().mockResolvedValue(0) });
    const pilot = createPilotMock(session);
    const tool = terminalWaitForExitTool(pilot as never);

    expect(tool.name).toBe("terminal_wait_for_exit");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" },
        timeout: { type: "number", description: "Maximum wait time in milliseconds" }
      },
      required: ["sessionId"]
    });

    await expect(tool.handler({ sessionId: "session-1", timeout: 5000 })).resolves.toEqual({
      exitCode: 0
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.waitForExit).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it("waits for exit without timeout when timeout is omitted", async () => {
    const session = createSessionMock({ waitForExit: vi.fn().mockResolvedValue(1) });
    const pilot = createPilotMock(session);
    const tool = terminalWaitForExitTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({ exitCode: 1 });
    expect(session.waitForExit).toHaveBeenCalledWith(undefined);
  });

  it("reads the screen via terminal_read_screen and includes exitCode", async () => {
    const session = createSessionMock({
      exitCode: null,
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
      size: { rows: 24, cols: 80 },
      exitCode: null
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.screen).toHaveBeenCalledWith();
  });

  it("reads the screen and reflects a non-null exitCode", async () => {
    const session = createSessionMock({
      exitCode: 0,
      screen: vi.fn().mockResolvedValue({
        lines: [],
        cursor: { row: 0, col: 0 },
        size: { rows: 40, cols: 120 }
      })
    });
    const pilot = createPilotMock(session);
    const tool = terminalReadScreenTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toMatchObject({
      exitCode: 0
    });
  });

  it("reads history via terminal_read_history and includes exitCode", async () => {
    const session = createSessionMock({
      exitCode: null,
      history: vi.fn().mockResolvedValue(["first", "second"])
    });
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
      lines: ["first", "second"],
      exitCode: null
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.history).toHaveBeenCalledWith({ last: 50 });
  });

  it("reads full history when last is omitted and includes exitCode", async () => {
    const session = createSessionMock({
      exitCode: 1,
      history: vi.fn().mockResolvedValue(["line 1", "line 2"])
    });
    const pilot = createPilotMock(session);
    const tool = terminalReadHistoryTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({
      lines: ["line 1", "line 2"],
      exitCode: 1
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

  it("closes a session and deletes it from the map via terminal_close_session", async () => {
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
    expect(pilot.deleteSession).toHaveBeenCalledWith("session-1");
  });

  it("gets session metadata without side effects via terminal_get_session", async () => {
    const session = createSessionMock({ id: "session-1", pid: 9999, command: "vim", exitCode: null });
    const pilot = createPilotMock(session);
    const tool = terminalGetSessionTool(pilot as never);

    expect(tool.name).toBe("terminal_get_session");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Terminal session id" }
      },
      required: ["sessionId"]
    });

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toEqual({
      id: "session-1",
      pid: 9999,
      command: "vim",
      exitCode: null
    });

    expect(pilot.getSession).toHaveBeenCalledWith("session-1");
    expect(session.fill).not.toHaveBeenCalled();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("gets session metadata with a non-null exitCode", async () => {
    const session = createSessionMock({ exitCode: 0 });
    const pilot = createPilotMock(session);
    const tool = terminalGetSessionTool(pilot as never);

    await expect(tool.handler({ sessionId: "session-1" })).resolves.toMatchObject({ exitCode: 0 });
  });

  it("lists sessions via terminal_list_sessions", async () => {
    const first = createSessionMock({ id: "session-1", command: "poe-code", pid: 1111 });
    const second = createSessionMock({ id: "session-2", command: "bash", pid: 2222 });
    const pilot = {
      newSession: vi.fn(),
      getSession: vi.fn(),
      sessions: vi.fn().mockReturnValue([first, second]),
      deleteSession: vi.fn()
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
      sessions: vi.fn().mockReturnValue([]),
      deleteSession: vi.fn()
    };
    const tool = terminalListSessionsTool(pilot as never);

    await expect(tool.handler({})).resolves.toEqual({ sessions: [] });
  });
});
