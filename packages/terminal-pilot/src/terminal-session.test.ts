import { beforeEach, describe, expect, it, vi } from "vitest";

const { accessSyncMock, chmodSyncMock, spawnMock } = vi.hoisted(() => ({
  accessSyncMock: vi.fn(),
  chmodSyncMock: vi.fn(),
  spawnMock: vi.fn()
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    accessSync: accessSyncMock,
    chmodSync: chmodSyncMock
  };
});

vi.mock("node-pty", () => ({
  spawn: spawnMock
}));

function createPtyMock() {
  return {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  };
}

describe("TerminalSession spawn helper setup", () => {
  beforeEach(() => {
    accessSyncMock.mockReset();
    chmodSyncMock.mockReset();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(createPtyMock());
    vi.resetModules();
  });

  it("ignores a missing node-pty spawn-helper", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });

    accessSyncMock.mockImplementation(() => {
      throw missingError;
    });
    chmodSyncMock.mockImplementation(() => {
      throw missingError;
    });

    const { TerminalSession } = await import("./terminal-session.js");

    expect(
      () =>
        new TerminalSession({
          id: "session-1",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          cwd: process.cwd(),
          env: process.env,
          observe: false
        })
    ).not.toThrow();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid history line limit %s",
    async (last) => {
      const { TerminalSession } = await import("./terminal-session.js");
      const session = new TerminalSession({ id: "session-1", command: process.execPath });

      await expect(session.history({ last })).rejects.toThrow(
        "History last must be a non-negative integer."
      );
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
    "rejects invalid terminal geometry %s before spawning",
    async (size) => {
      const { TerminalSession } = await import("./terminal-session.js");

      expect(() =>
        new TerminalSession({ id: "session-1", command: process.execPath, cols: size, rows: 24 })
      ).toThrow("Terminal columns and rows must be positive integers.");
      expect(spawnMock).not.toHaveBeenCalled();
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid waitFor timeout %s",
    async (timeout) => {
      const { TerminalSession } = await import("./terminal-session.js");
      const session = new TerminalSession({ id: "session-1", command: process.execPath });

      await expect(session.waitFor("missing", { timeout })).rejects.toThrow(
        "Timeout must be a finite non-negative number."
      );
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid waitForExit timeout %s",
    async (timeout) => {
      const { TerminalSession } = await import("./terminal-session.js");
      const session = new TerminalSession({ id: "session-1", command: process.execPath });

      await expect(session.waitForExit({ timeout })).rejects.toThrow(
        "Timeout must be a finite non-negative number."
      );
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects invalid quiet period %s",
    async (duration) => {
      const { TerminalSession } = await import("./terminal-session.js");
      const session = new TerminalSession({ id: "session-1", command: process.execPath });

      await expect(session.waitForQuiet(duration)).rejects.toThrow(
        "Quiet period must be a finite non-negative number."
      );
    }
  );

  it("rejects invalid resized geometry before forwarding it to the pty", async () => {
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });
    const pty = spawnMock.mock.results[0]?.value as ReturnType<typeof createPtyMock>;

    await expect(session.resize(-1, 24)).rejects.toThrow(
      "Terminal columns and rows must be positive integers."
    );
    expect(pty.resize).not.toHaveBeenCalled();
  });
});
