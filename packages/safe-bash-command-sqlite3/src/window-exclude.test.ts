import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER,k INTEGER);
  INSERT INTO t VALUES(1,1637,1),(2,560,0),(3,1072,1),(4,976,0),(5,1795,1),(6,2584,2),(7,1103,1);`;

for (const [exclude, expected] of [
  ["NO OTHERS", [7,7,7,7,7,7,7]],
  ["CURRENT ROW", [6,6,6,6,6,6,6]],
  ["GROUP", [3,5,3,5,3,6,3]],
  ["TIES", [4,6,4,6,4,7,4]],
] as const) {
  for (const type of ["ROWS", "RANGE", "GROUPS"]) {
    test(`${type} EXCLUDE ${exclude} counts only included rows`, async () => {
      const db = new SqliteDatabase();
      db.exec(setup);
      const sql = `SELECT count(*) OVER(ORDER BY k ${type} BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING EXCLUDE ${exclude}) FROM t ORDER BY id`;
      assert.deepEqual(db.exec(sql)[0]!.rows, expected.map(n => [n]));
      assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected.map(n => [n]));
      assert.equal(evalSyncSqlite3(undefined, [":memory:", setup + sql]), expected.join("\n") + "\n");
    });
  }
}

test("running sum excludes the current row, including an empty first frame", () => {
  const db = new SqliteDatabase();
  db.exec(setup);
  assert.deepEqual(db.exec(`SELECT sum(n) OVER(ORDER BY id ROWS UNBOUNDED PRECEDING EXCLUDE CURRENT ROW) FROM t ORDER BY id`)[0]!.rows,
    [[null],[1637],[2197],[3269],[4245],[6040],[8624]]);
});

test("exclusion applies to value functions but not ranking or lag", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id,k); INSERT INTO t VALUES(1,1),(2,1),(3,2);");
  const frame = "ORDER BY k ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW EXCLUDE GROUP";
  assert.deepEqual(db.exec(`SELECT first_value(id) OVER(${frame}), last_value(id) OVER(${frame}),
    nth_value(id,2) OVER(${frame}), rank() OVER(${frame}), lag(id) OVER(${frame}) FROM t ORDER BY id`)[0]!.rows,
    [[null,null,null,1,null],[null,null,null,1,1],[1,2,2,3,2]]);
  assert.deepEqual(db.exec(`SELECT count(*) OVER(ORDER BY k ROWS BETWEEN 1 FOLLOWING AND 1 FOLLOWING EXCLUDE TIES) FROM t ORDER BY id`)[0]!.rows,
    [[0],[1],[0]]);
});

test("unordered partitions are peers and multi-column NULL peers are excluded together", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id,p,k,v); INSERT INTO t VALUES(1,1,NULL,1),(2,1,NULL,1),(3,1,NULL,2),(4,2,NULL,1);");
  const frame = "PARTITION BY p ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING";
  assert.deepEqual(db.exec(`SELECT count(*) OVER(${frame} EXCLUDE GROUP), count(*) OVER(${frame} EXCLUDE TIES),
    count(*) OVER(PARTITION BY p ORDER BY k,v ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING EXCLUDE GROUP) FROM t ORDER BY id`)[0]!.rows,
    [[0,1,1],[0,1,1],[0,1,2],[0,1,0]]);
});
