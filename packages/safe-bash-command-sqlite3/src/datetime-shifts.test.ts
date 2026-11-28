import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";

test("sqlite3 applies signed clock and calendar date modifiers", async () => {
  let stdout = "", stderr = "";
  const result = await createSqlite3Command().execute({
    command: "sqlite3",
    ...createCommandArguments([":memory:", "select datetime('2024-01-05 10:00', '+01:30'), datetime('2024-01-05 10:00', '-00:30:15'), date('2024-01-05', '+0001-02-03');"]),
    fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "2024-01-05 11:30:00|2024-01-05 09:29:45|2025-03-08\n");
});

for (const [input, modifier, expected] of [
  ["2024-01-05 10:00", "+00:00:00.125", "2024-01-05 10:00:00.125"],
  ["2024-01-05 00:00", "-00:00:00.125", "2024-01-04 23:59:59.875"],
  ["2024-01-05 10:00", "-0001-02-03 01:30:15.250", "2022-11-02 08:29:44.750"],
  ["2024-01-05 10:00", "+0001-02-03 01:30", "2025-03-08 11:30:00.000"],
  ["2024-02-29", "+0001-01-00", "2025-03-29 00:00:00.000"],
  ["2024-01-31", "+0000-01-00", "2024-03-02 00:00:00.000"],
  ["2024-01-05", "+25:00", null],
  ["2024-01-05", "+01:60", null],
  ["2024-01-05", "+00:00:60", null],
  ["2024-01-05", "+0000-12-00", null],
  ["2024-01-05", "+0000-00-31", null],
  ["2024-01-05", "+01:30junk", null],
  ["2024-01-05", "unknown", null]
]) {
  test(`date modifier ${modifier} on ${input}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(
      `SELECT strftime('%Y-%m-%d %H:%M:%f', '${input}', '${modifier}')`
    )[0]!.rows, [[expected]]);
  });
}
