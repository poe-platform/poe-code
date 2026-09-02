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

async function runHost(selected: readonly string[], batch = false): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("../shell-stress/env-split-author/resume-host.ts", import.meta.url)), ...(batch ? ["--batch", ...selected] : selected)], {
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
        assert.throws(() => process.kill(child.pid!, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
        resolve(Buffer.concat(stdout).toString());
      } catch (error) { reject(error); }
    });
  });
}

const finiteBatches = [
  scenarios.slice(0, 4),
  scenarios.slice(4, 8),
  ["literal-single-optional-argument", "literal-injection-host-boundary", "fallback-keeps-context", "same-stream-split-does-not-consume"],
];
const filtered = ["--test-name-pattern", "--test-skip-pattern"].some(option =>
  process.execArgv.some(argument => argument === option || argument.startsWith(`${option}=`)) || process.env.NODE_OPTIONS?.includes(option));

for (const scenario of scenarios) {
  const batch = filtered ? undefined : finiteBatches.find(group => group.includes(scenario));
  if (batch) {
    if (batch[0] !== scenario) continue;
    test(`env split finite batch: ${scenario}`, { timeout: 6000 }, async context => {
      const output = await runHost(batch, true);
      const rows = output.trimEnd().split("\n");
      assert.equal(rows.length, batch.length);
      for (const [index, member] of batch.entries()) {
        await context.test(`env split bounded host: ${member}`, () => {
          assert.deepEqual(JSON.parse(rows[index]!), { scenario: member, passed: true });
        });
      }
    });
  } else {
    test(`env split bounded host: ${scenario}`, { timeout: 6000 }, async () => {
      const output = await runHost([scenario]);
      assert.deepEqual(JSON.parse(output), { scenario, passed: true });
    });
  }
}

test("env split finite batch isolates repeated row state", { timeout: 6000 }, async () => {
  const repeated = ["literal-single-optional-argument", "literal-injection-host-boundary", "prefix-assignment-before-clear", "prefix-assignment-before-clear"];
  const output = await runHost(repeated, true);
  assert.deepEqual(output.trimEnd().split("\n").map(row => JSON.parse(row)), repeated.map(scenario => ({ scenario, passed: true })));
});
