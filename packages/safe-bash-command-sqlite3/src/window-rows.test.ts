import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

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
