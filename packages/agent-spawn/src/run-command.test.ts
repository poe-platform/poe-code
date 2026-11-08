import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import { runCommand } from "./run-command.js";

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

describe("runCommand", () => {
  it("reports signal-terminated commands as unsuccessful", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(createSignalTerminatedProcess("SIGTERM"));

    await expect(runCommand("killed-command", [])).resolves.toMatchObject({
      exitCode: 143
    });
  });

  it("ignores inherited numeric child process error codes", async () => {
    const child = createHangingProcess();
    vi.mocked(spawnChildProcess).mockReturnValue(child);

    const result = runCommand("missing-command", []);
    await withObjectPrototypeProperties({ code: 9 }, async () => {
      child.emit("error", new Error("spawn denied"));

      await expect(result).resolves.toEqual({
        stdout: "",
        stderr: "spawn denied",
        exitCode: 127
      });
    });
  });

  it("ignores inherited command runner option fields", async () => {
    const spawnMock = vi.mocked(spawnChildProcess);
    const controller = new AbortController();
    controller.abort();
    spawnMock.mockClear();
    spawnMock.mockReturnValue(createSignalTerminatedProcess("SIGTERM"));

    await withObjectPrototypeProperties(
      {
        cwd: "/polluted",
        detached: true,
        env: { POLLUTED: "1" },
        signal: controller.signal,
        stdin: "polluted input",
        timeoutMs: 1_000
      },
      async () => {
        await expect(runCommand("clean-command", [], {})).resolves.toMatchObject({
          exitCode: 143
        });
      }
    );

    const [command, args, options] = spawnMock.mock.calls[0]!;
    expect(command).toBe("clean-command");
    expect(args).toEqual([]);
    expect(options).toMatchObject({
      cwd: undefined,
      env: undefined,
      stdio: ["ignore", "pipe", "pipe"]
    });
    expect(Object.getPrototypeOf(options)).toBeNull();
  });

  it("terminates timed out commands while preserving captured output", async () => {
    vi.useFakeTimers();
    try {
      const child = createHangingProcess();
      vi.mocked(spawnChildProcess).mockReturnValue(child);

      const result = runCommand("hanging-command", [], { timeoutMs: 1_000 });
      child.stdout.write("partial stdout\n");
      child.stderr.write("partial stderr\n");

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.emit("close", null, "SIGTERM");

      await expect(result).resolves.toEqual({
        stdout: "partial stdout\n",
        stderr: "partial stderr\nCommand timed out after 1000 ms.",
        exitCode: 124,
        timedOut: true
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.runIf(process.platform !== "win32")(
    "kills timeout-managed commands through their process group on Unix",
    async () => {
      vi.useFakeTimers();
      let groupAlive = true;
      const processKillSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((pid: number, signal?: NodeJS.Signals | number) => {
          if (signal === 0 && !groupAlive) {
            throw Object.assign(new Error("process group exited"), { code: "ESRCH" });
          }
          return true;
        });
      try {
        const child = createHangingProcess(123);
        vi.mocked(spawnChildProcess).mockReturnValue(child);

        const result = runCommand("hanging-command", [], { timeoutMs: 1_000 });

        await vi.advanceTimersByTimeAsync(1_000);
        expect(spawnChildProcess).toHaveBeenCalledWith(
          "hanging-command",
          [],
          expect.objectContaining({ detached: true })
        );
        expect(child.unref).toHaveBeenCalled();
        expect(processKillSpy).toHaveBeenCalledWith(-123, "SIGTERM");
        groupAlive = false;
        child.emit("close", null, "SIGTERM");

        await expect(result).resolves.toMatchObject({
          exitCode: 124,
          timedOut: true
        });
      } finally {
        processKillSpy.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "does not treat inherited missing-process codes as process group exit",
    async () => {
      vi.useFakeTimers();
      const processKillSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((_pid: number, signal?: NodeJS.Signals | number) => {
          if (signal === 0) {
            throw new Error("process probe denied");
          }
          return true;
        });
      try {
        const child = createHangingProcess(123);
        vi.mocked(spawnChildProcess).mockReturnValue(child);

        const result = runCommand("hanging-command", [], { timeoutMs: 1_000 });

        await vi.advanceTimersByTimeAsync(1_000);
        await withObjectPrototypeProperties({ code: "ESRCH" }, async () => {
          child.emit("close", null, "SIGTERM");
          let settled = false;
          const observed = result.then((value) => {
            settled = true;
            return value;
          });

          await vi.advanceTimersByTimeAsync(0);
          expect(settled).toBe(false);

          await vi.advanceTimersByTimeAsync(1_500);
          await expect(observed).resolves.toMatchObject({
            exitCode: 124,
            timedOut: true
          });
        });
      } finally {
        processKillSpy.mockRestore();
        vi.useRealTimers();
      }
    }
  );

  it("terminates aborted commands while preserving captured output", async () => {
    const child = createHangingProcess();
    const controller = new AbortController();
    vi.mocked(spawnChildProcess).mockReturnValue(child);

    const result = runCommand("aborted-command", [], { signal: controller.signal });
    child.stdout.write("partial stdout\n");
    controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("close", null, "SIGTERM");

    await expect(result).resolves.toEqual({
      stdout: "partial stdout\n",
      stderr: "Command aborted.",
      exitCode: 130,
      aborted: true
    });
  });
});

function createSignalTerminatedProcess(signal: NodeJS.Signals): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr });

  setImmediate(() => {
    stdout.end();
    stderr.end();
    child.emit("close", null, signal);
  });

  return child;
}

function createHangingProcess(pid?: number): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr, kill: vi.fn(() => true), unref: vi.fn() });
  if (pid !== undefined) {
    Object.assign(child, { pid });
  }
  return child;
}
