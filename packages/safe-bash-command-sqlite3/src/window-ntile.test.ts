import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2),(3),(4),(5),(6),(7);";

for (const [buckets, partition, values] of [
  [5, "", [1, 1, 2, 2, 3, 4, 5]],
  [10, "", [1, 2, 3, 4, 5, 6, 7]],
  [3, "", [1, 1, 1, 2, 2, 3, 3]],
  [1, "", [1, 1, 1, 1, 1, 1, 1]],
  [7, "", [1, 2, 3, 4, 5, 6, 7]],
  [2, "PARTITION BY id % 2", [1, 1, 1, 1, 2, 2, 2]],
] as const) {
  test(`ntile(${buckets}) distributes larger buckets first ${partition}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT ntile(${buckets}) OVER(${partition} ORDER BY id) FROM t ORDER BY id`;
    const expected = values.map(value => [value]);
    assert.deepEqual(db.exec(sql)[0]!.rows, expected);
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup, sql]), values.join("\n") + "\n");
  });
}
