/**
 * Patches bun:test's vi object with vitest-compatible shims.
 * Shared between root and package test setups.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { setSystemTime, vi } from "bun:test";

const viAny = vi as any;
if (!viAny.mocked) {
  viAny.mocked = (fn: unknown) => fn;
}
if (!viAny.waitFor) {
  viAny.waitFor = async (fn: () => void | Promise<void>, opts?: { timeout?: number; interval?: number }) => {
    const timeout = opts?.timeout ?? 1000;
    const interval = opts?.interval ?? 50;
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await fn();
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    throw lastError;
  };
}
if (!viAny.advanceTimersByTimeAsync) {
  viAny.advanceTimersByTimeAsync = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  };
}
if (!viAny.setSystemTime) {
  viAny.setSystemTime = (now?: Date | number) => setSystemTime(now);
}
if (!viAny.resetModules) {
  viAny.resetModules = () => {
    // bun:test does not support module cache reset — no-op
  };
}
if (!viAny.importActual) {
  viAny.importActual = (moduleId: string) => Promise.resolve(require(moduleId));
}

process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";
(globalThis as Record<string, unknown>).__POE_REAL_CHILD_PROCESS_SPAWN__ ??= nodeSpawn;
