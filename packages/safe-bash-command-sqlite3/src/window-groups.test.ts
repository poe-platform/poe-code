import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER,k INTEGER);
  INSERT INTO t VALUES(1,1637,1),(2,560,0),(3,1072,1),(4,976,0),(5,1795,1),(6,2584,2),(7,1103,1);`;

for (const [frame, expected] of [
  ["ORDER BY k GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW", [7143,1536,7143,1536,7143,8191,7143]],
  ["ORDER BY k DESC GROUPS BETWEEN CURRENT ROW AND 1 FOLLOWING", [7143,1536,7143,1536,7143,8191,7143]],
  ["ORDER BY k GROUPS CURRENT ROW", [5607,1536,5607,1536,5607,2584,5607]],
  ["ORDER BY k GROUPS BETWEEN 1 FOLLOWING AND 1 FOLLOWING", [2584,5607,2584,5607,2584,null,2584]],
  ["ORDER BY k GROUPS BETWEEN 1 PRECEDING AND 1 PRECEDING", [1536,null,1536,null,1536,5607,1536]],
  ["ORDER BY k GROUPS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING", [9727,9727,9727,9727,9727,9727,9727]],
  ["GROUPS CURRENT ROW", [9727,9727,9727,9727,9727,9727,9727]],
] as const) {
  test(`window ${frame}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT sum(n) OVER(${frame}) FROM t ORDER BY id`;
    const rows = expected.map(n => [n]);
    assert.deepEqual(db.exec(sql)[0]!.rows, rows);
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, rows);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup + sql]), expected.join("\n") + "\n");
  });
}

test("GROUPS shares partitioned multi-column peer boundaries with value functions", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(p,k,v); INSERT INTO t VALUES(1,NULL,1),(1,NULL,1),(1,2,2),(1,2,3),(2,2,9);");
  const frame = "PARTITION BY p ORDER BY k,v GROUPS BETWEEN CURRENT ROW AND 1 FOLLOWING";
  assert.deepEqual(db.exec(`SELECT count(*) OVER(${frame}), first_value(v) OVER(${frame}),
    last_value(v) OVER(${frame}), nth_value(v,2) OVER(${frame}) FROM t ORDER BY p,k,v`)[0]!.rows,
  [[3,1,2,1],[3,1,2,1],[2,2,3,3],[1,3,3,null],[1,9,9,null]]);
});
