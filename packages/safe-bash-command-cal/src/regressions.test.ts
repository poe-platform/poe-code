import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { createCalCommand } from "./index.js";

function context(args: string[] = []): CommandContext {
  return { command: "cal", args: createCommandArguments(args).args, cwd: "/", env: { UID: "1000" },
    fs: createMemoryFileSystem(), stdin: createBytePipe().readable,
    stdout: createBytePipe().writable, stderr: createBytePipe().writable, signal: new AbortController().signal };
}
async function run(command: CommandDefinition, ctx: CommandContext) {
  let stdout = "", stderr = "";
  const result = await command.execute({ ...ctx,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  return { ...result, stdout, stderr };
}
test("all calendar spans enforce maxMonths", async () => {
  for (const args of [["-A", "3"], ["-B", "3"], ["-3"], ["-y"], ["2026"], ["-A", "Infinity"], ["-B", "1.5"]]) {
    const result = await run(createCalCommand({ limits: { maxMonths: 2 } }), context(args));
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stdout, "");
  }
});
test("ranges before year zero keep valid month names", async () => {
  for (const args of [["-B", "15", "1", "1"], ["-N", "-B", "15", "1", "1"]]) {
    const result = await run(createCalCommand(), context(args));
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes("undefined"));
    assert.ok(result.stdout.includes("October -1"));
  }
});
test("both layouts yield to cancellation during multi-month rendering", async () => {
  for (const args of [["-n", "5000"], ["-N", "-n", "5000"]]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await assert.rejects(run(createCalCommand(), { ...context(args), signal: controller.signal }), { name: "AbortError" });
    } finally { clearTimeout(timer); }
  }
});

test("combined offsets accept the quota boundary and reject the next month", async () => {
  const command = createCalCommand({ limits: { maxMonths: 3 } });
  assert.equal((await run(command, context(["-A", "1", "-B", "1"]))).exitCode, 0);
  assert.equal((await run(command, context(["-A", "2", "-B", "1"]))).exitCode, 1);
});
