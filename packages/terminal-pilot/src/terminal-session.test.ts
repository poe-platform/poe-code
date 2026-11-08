import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  let dataListener: ((chunk: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number }) => void) | undefined;
  return {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((listener: (chunk: string) => void) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    }),
    emitData(chunk: string) {
      dataListener?.(chunk);
    },
    emitExit(exitCode: number) {
      exitListener?.({ exitCode });
    }
  };
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

describe("TerminalSession spawn helper setup", () => {
  beforeEach(() => {
    accessSyncMock.mockReset();
    chmodSyncMock.mockReset();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(createPtyMock());
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("does not ignore spawn-helper chmod errors with inherited missing-file codes", async () => {
    accessSyncMock.mockImplementation(() => {
      throw new Error("spawn helper access denied");
    });
    chmodSyncMock.mockImplementation(() => {
      throw new Error("spawn helper chmod denied");
    });

    const { TerminalSession } = await import("./terminal-session.js");

    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
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
      ).toThrow("spawn helper chmod denied");
    });
    expect(spawnMock).not.toHaveBeenCalled();
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

  it("reports the visible line after carriage-return rewrites", async () => {
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });
    const pty = spawnMock.mock.results[0]?.value as ReturnType<typeof createPtyMock>;

    pty.emitData("loading 0%\rloading 100%\n");

    await expect(session.history()).resolves.toEqual(["loading 100%"]);
  });

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

  it("rejects waitFor promptly when the terminal exits before a match", async () => {
    vi.useFakeTimers();
    const pty = createPtyMock();
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });

    const waiting = expect(session.waitFor("missing", { timeout: 1000 })).rejects.toThrow("exited");
    pty.emitExit(0);
    await vi.advanceTimersByTimeAsync(100);

    await waiting;
  });

  it("waits for a pattern on the current screen without matching prior output", async () => {
    vi.useFakeTimers();
    const pty = createPtyMock();
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });

    pty.emitData("Agent traces");
    pty.emitData("\x1b[2J\x1b[HLoading");

    const waiting = session.waitFor("Agent traces", { scope: "screen", timeout: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    pty.emitData("\x1b[HAgent traces");
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toBe("Agent traces");
  });

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

  it("retries termination after a kill request throws", async () => {
    vi.useFakeTimers();
    let emitExit: ((event: { exitCode: number }) => void) | undefined;
    const pty = {
      ...createPtyMock(),
      kill: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("kill temporarily failed");
        })
        .mockImplementationOnce(() => {
          emitExit?.({ exitCode: 143 });
        }),
      onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
        emitExit = listener;
        return { dispose: vi.fn() };
      })
    };
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });

    const firstClose = expect(session.close()).rejects.toThrow("kill temporarily failed");
    await vi.advanceTimersByTimeAsync(250);
    await firstClose;

    const secondClose = session.close();
    await vi.advanceTimersByTimeAsync(250);

    await expect(secondClose).resolves.toBe(143);
    expect(pty.kill).toHaveBeenCalledTimes(2);
  });

  it("continues close escalation after an earlier ignored signal", async () => {
    vi.useFakeTimers();
    const pty = createPtyMock();
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });

    await session.signal("SIGINT");
    const closed = session.close();
    await vi.advanceTimersByTimeAsync(1250);
    pty.emitExit(137);

    await expect(closed).resolves.toBe(137);
    expect(pty.kill).toHaveBeenNthCalledWith(1, "SIGINT");
    expect(pty.kill).toHaveBeenNthCalledWith(2, "SIGTERM");
    expect(pty.kill).toHaveBeenNthCalledWith(3, "SIGKILL");
  });

  it("rejects close when the pty never reports exit after sigkill", async () => {
    vi.useFakeTimers();
    const pty = createPtyMock();
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });

    const closed = expect(session.close()).rejects.toThrow("SIGKILL");
    await vi.advanceTimersByTimeAsync(2250);

    await closed;
    expect(pty.kill).toHaveBeenCalledWith("SIGTERM");
    expect(pty.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects input sent after the terminal has exited", async () => {
    const pty = createPtyMock();
    spawnMock.mockReturnValue(pty);
    const { TerminalSession } = await import("./terminal-session.js");
    const session = new TerminalSession({ id: "session-1", command: process.execPath });
    pty.emitExit(0);

    await expect(session.fill("late input")).rejects.toThrow("already exited");
    expect(pty.write).not.toHaveBeenCalled();
  });
});
