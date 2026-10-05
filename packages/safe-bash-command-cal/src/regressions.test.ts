import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { createCalCommand, evalSyncCal } from "./index.js";

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
test("calendar spans reject years outside 1..9999 before rendering", async () => {
  for (const layout of [[], ["-N"]]) {
    for (const args of [
      ["-3", "1", "1"], ["-S", "-n", "5", "1", "1"],
      ["-S", "-n", "30", "1", "1"], ["-B", "15", "1", "1"],
      ["-3", "12", "9999"], ["-n", "2", "12", "9999"],
      ["-A", "1", "12", "9999"],
    ]) {
      const input = [...layout, ...args];
      const result = await run(createCalCommand(), context(input));
      assert.equal(result.exitCode, 1, input.join(" "));
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("year range"));
      assert.equal(evalSyncCal("cal", input), undefined);
    }
    for (const args of [["1", "1"], ["12", "9999"], ["-3", "2", "1"], ["-3", "11", "9999"], ["1"], ["9999"]]) {
      const input = [...layout, ...args];
      const result = await run(createCalCommand(), context(input));
      assert.equal(result.exitCode, 0, input.join(" "));
      assert.equal(result.stdout, evalSyncCal("cal", input) + "\n");
    }
  }
});

test("day operands respect month lengths, leap years and the 1752 reform", async () => {
  for (const name of ["cal", "ncal"] as const) {
    for (const args of [
      ["notaday", "1", "2026"], ["99", "2", "2026"], ["0", "1", "2026"],
      ["1.5", "1", "2026"], ["1e1", "1", "2026"], ["", "1", "2026"],
      ["29", "2", "2026"], ["29", "2", "1900"], ["31", "4", "2026"],
      ...Array.from({ length: 11 }, (_, i) => [String(i + 3), "9", "1752"]),
    ]) {
      const result = await run(createCalCommand(), { ...context(args), command: name });
      assert.equal(result.exitCode, 1, args.join(" "));
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("invalid date"));
      assert.equal(evalSyncCal(name, args), undefined);
    }
    for (const args of [["29", "2", "2024"], ["29", "2", "1700"], ["2", "9", "1752"], ["14", "9", "1752"], ["31", "12", "9999"]]) {
      const result = await run(createCalCommand(), { ...context(args), command: name });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, evalSyncCal(name, args) + "\n");
    }
  }
});

test("long week options match the short option in both execution paths", async () => {
  for (const name of ["cal", "ncal"] as const) {
    const expected = await run(createCalCommand(), { ...context(["-w", "1", "2026"]), command: name });
    for (const option of ["--week", "--week=2"]) {
      const args = [option, "1", "2026"];
      const result = await run(createCalCommand(), { ...context(args), command: name });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected.stdout);
      assert.equal(result.stdout, evalSyncCal(name, args) + "\n");
    }
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
