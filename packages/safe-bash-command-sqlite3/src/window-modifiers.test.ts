import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";
import { SqliteDatabase } from "./engine.js";

const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER,k INTEGER);";
const data = "INSERT INTO t VALUES(1,1637,1),(2,560,0),(3,1072,1),(4,976,0),(5,1795,1),(6,2584,2),(7,1103,1);";

for (const rows of ["", data]) {
  for (const expression of [
    "count(DISTINCT k)", "sum(DISTINCT n)", "first_value(DISTINCT n)"
  ]) {
    test(`rejects window DISTINCT: ${expression}, empty=${!rows}`, async () => {
      const db = new SqliteDatabase();
      db.exec(setup + rows);
      const sql = `SELECT ${expression} OVER(ORDER BY id) FROM t`;
      const error = { message: "DISTINCT is not supported for window functions" };
      assert.throws(() => db.exec(sql), error);
      await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), error);
    });
  }

  for (const expression of [
    "row_number()", "rank()", "dense_rank()", "percent_rank()", "cume_dist()",
    "ntile(2)", "lag(n)", "lead(n)", "first_value(n)", "last_value(n)", "nth_value(n,2)"
  ]) {
    test(`rejects nonaggregate window FILTER: ${expression}, empty=${!rows}`, async () => {
      const db = new SqliteDatabase();
      db.exec(setup + rows);
      const sql = `SELECT ${expression} FILTER(WHERE k=1) OVER(ORDER BY id) FROM t`;
      const error = { message: "FILTER clause may only be used with aggregate window functions" };
      assert.throws(() => db.exec(sql), error);
      await assert.rejects(db.executeStatementAsync(sql, new AbortController().signal), error);
    });
  }
}

test("preserves aggregate window FILTER and ordinary DISTINCT aggregates", async () => {
  const db = new SqliteDatabase();
  db.exec(setup + data);
  const sql = "SELECT sum(n) FILTER(WHERE k=1) OVER(ORDER BY id) FROM t ORDER BY id";
  const expected = [1637,1637,2709,2709,4504,4504,5607].map(value => [value]);
  assert.deepEqual(db.exec(sql)[0]!.rows, expected);
  assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
  assert.deepEqual(db.exec("SELECT count(DISTINCT k),sum(n) FILTER(WHERE k=1) FROM t")[0]!.rows, [[3,5607]]);
});


for (const [expression, error] of [
  ["count(DISTINCT k)", "DISTINCT is not supported for window functions"],
  ["row_number() FILTER(WHERE k=1)", "FILTER clause may only be used with aggregate window functions"],
  ["sum(n) FILTER(WHERE k=1)", ""]
]) {
  test(`sqlite3 command window modifier: ${expression}`, async () => {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3",
      args: createCommandArguments([":memory:", setup + data,
        `SELECT ${expression} OVER(ORDER BY id) FROM t ORDER BY id`]).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, error ? 1 : 0);
    assert.equal(Buffer.from(await output).toString(), error ? "" : "1637\n1637\n2709\n2709\n4504\n4504\n5607\n");
    const diagnostic = Buffer.from(await errors).toString();
    if (error) assert.ok(diagnostic.includes(error), diagnostic);
    else assert.equal(diagnostic, "");
  });
}
