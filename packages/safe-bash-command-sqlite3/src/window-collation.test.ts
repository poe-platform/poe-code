import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const { declaration, expression, counts, ranks } of [
  { declaration: "", expression: "k COLLATE NOCASE", counts: [2, 2, 1, 1, 2, 2, 1], ranks: [3, 3, 4, 5, 2, 2, 1] },
  { declaration: "COLLATE NOCASE", expression: "k", counts: [2, 2, 1, 1, 2, 2, 1], ranks: [3, 3, 4, 5, 2, 2, 1] },
  { declaration: "COLLATE NOCASE", expression: "k COLLATE BINARY", counts: [1, 1, 1, 1, 2, 2, 1], ranks: [4, 3, 5, 6, 2, 2, 1] }
]) {
  test(`window partitioning and ranking: ${declaration} / ${expression}`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(id INTEGER PRIMARY KEY,k ${declaration});
      INSERT INTO t VALUES(1,'a'),(2,'A'),(3,'b'),(4,x'61'),(5,1),(6,1.0),(7,NULL);`);
    assert.deepEqual(db.exec(`SELECT count(*) OVER(PARTITION BY ${expression}) FROM t ORDER BY id`)[0]!.rows, counts.map(v => [v]));
    assert.deepEqual(db.exec(`SELECT dense_rank() OVER(ORDER BY ${expression}) FROM t ORDER BY id`)[0]!.rows, ranks.map(v => [v]));
  });
}

for (const frame of ["", "RANGE BETWEEN CURRENT ROW AND CURRENT ROW", "GROUPS BETWEEN CURRENT ROW AND CURRENT ROW"]) {
  test(`NOCASE window peers and frames: ${frame || "default"}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(id,k); INSERT INTO t VALUES(1,'a'),(2,'A'),(3,'b');");
    assert.deepEqual(db.exec(`SELECT rank() OVER w, dense_rank() OVER w, count(*) OVER w
      FROM t WINDOW w AS (ORDER BY k COLLATE NOCASE ${frame}) ORDER BY id`)[0]!.rows,
      [[1, 1, 2], [1, 1, 2], [3, 2, frame ? 1 : 3]]);
  });
}

test("window partition keys apply each collation without changing stored values", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id,k,s); INSERT INTO t VALUES(1,'a','x '),(2,'A','x'),(3,'a','X'),(4,'é','x'),(5,'É','x');");
  assert.deepEqual(db.exec(`SELECT k, count(*) OVER(PARTITION BY k COLLATE NOCASE, s COLLATE RTRIM)
    FROM t ORDER BY id`)[0]!.rows, [["a", 2], ["A", 2], ["a", 1], ["é", 1], ["É", 1]]);
});
