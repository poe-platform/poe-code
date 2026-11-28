import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";

for (const [expression, message] of [
  ["nofunc(1)", "no such function: nofunc"],
  ["max()", "wrong number of arguments to function max()"],
  ["substr('a')", "wrong number of arguments to function substr()"],
  ["ABS(1,2)", "wrong number of arguments to function ABS()"],
  ["coalesce(1)", "wrong number of arguments to function coalesce()"],
  ["sum(1,2)", "wrong number of arguments to function sum()"],
  ["row_number(1) OVER ()", "wrong number of arguments to function row_number()"]
]) {
  test(`sqlite3 rejects ${expression} with status 1 and no output`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3", args: createCommandArguments([":memory:", `select ${expression};`]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.from(await output).toString(), "");
    assert.equal(Buffer.from(await errors).toString(), `Error: in prepare, ${message}\n`);
  });
}

for (const sql of [
  "SELECT nofunc(1) WHERE 0",
  "SELECT CASE WHEN 0 THEN nofunc(1) ELSE 1 END",
  "SELECT coalesce(1, nofunc(1))",
  "SELECT 1 FROM (SELECT 1 AS x WHERE 0) WHERE nofunc(x)",
  "SELECT (SELECT nofunc(1)) WHERE 0"
]) {
  test(`sqlite3 validates functions before evaluating ${sql}`, () => {
    assert.throws(() => new SqliteDatabase().exec(sql), {
      message: "in prepare, no such function: nofunc"
    });
  });
}

test("sqlite3 retains valid fixed, optional, variadic, aggregate, and window calls", () => {
  const db = new SqliteDatabase();
  assert.deepEqual(db.exec(`SELECT max(1), max(1,2,3), substr('abc',2), substr('abc',2,1),
    coalesce(NULL,1,2), count(*), count(), row_number() OVER (),
    json_array(), json_object(), char(), printf(), min(NULL,1)`)[0]!.rows,
  [[1, 3, "bc", "b", 1, 1, 1, 1, "[]", "{}", "", null, null]]);
});
