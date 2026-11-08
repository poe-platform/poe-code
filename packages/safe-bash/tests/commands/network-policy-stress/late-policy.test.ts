import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

for (const mode of ["abort", "deadline"]) {
  test(`late policy rejection after ${mode} is observed and child exits cleanly`, { timeout: 10000 }, async () => {
    const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx",
      fileURLToPath(new URL("./late-policy-child.ts", import.meta.url)), mode], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    const capture = (chunk: Buffer, stream: "stdout" | "stderr") => {
      if (stdout.length + stderr.length + chunk.length > 64 * 1024) { overflow = true; child.kill("SIGKILL"); return; }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, "stderr"));
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const watchdog = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 6000);
    try {
      const result = await closed;
      assert.equal(timedOut, false, stderr);
      assert.equal(overflow, false);
      assert.equal(result.signal, null, stderr);
      assert.equal(result.code, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, `late-${mode}:ok\n`);
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed.catch(() => {});
    }
  });
}
