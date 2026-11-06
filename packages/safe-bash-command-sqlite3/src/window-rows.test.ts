import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

test("last_value returns NULL for an empty preceding ROWS frame", async () => {
  const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);";
  const frame = "ORDER BY id ROWS BETWEEN 2 PRECEDING AND 1 PRECEDING";
  const sql = `SELECT last_value(id) OVER(${frame}), count(*) OVER(${frame}) FROM t ORDER BY id`;
  const expected = [[null,0],[1,1],[2,2],[3,2],[4,2],[5,2],[6,2]];
  const db = new SqliteDatabase();
  db.exec(setup);
  assert.deepEqual(db.exec(sql)[0]!.rows, expected);
  assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
  assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), "|0\n1|1\n2|2\n3|2\n4|2\n5|2\n6|2\n");
});

for (const offset of ["(1+1)", "1+1", "CAST(2 AS INTEGER)", "'2'", "2.0"]) {
  test(`ROWS evaluates constant offset ${offset}`, async () => {
    const setup = "CREATE TABLE t(id); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);";
    const sql = `SELECT count(*) OVER(ORDER BY id ROWS ${offset} PRECEDING) FROM t ORDER BY id`;
    const db = new SqliteDatabase();
    db.exec(setup);
    const expected = [[1],[2],[3],[3],[3],[3],[3]];
    assert.deepEqual(db.exec(sql)[0]!.rows, expected);
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), "1\n2\n3\n3\n3\n3\n3\n");
  });
}

for (const bound of ["-1 PRECEDING", "1.5 PRECEDING", "NULL PRECEDING", "'2x' PRECEDING", "'0x2' PRECEDING", "BETWEEN 1 PRECEDING AND 1.5 FOLLOWING", "id PRECEDING", "abs(2) PRECEDING", "(SELECT 2) PRECEDING", "BETWEEN CURRENT ROW AND 1 PRECEDING", "BETWEEN CURRENT ROW AND 0 PRECEDING", "BETWEEN 0 FOLLOWING AND CURRENT ROW", "UNBOUNDED FOLLOWING", "BETWEEN CURRENT ROW AND UNBOUNDED PRECEDING"]) {
  test(`ROWS rejects invalid bound ${bound}`, async () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(id); INSERT INTO t VALUES(1),(2);");
    const sql = `SELECT count(*) OVER(ORDER BY id ROWS ${bound}) FROM t`;
    assert.throws(() => db.exec(sql));
    await assert.rejects(() => db.executeStatementAsync(sql, new AbortController().signal));
    assert.equal(evalSyncSqlite3(undefined, [":memory:", "CREATE TABLE t(id); INSERT INTO t VALUES(1);", sql]), undefined);
  });
}

for (const type of ["ROWS", "RANGE", "GROUPS"]) {
  test(`${type} evaluates both bounds and bound parameters`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(id); INSERT INTO t VALUES(1),(2),(3),(4);");
    const sql = `SELECT count(*) OVER(ORDER BY id ${type} BETWEEN (? + 1) PRECEDING AND (2 - 1) FOLLOWING) FROM t ORDER BY id`;
    assert.deepEqual(db.exec(sql, [1])[0]!.rows, [[2],[3],[4],[3]]);
    assert.deepEqual(db.exec(sql, [0])[0]!.rows, [[2],[3],[3],[2]]);
  });
}

test("ROWS permits empty frames with bounds in the same direction", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id); INSERT INTO t VALUES(1),(2),(3);");
  assert.deepEqual(db.exec("SELECT count(*) OVER(ORDER BY id ROWS BETWEEN 1 PRECEDING AND 2 PRECEDING) FROM t")[0]!.rows,
    [[0],[0],[0]]);
});

test("sqlite3 command reports ROWS results and invalid-bound failures", async () => {
  for (const [bound, expected] of [
    ["(1+1) PRECEDING", "1\n2\n3\n3\n3\n3\n3\n"],
    ["-1 PRECEDING", undefined],
    ["1.5 PRECEDING", undefined],
    ["BETWEEN CURRENT ROW AND 1 PRECEDING", undefined]
  ] as const) {
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const args = createCommandArguments([":memory:",
      "CREATE TABLE t(id); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);",
      `SELECT count(*) OVER(ORDER BY id ROWS ${bound}) FROM t ORDER BY id`]).args;
    const result = await createSqlite3Command().execute({
      command: "sqlite3", args, stdin: stdin.readable, stdout: stdout.writable,
      stderr: stderr.writable, fs: createMemoryFileSystem(), cwd: "/", env: {},
      signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, expected === undefined ? 1 : 0);
    assert.equal(Buffer.from(await output).toString(), expected ?? "");
    const error = Buffer.from(await errors).toString();
    if (expected === undefined) assert.ok(error.includes("frame"), error);
    else assert.equal(error, "");
  }
});
