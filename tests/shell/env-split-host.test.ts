import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scenarios = [
  "real-nested-pipeline", "export-local-cwd-parent", "prefix-assignment-before-clear",
  "binary-cursor-origin", "supplied-empty-origin", "bom-stderr-stdout",
  "parse-before-chdir-effects", "unsupported-before-chdir", "literal-single-optional-argument",
  "literal-injection-host-boundary", "shared-command-budget", "shared-output-budget",
  "shared-depth-budget", "shared-source-budget", "shared-loop-budget",
  "split-byte-cap", "split-argument-cap", "split-recursion-cap",
  "typed-cancel-cleanup-late-reject", "cleanup-failure-identity", "preabort-no-dispatch",
  "blocked-input-cancel", "fallback-keeps-context", "sink-cancel-precedence",
  "same-stream-split-does-not-consume",
];

for (const scenario of scenarios) test(`env split bounded host: ${scenario}`, { timeout: 6000 }, async () => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("../shell-stress/env-split-author/resume-host.ts", import.meta.url)), scenario], {
      detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const kill = () => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {} };
    const timer = setTimeout(() => { failure = new Error("author child deadline exceeded"); kill(); }, 4000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk); bytes += chunk.length;
      if (bytes > 256 * 1024) { failure = new Error("author child output limit exceeded"); kill(); }
    });
    child.on("error", error => { failure = error; });
    child.on("close", (status, signal) => {
      clearTimeout(timer); kill();
      try {
        assert.equal(failure, undefined); assert.equal(signal, null);
        assert.equal(status, 0, Buffer.concat(stderr).toString());
        assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), { scenario, passed: true });
        assert.throws(() => process.kill(child.pid!, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
        resolve();
      } catch (error) { reject(error); }
    });
  });
});
