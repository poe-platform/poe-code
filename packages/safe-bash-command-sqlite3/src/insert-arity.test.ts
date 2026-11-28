import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const [columns, insert, message] of [
  ["a", "INSERT INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"],
  ["a,b", "INSERT INTO t VALUES(1)", "table t has 2 columns but 1 values were supplied"],
  ["a,b", "INSERT INTO t(a) VALUES(1,2)", "2 values for 1 columns"],
  ["a,b", "INSERT INTO t(a,b) VALUES(1)", "1 values for 2 columns"],
  ["a", "INSERT OR IGNORE INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"],
  ["a", "REPLACE INTO t VALUES(1,2)", "table t has 1 columns but 2 values were supplied"],
  ["a", "INSERT INTO t VALUES(1),(2,3)", "all VALUES must have the same number of terms"],
  ["a,b", "INSERT INTO t VALUES(1,2),(3)", "all VALUES must have the same number of terms"],
  ["a", "INSERT INTO t SELECT 1,2", "table t has 1 columns but 2 values were supplied"],
  ["a", "INSERT INTO t SELECT 1,2 WHERE 0", "table t has 1 columns but 2 values were supplied"]
]) {
  test(`INSERT rejects a column-count mismatch: ${insert}`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(${columns})`);
    assert.throws(() => db.exec(insert!), { message: `in prepare, ${message}` });
    assert.deepEqual(db.exec("SELECT count(*) FROM t")[0]!.rows, [[0]]);
  });
}

test("INSERT preserves matching rows, explicit subsets, and defaults", () => {
  const db = new SqliteDatabase();
  db.exec(`CREATE TABLE t(a DEFAULT 7,b DEFAULT 8);
    INSERT INTO t VALUES(1,2),(3,4);
    INSERT INTO t(a) VALUES(5);
    INSERT INTO t DEFAULT VALUES;
    INSERT INTO t SELECT 9,10`);
  assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, [[1,2], [3,4], [5,8], [7,8], [9,10]]);
});

test("INSERT counts only writable columns when generated columns are present", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a,b AS (a+1)); INSERT INTO t VALUES(1)");
  assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, [[1,2]]);
});
