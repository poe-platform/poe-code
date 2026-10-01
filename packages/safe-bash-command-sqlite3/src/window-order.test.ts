import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

// Pinned to SQLite 3.43.2's traversal, not an SQL ordering guarantee.
const source = "FROM (SELECT 10 AS x UNION ALL SELECT 20 UNION ALL SELECT 30)";
for (const [sql, rows] of [
  [`SELECT row_number() OVER (ORDER BY x DESC), x ${source}`, [[1, 30], [2, 20], [3, 10]]],
  [`SELECT row_number() OVER (ORDER BY x DESC), x ${source} LIMIT 1 OFFSET 0`, [[1, 30]]],
  [`SELECT row_number() OVER (ORDER BY x DESC), x ${source} ORDER BY x`, [[3, 10], [2, 20], [1, 30]]],
  [`SELECT row_number() OVER (ORDER BY x DESC), row_number() OVER (ORDER BY x), x ${source}`, [[1, 3, 30], [2, 2, 20], [3, 1, 10]]],
  [`SELECT coalesce(lag(x) OVER (ORDER BY x DESC), 0), x ${source}`, [[0, 30], [30, 20], [20, 10]]],
  [`SELECT row_number() OVER (), x ${source}`, [[1, 10], [2, 20], [3, 30]]],
  ["WITH t(p,x) AS (VALUES(2,10),(1,30),(2,20),(1,40)) SELECT row_number() OVER (PARTITION BY p ORDER BY x DESC),p,x FROM t", [[1, 1, 40], [2, 1, 30], [1, 2, 20], [2, 2, 10]]],
  ["WITH t(x) AS (VALUES(2),(NULL),(1),(2)) SELECT rank() OVER (ORDER BY x),x FROM t", [[1, null], [2, 1], [3, 2], [3, 2]]],
  ["WITH t(g,x) AS (VALUES('a',1),('b',2),('b',3)) SELECT row_number() OVER (ORDER BY sum(x) DESC),g,sum(x) FROM t GROUP BY g", [[1, "b", 5], [2, "a", 1]]],
] as const) {
  test(`SQLite 3.43.2 window traversal: ${sql}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(sql)[0]!.rows, rows);
  });
}
