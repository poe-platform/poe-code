import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

for (const fn of ["lag", "lead"]) {
  for (const [offset, expected] of [
    ["1.5", [99, 99, 99]],
    ["-1.5", [99, 99, 99]],
    ["NULL", [99, 99, 99]],
    ["0", [1, 2, 3]],
    ["1.0", fn === "lag" ? [99, 1, 2] : [2, 3, 99]],
    ["-1", fn === "lag" ? [2, 3, 99] : [99, 1, 2]],
  ] as const) {
    test(`${fn} preserves SQLite offset semantics for ${offset}`, async () => {
      const sql = `WITH t(id) AS (VALUES(1),(2),(3))
        SELECT ${fn}(id,${offset},99) OVER(ORDER BY id) FROM t ORDER BY id`;
      const db = new SqliteDatabase();
      assert.deepEqual(db.exec(sql)[0]!.rows, expected.map(value => [value]));
      assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows,
        expected.map(value => [value]));
      assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), expected.join("\n") + "\n");
    });
  }

  test(`${fn} uses NULL when an invalid offset has no default`, () => {
    const sql = `WITH t(id) AS (VALUES(1),(2),(3))
      SELECT ${fn}(id,NULL) OVER(ORDER BY id), ${fn}(id,1.5) OVER(ORDER BY id) FROM t`;
    assert.deepEqual(new SqliteDatabase().exec(sql)[0]!.rows,
      [[null, null], [null, null], [null, null]]);
  });
}
