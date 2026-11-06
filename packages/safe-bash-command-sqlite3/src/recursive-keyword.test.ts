import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

for (const keyword of ["", "RECURSIVE "]) {
  for (const union of ["UNION", "UNION ALL"]) {
    test(`WITH ${keyword}supports recursive ${union}`, () => {
      const sql = `WITH ${keyword}c(n) AS (VALUES(1) ${union} SELECT n+1 FROM c WHERE n<3) SELECT * FROM c;`;
      assert.deepEqual(new SqliteDatabase(200).exec(sql)[0]!.rows, [[1], [2], [3]]);
      assert.equal(evalSyncSqlite3(new Uint8Array(), [":memory:", sql]), "1\n2\n3\n");
    });
  }

  test(`WITH ${keyword}keeps ordinary compound CTEs nonrecursive`, () => {
    const db = new SqliteDatabase(20);
    assert.deepEqual(db.exec(`WITH ${keyword}c(n) AS (SELECT 'c' UNION ALL SELECT 'c') SELECT * FROM c`)[0]!.rows, [["c"], ["c"]]);
    assert.deepEqual(db.exec(`WITH ${keyword}c(n) AS (SELECT 1 AS c UNION ALL SELECT 2 AS c) SELECT * FROM c`)[0]!.rows, [[1], [2]]);
  });

  test(`WITH ${keyword}supports quoted recursive sources and preceding CTEs`, () => {
    const db = new SqliteDatabase(20);
    assert.deepEqual(db.exec(`WITH ${keyword}seed(n) AS (VALUES(1)), "Walk"(n) AS
      (SELECT n FROM seed UNION ALL SELECT w.n+1 FROM seed, "Walk" AS w WHERE w.n<3)
      SELECT * FROM "Walk"`)[0]!.rows, [[1], [2], [3]]);
    assert.throws(() => db.exec(`WITH ${keyword}c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c) SELECT * FROM c`), /maxRows/);
  });
}
