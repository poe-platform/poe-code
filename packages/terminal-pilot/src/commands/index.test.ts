import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  closeSession,
  createSession,
  fill,
  getSession,
  listSessions,
  pressKey,
  readHistory,
  readScreen,
  resize,
  screenshot,
  sendSignal,
  terminalPilotGroup,
  type as typeCommand,
  waitFor,
  waitForExit
} from "./index.js";
import {
  SESSION_ENV_VAR,
  createTerminalPilotRuntime,
  type TerminalPilotCommandServices
} from "./runtime.js";

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

type PilotMock = {
  newSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  sessions: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
};

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

function createPilotMock(
  initialSessions: SessionMock[] = [],
  newSessionFactory?: (params: { command: string; args?: string[] }) => SessionMock
): PilotMock {
  const sessions = [...initialSessions];
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));

  return {
    newSession: vi.fn(async (params: { command: string }) => {
      const session =
        newSessionFactory?.(params) ??
        createSessionMock({
          id: `session-${sessionMap.size + 1}`,
          command: params.command,
          pid: sessionMap.size + 1000
        });
      sessions.push(session);
      sessionMap.set(session.id, session);
      return session;
    }),
    getSession: vi.fn((id: string) => {
      const session = sessionMap.get(id);

      if (session === undefined) {
        throw new Error(`Session not found: ${id}`);
      }

      return session;
    }),
    sessions: vi.fn(() => sessions.filter((session) => session.exitCode === null)),
    deleteSession: vi.fn((id: string) => {
      sessionMap.delete(id);
      const index = sessions.findIndex((session) => session.id === id);
      if (index >= 0) {
        sessions.splice(index, 1);
      }
    })
  };
}

function createCommandContext(
  runtime: ReturnType<typeof createTerminalPilotRuntime>,
  env: Record<string, string | undefined> = {}
): TerminalPilotCommandServices & {
  fetch: typeof globalThis.fetch;
  fs: {
    exists(path: string): Promise<boolean>;
    readFile(path: string, encoding?: BufferEncoding): Promise<string>;
    writeFile(path: string, contents: string): Promise<void>;
  };
  env: { get(key: string): string | undefined };
  progress(message: string): void;
  secrets: Record<string, never>;
} {
  return {
    terminalPilotRuntime: runtime,
    fetch: globalThis.fetch,
    fs: {
      exists: async () => false,
      readFile: async () => "",
      writeFile: async () => undefined
    },
    env: {
      get(key: string): string | undefined {
        return env[key];
      }
    },
    progress: () => undefined,
    secrets: {}
  };
}

describe("terminal-pilot commands", () => {
  it("exports the full terminal-pilot command group", () => {
    expect(terminalPilotGroup.name).toBe("terminal-pilot");
    expect(terminalPilotGroup.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(terminalPilotGroup.children.map((command) => command.name)).toEqual([
      "create-session",
      "fill",
      "type",
      "press-key",
      "send-signal",
      "wait-for",
      "wait-for-exit",
      "read-screen",
      "screenshot",
      "read-history",
      "resize",
      "close-session",
      "get-session",
      "list-sessions"
    ]);
    expect(createSession.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(fill.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(typeCommand.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(pressKey.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(sendSignal.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(waitFor.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(waitForExit.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(readScreen.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(screenshot.scope).toEqual(["cli"]);
    expect(readHistory.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(resize.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(closeSession.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(getSession.scope).toEqual(["cli", "mcp", "sdk"]);
    expect(listSessions.scope).toEqual(["cli", "mcp", "sdk"]);
  });

  it("creates sessions with env-backed names and lists them by human-readable session name", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime, { [SESSION_ENV_VAR]: "tests" });

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "npm",
          args: ["test"]
        }
      })
    ).resolves.toEqual({
      session: "tests",
      pid: 1000
    });

    await expect(
      listSessions.handler({
        ...context,
        params: {}
      })
    ).resolves.toEqual({
      sessions: [
        {
          session: "tests",
          command: "npm",
          pid: 1000
        }
      ]
    });
  });

  it("auto-names create-session calls and resolves an omitted session when exactly one is active", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "bash"
        }
      })
    ).resolves.toEqual({
      session: "s1",
      pid: 1000
    });

    await expect(
      readScreen.handler({
        ...context,
        params: {}
      })
    ).resolves.toEqual({
      lines: ["line 1", "line 2"],
      cursor: { row: 2, col: 3 },
      size: { rows: 40, cols: 120 },
      exitCode: null
    });
  });

  it("errors when an unnamed session lookup is ambiguous", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await createSession.handler({
      ...context,
      params: {
        command: "bash"
      }
    });
    await createSession.handler({
      ...context,
      params: {
        command: "vim"
      }
    });

    await expect(
      getSession.handler({
        ...context,
        params: {}
      })
    ).rejects.toThrow(/Multiple active sessions.*s1.*s2/);
  });

  it("routes interactive commands to the resolved session", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await createSession.handler({
      ...context,
      params: {
        command: "poe-code",
        session: "tests"
      }
    });

    const session = (await pilot.newSession.mock.results[0]?.value) as SessionMock | undefined;

    await expect(
      fill.handler({
        ...context,
        params: {
          session: "tests",
          text: "hello"
        }
      })
    ).resolves.toBeUndefined();
    await expect(
      typeCommand.handler({
        ...context,
        params: {
          session: "tests",
          text: "hello"
        }
      })
    ).resolves.toBeUndefined();
    await expect(
      pressKey.handler({
        ...context,
        params: {
          session: "tests",
          key: "Enter"
        }
      })
    ).resolves.toBeUndefined();
    await expect(
      sendSignal.handler({
        ...context,
        params: {
          session: "tests",
          signal: "SIGINT"
        }
      })
    ).resolves.toBeUndefined();
    await expect(
      resize.handler({
        ...context,
        params: {
          session: "tests",
          cols: 100,
          rows: 50
        }
      })
    ).resolves.toBeUndefined();

    expect(session?.fill).toHaveBeenCalledWith("hello");
    expect(session?.type).toHaveBeenCalledWith("hello");
    expect(session?.press).toHaveBeenCalledWith("Enter");
    expect(session?.signal).toHaveBeenCalledWith("SIGINT");
    expect(session?.resize).toHaveBeenCalledWith(100, 50);
  });

  it("uses the env-backed session name for non-create commands when -s is omitted", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const createContext = createCommandContext(runtime);
    const envContext = createCommandContext(runtime, { [SESSION_ENV_VAR]: "tests" });

    await createSession.handler({
      ...createContext,
      params: {
        command: "poe-code",
        session: "tests"
      }
    });

    await expect(
      getSession.handler({
        ...envContext,
        params: {}
      })
    ).resolves.toEqual({
      session: "tests",
      pid: 1000,
      command: "poe-code",
      exitCode: null
    });
  });

  it("passes literal patterns through wait-for without compiling a regex", async () => {
    const session = createSessionMock({
      waitFor: vi.fn().mockResolvedValue("literal [abc]")
    });
    const pilot = createPilotMock([], () => session);
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await createSession.handler({
      ...context,
      params: {
        command: "poe-code",
        session: "tests"
      }
    });

    await expect(
      waitFor.handler({
        ...context,
        params: {
          session: "tests",
          pattern: "literal [abc]",
          literal: true,
          timeout: 250
        }
      })
    ).resolves.toEqual({
      matched: true,
      line: "literal [abc]"
    });

    expect(session.waitFor).toHaveBeenCalledWith("literal [abc]", { timeout: 250 });
  });

  it("rejects duplicate session names and reuses auto-generated names after close-session", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "bash",
          session: "tests"
        }
      })
    ).resolves.toEqual({
      session: "tests",
      pid: 1000
    });

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "vim",
          session: "tests"
        }
      })
    ).rejects.toThrow('Session "tests" already exists.');

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "npm"
        }
      })
    ).resolves.toEqual({
      session: "s1",
      pid: 1001
    });

    await expect(
      closeSession.handler({
        ...context,
        params: {
          session: "s1"
        }
      })
    ).resolves.toEqual({
      exitCode: 0
    });

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "node"
        }
      })
    ).resolves.toEqual({
      session: "s1",
      pid: 1001
    });
  });

  it("waits, reads history, returns metadata, and closes named sessions", async () => {
    const session = createSessionMock({
      id: "session-custom",
      pid: 4242,
      command: "vim",
      waitFor: vi.fn().mockResolvedValue("Select an agent"),
      waitForExit: vi.fn().mockResolvedValue(143),
      history: vi.fn().mockResolvedValue(["first", "second"]),
      close: vi.fn().mockResolvedValue(143)
    });
    const pilot = createPilotMock([], () => session);
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await createSession.handler({
      ...context,
      params: {
        command: "vim",
        session: "tests"
      }
    });

    await expect(
      waitFor.handler({
        ...context,
        params: {
          session: "tests",
          pattern: "Select.*agent",
          timeout: 5000
        }
      })
    ).resolves.toEqual({
      matched: true,
      line: "Select an agent"
    });

    expect(session.waitFor).toHaveBeenCalledWith(expect.any(RegExp), { timeout: 5000 });

    await expect(
      waitForExit.handler({
        ...context,
        params: {
          session: "tests",
          timeout: 2000
        }
      })
    ).resolves.toEqual({
      exitCode: 143
    });

    await expect(
      readHistory.handler({
        ...context,
        params: {
          session: "tests",
          last: 2
        }
      })
    ).resolves.toEqual({
      lines: ["first", "second"],
      exitCode: null
    });

    await expect(
      getSession.handler({
        ...context,
        params: {
          session: "tests"
        }
      })
    ).resolves.toEqual({
      session: "tests",
      pid: 4242,
      command: "vim",
      exitCode: null
    });

    await expect(
      closeSession.handler({
        ...context,
        params: {
          session: "tests"
        }
      })
    ).resolves.toEqual({
      exitCode: 143
    });

    await expect(
      listSessions.handler({
        ...context,
        params: {}
      })
    ).resolves.toEqual({
      sessions: []
    });
  });

  it("captures a session screen as a non-empty PNG", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "terminal-pilot-screenshot-"));
    const outputPath = path.join(outputDir, "screen.png");
    const runtime = createTerminalPilotRuntime();
    const context = createCommandContext(runtime);

    try {
      const created = await createSession.handler({
        ...context,
        params: {
          command: process.execPath,
          args: [
            "-e",
            "process.stdout.write('\\u001b[36mcyan\\u001b[0m\\n'); setTimeout(() => {}, 10000);"
          ],
          session: "color"
        }
      });

      expect(created.session).toBe("color");

      const namedSession = await runtime.resolveSession("color");
      await namedSession.session.waitFor("cyan");

      await expect(
        screenshot.handler({
          ...context,
          params: {
            session: "color",
            output: outputPath
          }
        })
      ).resolves.toBeUndefined();

      const png = await readFile(outputPath);
      expect(png.byteLength).toBeGreaterThan(0);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
