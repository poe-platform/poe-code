import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { UserError } from "toolcraft";
import {
  closeSession,
  createTerminalPilotGroup,
  createSession,
  fill,
  getSession,
  install,
  listSessions,
  pressKey,
  readHistory,
  readScreen,
  resize,
  screenshot,
  sendSignal,
  terminalPilotGroup,
  type as typeCommand,
  uninstall,
  waitFor,
  waitForExit
} from "./index.js";
import {
  SESSION_ENV_VAR,
  createTerminalPilotRuntime,
  type TerminalPilotCommandServices
} from "./runtime.js";

// ---------------------------------------------------------------------------
// index.test.ts — terminal-pilot commands
// ---------------------------------------------------------------------------

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
  close: ReturnType<typeof vi.fn>;
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
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

describe("terminal-pilot commands", () => {
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
      "list-sessions",
      "install",
      "uninstall"
    ]);
    expect(install.scope).toEqual(["cli"]);
    expect(uninstall.scope).toEqual(["cli"]);
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

  it("prevents consumers from removing built-in commands", () => {
    expect(() => {
      terminalPilotGroup.children = terminalPilotGroup.children.filter(
        (command) => command.name !== "create-session"
      ) as typeof terminalPilotGroup.children;
    }).toThrow();
    expect(createTerminalPilotGroup().children.map((command) => command.name)).toContain(
      "create-session"
    );
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

  it("rejects blank create-session command and session names before spawning", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "   "
        }
      })
    ).rejects.toThrow("Command must not be empty.");

    await expect(
      createSession.handler({
        ...context,
        params: {
          command: "bash",
          session: "\t"
        }
      })
    ).rejects.toThrow("Session name must not be empty.");

    await expect(
      createSession.handler({
        ...createCommandContext(runtime, { [SESSION_ENV_VAR]: "  " }),
        params: {
          command: "bash"
        }
      })
    ).rejects.toThrow("Session name must not be empty.");

    expect(pilot.newSession).not.toHaveBeenCalled();
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

  it("rejects blank wait-for patterns and negative timeouts before resolving sessions", async () => {
    const pilot = createPilotMock();
    const runtime = createTerminalPilotRuntime({
      launchPilot: async () => pilot as never
    });
    const context = createCommandContext(runtime);

    await expect(
      waitFor.handler({
        ...context,
        params: {
          pattern: "  "
        }
      })
    ).rejects.toThrow("Wait pattern must not be empty.");

    await expect(
      waitFor.handler({
        ...context,
        params: {
          pattern: "ready",
          timeout: -1
        }
      })
    ).rejects.toThrow("Timeout must be a finite non-negative number.");

    await expect(
      waitForExit.handler({
        ...context,
        params: {
          timeout: -1
        }
      })
    ).rejects.toThrow("Timeout must be a finite non-negative number.");

    expect(pilot.sessions).not.toHaveBeenCalled();
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

  it("reserves a requested session name while creation is in progress", async () => {
    let finishCreate: ((session: SessionMock) => void) | undefined;
    const pilot = createPilotMock();
    pilot.newSession.mockImplementationOnce(
      () =>
        new Promise<SessionMock>((resolve) => {
          finishCreate = resolve;
        })
    );
    const runtime = createTerminalPilotRuntime({ launchPilot: async () => pilot as never });

    const first = runtime.createSession({ session: "job", command: "one" });
    await expect(runtime.createSession({ session: "job", command: "two" })).rejects.toThrow(
      'Session "job" already exists.'
    );
    finishCreate?.(createSessionMock({ id: "session-one", command: "one" }));

    await expect(first).resolves.toMatchObject({ name: "job" });
    expect(pilot.newSession).toHaveBeenCalledTimes(1);
  });

  it("releases a requested session name after natural exit", async () => {
    const first = createSessionMock({
      id: "first"
    });
    const second = createSessionMock({ id: "second" });
    const sessions = [first, second];
    let created = 0;
    const pilot = createPilotMock([], () => sessions[created++] as SessionMock);
    const runtime = createTerminalPilotRuntime({ launchPilot: async () => pilot as never });

    await runtime.createSession({ session: "job", command: "one" });
    first.exitCode = 0;

    await expect(runtime.createSession({ session: "job", command: "two" })).resolves.toMatchObject({
      name: "job",
      session: second
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

// ---------------------------------------------------------------------------
// install-uninstall.test.ts — install/uninstall commands
// ---------------------------------------------------------------------------

const HOME_DIR = "/home/test";
const CWD = "/project";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs, vol };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("terminal-pilot install/uninstall commands", () => {
  function createCommandContext(fileSystem: FileSystem) {
    return {
      fetch: globalThis.fetch,
      fs: {
        exists: async () => false,
        readFile: async () => "",
        writeFile: async () => undefined
      },
      env: {
        get(): string | undefined {
          return undefined;
        }
      },
      progress(): void {
        return undefined;
      },
      secrets: {},
      terminalPilotInstaller: {
        cwd: CWD,
        fs: fileSystem,
        homeDir: HOME_DIR,
        platform: "darwin" as const
      }
    };
  }

  it("installs the terminal-pilot skill for an explicit local agent install", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          local: true
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      scope: "local",
      skillPath: ".claude/skills/terminal-pilot/SKILL.md"
    });

    const skill = await fs.readFile(
      path.join(CWD, ".claude/skills/terminal-pilot/SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("name: terminal-pilot");
    expect(skill).toContain("terminal-pilot create-session");
    expect(skill).not.toContain("MCP");

    await expect(fs.readFile(path.join(HOME_DIR, ".claude.json"), "utf8")).rejects.toThrow(
      "ENOENT"
    );
  });

  it("defaults install scope to local when no scope flag is provided", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "codex"
        }
      })
    ).resolves.toEqual({
      agent: "codex",
      scope: "local",
      skillPath: ".codex/skills/terminal-pilot/SKILL.md"
    });
  });

  it("installs into the global skill directory when --global is selected", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          global: true
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      scope: "global",
      skillPath: "~/.claude/skills/terminal-pilot/SKILL.md"
    });

    await expect(
      fs.readFile(path.join(HOME_DIR, ".claude/skills/terminal-pilot/SKILL.md"), "utf8")
    ).resolves.toContain("terminal-pilot create-session");
  });

  it("rejects conflicting local/global scope flags", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code",
          global: true,
          local: true
        }
      })
    ).rejects.toBeInstanceOf(UserError);
  });

  it("rejects unsupported agents even when the handler is invoked directly", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      install.handler({
        ...createCommandContext(fs),
        params: {
          agent: "kimi"
        }
      })
    ).rejects.toThrow("Unsupported agent: kimi");
  });

  it("removes both terminal-pilot skill folders", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(path.join(HOME_DIR, ".claude/skills/terminal-pilot"), { recursive: true });
    vol.mkdirSync(path.join(CWD, ".claude/skills/terminal-pilot"), { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });
    vol.mkdirSync(HOME_DIR, { recursive: true });
    await fs.writeFile(path.join(HOME_DIR, ".claude/skills/terminal-pilot/SKILL.md"), "global", {
      encoding: "utf8"
    });
    await fs.writeFile(path.join(CWD, ".claude/skills/terminal-pilot/SKILL.md"), "local", {
      encoding: "utf8"
    });
    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: {
          agent: "claude-code"
        }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      removedSkillPaths: [".claude/skills/terminal-pilot", "~/.claude/skills/terminal-pilot"]
    });

    await expect(fs.stat(path.join(CWD, ".claude/skills/terminal-pilot"))).rejects.toThrow(
      "ENOENT"
    );
    await expect(fs.stat(path.join(HOME_DIR, ".claude/skills/terminal-pilot"))).rejects.toThrow(
      "ENOENT"
    );
  });

  it("is a no-op when uninstalling an agent without terminal-pilot configured", async () => {
    const { fs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: {
          agent: "codex"
        }
      })
    ).resolves.toEqual({
      agent: "codex",
      removedSkillPaths: []
    });
  });

  it("does not hide uninstall path check errors with inherited missing-file codes", async () => {
    const { fs: rawFs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });
    const fs = {
      ...rawFs,
      lstat: async (folderPath: string) => {
        if (folderPath.includes("terminal-pilot")) {
          throw new Error("skill lstat denied");
        }

        return await rawFs.lstat(folderPath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        uninstall.handler({
          ...createCommandContext(fs),
          params: { agent: "codex" }
        })
      ).rejects.toThrow("skill lstat denied");
    });
  });

  it("does not hide uninstall folder stat errors with inherited missing-file codes", async () => {
    const { fs: rawFs, vol } = createMemFs();
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.mkdirSync(CWD, { recursive: true });
    const localSkill = path.join(CWD, ".codex/skills/terminal-pilot");
    const fs = {
      ...rawFs,
      stat: async (folderPath: string) => {
        if (folderPath === localSkill) {
          throw new Error("skill stat denied");
        }

        return await rawFs.stat(folderPath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        uninstall.handler({
          ...createCommandContext(fs),
          params: { agent: "codex" }
        })
      ).rejects.toThrow("skill stat denied");
    });
  });

  it("preserves local installation when global uninstall staging fails", async () => {
    const { fs: rawFs, vol } = createMemFs();
    const localSkill = path.join(CWD, ".claude/skills/terminal-pilot");
    const globalSkill = path.join(HOME_DIR, ".claude/skills/terminal-pilot");
    vol.mkdirSync(localSkill, { recursive: true });
    vol.mkdirSync(globalSkill, { recursive: true });
    await rawFs.writeFile(path.join(localSkill, "SKILL.md"), "local", { encoding: "utf8" });
    await rawFs.writeFile(path.join(globalSkill, "SKILL.md"), "global", { encoding: "utf8" });
    const fs = {
      ...rawFs,
      rename: async (fromPath: string, toPath: string) => {
        if (fromPath === globalSkill) {
          throw new Error("simulated global staging failure");
        }
        await rawFs.rename(fromPath, toPath);
      }
    };

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: { agent: "claude-code" }
      })
    ).rejects.toThrow("simulated global staging failure");

    await expect(rawFs.readFile(path.join(localSkill, "SKILL.md"), "utf8")).resolves.toBe("local");
    await expect(rawFs.readFile(path.join(globalSkill, "SKILL.md"), "utf8")).resolves.toBe(
      "global"
    );
  });

  it("rejects uninstall through a symlinked local skill directory", async () => {
    const { fs, vol } = createMemFs();
    const externalSkill = path.join("/outside/skills", "terminal-pilot");
    vol.mkdirSync(path.join(CWD, ".codex"), { recursive: true });
    vol.mkdirSync(externalSkill, { recursive: true });
    vol.mkdirSync(HOME_DIR, { recursive: true });
    vol.symlinkSync("/outside/skills", path.join(CWD, ".codex/skills"));
    await fs.writeFile(path.join(externalSkill, "SKILL.md"), "external", { encoding: "utf8" });

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: { agent: "codex" }
      })
    ).rejects.toThrow("symbolic link");

    await expect(fs.readFile(path.join(externalSkill, "SKILL.md"), "utf8")).resolves.toBe(
      "external"
    );
  });

  it("deactivates both installations when staged cleanup fails", async () => {
    const { fs: rawFs, vol } = createMemFs();
    const localSkill = path.join(CWD, ".claude/skills/terminal-pilot");
    const globalSkill = path.join(HOME_DIR, ".claude/skills/terminal-pilot");
    vol.mkdirSync(localSkill, { recursive: true });
    vol.mkdirSync(globalSkill, { recursive: true });
    await rawFs.writeFile(path.join(localSkill, "SKILL.md"), "local", { encoding: "utf8" });
    await rawFs.writeFile(path.join(globalSkill, "SKILL.md"), "global", { encoding: "utf8" });
    const fs = {
      ...rawFs,
      rm: async (folderPath: string, options?: { recursive?: boolean; force?: boolean }) => {
        if (folderPath.startsWith(`${globalSkill}.removing-`)) {
          throw new Error("simulated cleanup failure");
        }
        await rawFs.rm(folderPath, options);
      }
    };

    await expect(
      uninstall.handler({
        ...createCommandContext(fs),
        params: { agent: "claude-code" }
      })
    ).resolves.toEqual({
      agent: "claude-code",
      removedSkillPaths: [".claude/skills/terminal-pilot", "~/.claude/skills/terminal-pilot"]
    });

    await expect(rawFs.stat(localSkill)).rejects.toThrow("ENOENT");
    await expect(rawFs.stat(globalSkill)).rejects.toThrow("ENOENT");
  });
});
