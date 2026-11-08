import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const word of ["union", "intersect", "except", "limit", "order", "join", "left", "right", "inner", "cross", "full", "natural", "on", "using"]) {
  test(`SELECT treats '${word}' as data`, () => {
    const db = new SqliteDatabase();
    assert.deepEqual(db.exec(`SELECT '${word}', 42`)[0]!.rows, [[word, 42]]);
    db.exec(`CREATE TABLE t(kind TEXT, v INT); INSERT INTO t VALUES ('${word}', 10)`);
    assert.deepEqual(db.exec(`SELECT v FROM t WHERE kind = '${word}'`)[0]!.rows, [[10]]);
    assert.deepEqual(db.exec(`SELECT 'first' UNION ALL SELECT '${word}' ORDER BY 1 LIMIT 2`)[0]!.rows,
      [["first"], [word]].sort((a, b) => a[0]!.localeCompare(b[0]!)));
  });

  test(`quoted ${word} identifiers survive clause splitting`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE "${word}"("${word}" INT); INSERT INTO "${word}" VALUES (10)`);
    assert.deepEqual(db.exec(`SELECT "${word}" FROM "${word}" UNION ALL SELECT "${word}" FROM "${word}"`)[0]!.rows, [[10], [10]]);
    assert.deepEqual(db.exec(`SELECT a."${word}" FROM "${word}" a JOIN "${word}" b ON a."${word}" = b."${word}"`)[0]!.rows, [[10]]);
  });

  test(`JOIN conditions preserve '${word}'`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(kind TEXT); INSERT INTO t VALUES ('${word}')`);
    assert.deepEqual(db.exec(`SELECT a.kind FROM t a JOIN t b ON b.kind = '${word}' JOIN t c ON c.kind = a.kind`)[0]!.rows, [[word]]);
  });
}

test("recursive CTE anchors preserve UNION literals and quoted identifiers", () => {
  const db = new SqliteDatabase();
  assert.deepEqual(db.exec("WITH RECURSIVE t(v, n) AS (SELECT 'union', 1 UNION ALL SELECT v, n + 1 FROM t WHERE n < 2) SELECT v, n FROM t")[0]!.rows,
    [["union", 1], ["union", 2]]);
  assert.deepEqual(db.exec('WITH RECURSIVE t("union") AS (SELECT 1 UNION ALL SELECT "union" + 1 FROM t WHERE "union" < 2) SELECT "union" FROM t')[0]!.rows,
    [[1], [2]]);
});
