import { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { vi } from "vitest";

export function createShellChild(output: { stdout?: string; stderr?: string; exitCode?: number } = {}): ChildProcess {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  });
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => {
      if (output.stdout !== undefined) stdout.write(output.stdout);
      if (output.stderr !== undefined) stderr.write(output.stderr);
      if (output.exitCode !== undefined) {
        stdout.end();
        stderr.end();
        child.emit("close", output.exitCode, null);
      }
    });
    return child;
  });
  return child;
}
