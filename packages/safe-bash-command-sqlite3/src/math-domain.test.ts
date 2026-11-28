import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";
import { SqliteDatabase } from "./engine.js";

for (const expression of [
  "sqrt(-1)", "ln(0)", "ln(-1)", "acos(2)", "sign('x')",
  "asin(2)", "pow(-1, 0.5)", "log(0)", "log2(0)", "log10(-1)",
  "log(1, 2)", "log(-2, 4)", "log(2, 0)", "log(2, NULL)",
  "sqrt('4x')", "sign('')", "sign('0x10')", "sqrt(x'34')",
  "ceil('x')", "floor('x')", "trunc('x')", "exp('x')", "sin('x')",
  "cos('x')", "tan('x')", "atan('x')", "atan2(1, 'x')",
  "degrees('x')", "radians('x')", "mod('x', 2)", "sqrt(NULL)", "pow('x', 0)"
]) {
  test(`sqlite3 returns NULL for ${expression}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(
      `SELECT ${expression}, typeof(${expression}), ${expression} IS NULL`
    )[0]!.rows, [[null, "null", 1]]);
  });
}

test("sqlite3 preserves valid math inputs and overflow", () => {
  assert.deepEqual(new SqliteDatabase().exec(
    "SELECT sqrt(' 4 '), sign('-2'), sign(0), ln(1), log(2,8), pow(0,-1), exp(1000)"
  )[0]!.rows, [[2, -1, 0, 0, 3, Infinity, Infinity]]);
});

test("sqlite3 prints NULL fields for math domain errors", async () => {
  const stdin = createBytePipe();
  await stdin.close();
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const result = await createSqlite3Command().execute({
    command: "sqlite3",
    args: createCommandArguments([":memory:", "select sqrt(-1), ln(0), ln(-1), acos(2), typeof(sqrt(-1)), sign('x');"]).args,
    stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
    fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal
  });
  await stdout.close();
  await stderr.close();
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.from(await output).toString(), "||||null|\n");
  assert.equal(Buffer.from(await errors).toString(), "");
});
