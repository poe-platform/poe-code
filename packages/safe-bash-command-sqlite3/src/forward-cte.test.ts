import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

for (const keyword of ["", "RECURSIVE "]) {
  test(`WITH ${keyword}resolves forward CTE references`, () => {
    const sql = `WITH ${keyword}a AS (SELECT n FROM b), b(n) AS (VALUES(7)) SELECT * FROM a;`;
    assert.deepEqual(new SqliteDatabase(200).exec(sql)[0]!.rows, [[7]]);
    assert.equal(evalSyncSqlite3(new Uint8Array(), [":memory:", sql]), "7\n");
  });
}

test("forward CTE chains resolve through subqueries and joins", () => {
  const db = new SqliteDatabase(200);
  assert.deepEqual(db.exec(`WITH a AS (SELECT (SELECT n FROM b) AS n),
    b AS (SELECT c.n FROM c JOIN d ON c.n=d.n), d(n) AS (VALUES(7)),
    c AS (SELECT n FROM d) SELECT a.n,b.n FROM a,b`)[0]!.rows, [[7, 7]]);
});

test("forward definitions shadow outer CTEs and nested definitions stay local", () => {
  const db = new SqliteDatabase(200);
  assert.deepEqual(db.exec(`WITH b(n) AS (VALUES(1))
    SELECT (WITH a AS (SELECT n FROM b), b(n) AS (VALUES(7)) SELECT n FROM a),
      (SELECT n FROM b)`)[0]!.rows, [[7, 1]]);
});

test("recursive CTEs can use a later seed definition", () => {
  assert.deepEqual(new SqliteDatabase(200).exec(`WITH RECURSIVE
    a(n) AS (SELECT n FROM seed UNION ALL SELECT n+1 FROM a WHERE n<3),
    seed(n) AS (VALUES(1)) SELECT * FROM a`)[0]!.rows, [[1], [2], [3]]);
});

test("mutually dependent CTEs report a circular reference", () => {
  assert.throws(() => new SqliteDatabase(200).exec(
    "WITH a AS (SELECT * FROM b), b AS (SELECT * FROM a) SELECT * FROM a"
  ), /circular reference: a/);
});
