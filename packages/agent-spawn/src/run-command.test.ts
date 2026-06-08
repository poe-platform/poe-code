import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

import { runCommand } from "./run-command.js";

describe("runCommand", () => {
  it("reports signal-terminated commands as unsuccessful", async () => {
    vi.mocked(spawnChildProcess).mockReturnValue(createSignalTerminatedProcess("SIGTERM"));

    await expect(runCommand("killed-command", [])).resolves.toMatchObject({
      exitCode: 143
    });
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

function createHangingProcess(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr, kill: vi.fn(() => true) });
  return child;
}
