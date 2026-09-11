import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOwnErrorCode } from "./error-codes.js";
import { runCommand } from "./run-command.js";

const observation = vi.hoisted(() => ({ onSpawn: undefined as ((child: ChildProcess) => void) | undefined }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args);
    observation.onSpawn?.(child);
    return child;
  } };
});

const spawnedPids = new Set<number>();
const spawnedGroups = new Set<number>();

describe("runCommand process cleanup", () => {
  afterEach(() => {
    observation.onSpawn = undefined;
    vi.useRealTimers();
    for (const pid of spawnedGroups) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* Already retired. */ }
      spawnedGroups.delete(pid);
    }
    for (const pid of spawnedPids) {
      killIfAlive(pid);
      spawnedPids.delete(pid);
    }
  });

  it.runIf(process.platform !== "win32")(
    "kills shell-spawned descendants before resolving timeouts",
    async () => {
      const realSetTimeout = globalThis.setTimeout;
      const realClearTimeout = globalThis.clearTimeout;
      let shellPid: number | undefined;
      let settled = false;
      let resolveReady!: (pid: number) => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<number>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      observation.onSpawn = child => {
        shellPid = child.pid;
        if (shellPid !== undefined) spawnedGroups.add(shellPid);
        let output = "";
        child.stdout?.on("data", chunk => {
          output += String(chunk);
          if (!output.includes("\n")) return;
          const pid = Number(output.trim());
          if (!Number.isInteger(pid) || pid <= 0) { rejectReady(new Error("invalid descendant PID")); return; }
          spawnedPids.add(pid);
          resolveReady(pid);
        });
        child.once("error", rejectReady);
        child.once("close", () => rejectReady(new Error("shell exited before descendant readiness")));
      };
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const pending = runCommand("sh", ["-c", "sleep 30 & printf '%s\n' \"$!\"; wait"], { timeoutMs: 250 });
        void pending.then(() => { settled = true; });
        const childPid = await ready;
        expect(isAlive(childPid)).toBe(true);
        vi.advanceTimersByTime(249);
        expect(settled).toBe(false);
        expect(isAlive(childPid)).toBe(true);
        // Only the initial timeout uses virtual time. Escalation and group-exit
        // polling retain real timers and native process events.
        const scheduling = vi.spyOn(globalThis, "setTimeout").mockImplementation(realSetTimeout);
        const clearing = vi.spyOn(globalThis, "clearTimeout").mockImplementation(realClearTimeout);
        try { vi.advanceTimersByTime(1); }
        finally { scheduling.mockRestore(); clearing.mockRestore(); vi.useRealTimers(); }
        const result = await pending;
        expect(result).toMatchObject({ exitCode: 124, timedOut: true });
        expect(isAlive(childPid)).toBe(false);
      } finally {
        observation.onSpawn = undefined;
        vi.useRealTimers();
        if (shellPid !== undefined) {
          try { process.kill(-shellPid, "SIGKILL"); } catch { /* Already retired. */ }
          spawnedGroups.delete(shellPid);
        }

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
  return hasOwnErrorCode(error, "ESRCH");
}
