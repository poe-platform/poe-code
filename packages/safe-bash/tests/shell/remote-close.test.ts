import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

for (const scenario of [
  "transport", "pipefail", "middle", "middle-status", "nested-invoke", "redirect", "group",
  "consumer-rejection", "consumer-status",
  "late-read-rejection", "iterator-return", "caller-abort", "budget-abort",
  "completed-success", "completed-failure", "completed-rejection", "delayed-no-write",
  "closed-before-write", "zero-byte-no-write",
  "first-read-head-zero", "first-read-local-unenrolled-controlled", "first-read-local-owned",
  "first-read-s3", "first-read-webdav", "first-read-curl-body", "first-read-curl-headers",
  "first-read-webdav-body-acquired", "first-read-curl-body-acquired", "first-read-required-destinations",
]) {
  test(`hard-deadline pipeline close: ${scenario}`, async context => {
    const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx",
      fileURLToPath(new URL(scenario.startsWith("first-read-") ? "./first-read-probe.ts" : "./remote-close-probe.ts", import.meta.url)), scenario], {
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    const stop = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch (error) { assert.ok(error instanceof Error && "code" in error && error.code === "ESRCH"); }
    };
    let timedOut = false;
    let oversized = false;
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const timer = setTimeout(() => { timedOut = true; stop(); }, 3000);
    const capture = (chunk: Buffer, diagnostic: boolean) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { oversized = true; stop(); return; }
      if (diagnostic) stderr += chunk.toString();
      else stdout += chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, true));
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal }));
    }).finally(() => { clearTimeout(timer); });
    let residual = false;
    if (child.pid && process.platform !== "win32") {
      try { process.kill(-child.pid, 0); residual = true; stop(); }
      catch (error) { assert.ok(error instanceof Error && "code" in error && error.code === "ESRCH"); }
    }
    context.diagnostic(JSON.stringify({ scenario, pid: child.pid, ...result, timedOut, oversized, residual,
      ...(scenario.startsWith("first-read-") ? { stdout, stderr } : {}),
    }));
    assert.equal(residual, false, `${scenario}: residual child process group was stopped`);
    assert.equal(timedOut, false, `${scenario}: hard 3000ms deadline; ${stderr}`);
    assert.equal(oversized, false, `${scenario}: output exceeded 1 MiB`);
    assert.equal(result.signal, null, `${scenario}: child terminated by ${result.signal}`);
    assert.equal(result.status, 0, `${scenario}: ${stderr}`);
    assert.match(stdout, /: passed/u);
  });
}
