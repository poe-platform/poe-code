import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "./run-command.js";

const spawnedPids = new Set<number>();

describe("runCommand process cleanup", () => {
  afterEach(() => {
    for (const pid of spawnedPids) {
      killIfAlive(pid);
      spawnedPids.delete(pid);
    }
  });

  it.runIf(process.platform !== "win32")(
    "kills shell-spawned descendants before resolving timeouts",
    async () => {
      const pidFile = path.join(
        os.tmpdir(),
        `poe-run-command-child-${process.pid}-${Date.now()}.pid`
      );

      try {
        const result = await runCommand(
          "sh",
          ["-c", "sleep 30 & echo $! > \"$PID_FILE\"; wait"],
          {
            timeoutMs: 250,
            env: { PID_FILE: pidFile }
          }
        );
        const childPid = Number.parseInt(await fs.readFile(pidFile, "utf8"), 10);
        expect(Number.isInteger(childPid)).toBe(true);
        spawnedPids.add(childPid);

        expect(result).toMatchObject({ exitCode: 124, timedOut: true });
        expect(isAlive(childPid)).toBe(false);
      } finally {
        await fs.rm(pidFile, { force: true });
      }
    }
  );
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcess(error);
  }
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best-effort cleanup for failed regressions.
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ESRCH"
  );
}
