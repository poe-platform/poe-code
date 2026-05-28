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
