import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function runRemoteCloseChild(args: readonly string[]) {
  const started = performance.now();
  const deadline = started + 3000;
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch (error) { assert.ok(error instanceof Error && "code" in error && error.code === "ESRCH", String(error)); }
  };
  let timedOut = false;
  let oversized = false;
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  const expire = () => { timedOut = true; stop(); };
  const timer = setTimeout(expire, Math.max(0, deadline - performance.now()));
  const capture = (chunk: Buffer, diagnostic: boolean) => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) { oversized = true; stop(); return; }
    if (diagnostic) stderr += chunk.toString();
    else stdout += chunk.toString();
  };
  child.stdout.on("data", (chunk: Buffer) => capture(chunk, false));
  child.stderr.on("data", (chunk: Buffer) => capture(chunk, true));
  const groupAlive = (): boolean => {
    if (!child.pid || process.platform === "win32") return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { assert.ok(error instanceof Error && "code" in error && error.code === "ESRCH"); return false; }
  };
  try {
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal }));
    });
    const closeElapsedMs = performance.now() - started;
    const residualAtClose = groupAlive();
    let residual = residualAtClose;
    if (!timedOut && performance.now() >= deadline) expire();
    while (residual && !timedOut && !oversized) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) { expire(); break; }
      await delay(Math.min(10, remaining));
      if (!timedOut) residual = groupAlive();
    }
    if (residual) stop();
    return { pid: child.pid, ...result, timedOut, oversized, residual, residualAtClose,
      closeElapsedMs, elapsedMs: performance.now() - started, stdout, stderr };
  } catch (error) {
    stop();
    throw error;
  } finally { clearTimeout(timer); }
}
