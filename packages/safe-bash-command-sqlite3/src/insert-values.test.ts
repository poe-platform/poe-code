import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";

for (const [schema, insert, message] of [
  ["a", "INSERT INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"],
  ["a,b", "INSERT INTO t VALUES(1)", "table t has 2 columns but 1 values were supplied"],
  ["a,b", "INSERT INTO t(a) VALUES(1,2)", "2 values for 1 columns"],
  ["a,b", "INSERT INTO t(a,b) VALUES(1)", "1 values for 2 columns"],
  ["a", "INSERT INTO t VALUES(1,2),(3,4)", "table t has 1 columns but 2 values were supplied"],
  ["a", "INSERT OR IGNORE INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"],
  ["a", "REPLACE INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"]
]) {
  test(`rejects mismatched values: ${insert}`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(${schema})`);
    assert.throws(() => db.exec(insert!), { message: `in prepare, ${message}` });
    assert.deepEqual(db.exec("SELECT count(*) FROM t")[0]!.rows, [[0]]);
  });
}

test("valid VALUES, explicit subsets and DEFAULT VALUES still insert", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a DEFAULT 7,b DEFAULT 8); INSERT INTO t VALUES(1,2),(3,4); INSERT INTO t(b) VALUES(5); INSERT INTO t DEFAULT VALUES;");
  assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, [[1,2], [3,4], [7,5], [7,8]]);
});

test("sqlite3 stops before SELECT and reports the INSERT count error", async () => {
  const stdin = createBytePipe();
  await stdin.close();
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const result = await createSqlite3Command().execute({
    command: "sqlite3",
    args: createCommandArguments([":memory:", "create table t(a); insert into t values(1,2); select count(*) from t;"]).args,
    stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
    fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal
  });
  await stdout.close();
  await stderr.close();
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(await output).toString(), "");
  assert.equal(Buffer.from(await errors).toString(), "Error: in prepare, table t has 1 columns but 2 values were supplied\n");
});
