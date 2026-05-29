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
});
