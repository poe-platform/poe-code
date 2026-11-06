import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";
import { evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER,k INTEGER);
  INSERT INTO t VALUES(1,1637,1),(2,560,0),(3,1072,1),(4,976,0),(5,1795,1),(6,2584,2),(7,1103,1);`;

for (const [frame, expected] of [
  ["ORDER BY k RANGE CURRENT ROW", [4,2,4,2,4,1,4]],
  ["ORDER BY n RANGE BETWEEN 100 PRECEDING AND CURRENT ROW", [1,1,2,1,1,1,2]],
  ["ORDER BY k ROWS CURRENT ROW", [1,1,1,1,1,1,1]],
  ["ORDER BY k", [6,2,6,2,6,7,6]],
] as const) {
  test(`window ${frame}`, async () => {
    const db = new SqliteDatabase();
    db.exec(setup);
    const sql = `SELECT count(*) OVER(${frame}) FROM t ORDER BY id`;
    assert.deepEqual(db.exec(sql)[0]!.rows, expected.map(n => [n]));
    assert.deepEqual((await db.executeStatementAsync(sql, new AbortController().signal))!.rows, expected.map(n => [n]));
    assert.equal(evalSyncSqlite3(undefined, [":memory:", setup + sql]), expected.join("\n") + "\n");
  });
}

for (const order of ["ASC", "DESC"]) {
  test(`fractional RANGE ${order} shares bounds across window functions`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(n); INSERT INTO t VALUES(1),(2),(2),(3.5),(7);");
    const frame = `ORDER BY n ${order} RANGE BETWEEN 1.5 PRECEDING AND 1.5 FOLLOWING`;
    const rows = db.exec(`SELECT count(*) OVER(${frame}), first_value(n) OVER(${frame}),
      last_value(n) OVER(${frame}), nth_value(n,4) OVER(${frame}) FROM t ORDER BY n`)[0]!.rows;
    assert.deepEqual(rows.map(row => row.map(value => value instanceof Number ? value.valueOf() : value)), order === "ASC"
      ? [[3,1,2,null],[4,1,3.5,3.5],[4,1,3.5,3.5],[3,2,3.5,null],[1,7,7,null]]
      : [[3,2,1,null],[4,3.5,1,1],[4,3.5,1,1],[3,3.5,2,null],[1,7,7,null]]);
  });
}

test("offset RANGE requires exactly one ordering expression even on empty tables", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(k,n)");
  for (const order of ["", "ORDER BY k,n"]) {
    for (const bound of ["1 PRECEDING", "0 PRECEDING", "BETWEEN CURRENT ROW AND 1 FOLLOWING"]) {
      assert.throws(() => db.exec(`SELECT count(*) OVER(${order} RANGE ${bound}) FROM t`),
        /RANGE with offset PRECEDING\/FOLLOWING requires one ORDER BY expression/);
    }
  }
});

test("RANGE peers include nonnumeric values and all unordered rows", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(n); INSERT INTO t VALUES(NULL),(NULL),(1),('a'),('a'),('b');");
  assert.deepEqual(db.exec("SELECT count(*) OVER(ORDER BY n RANGE 1.5 PRECEDING) FROM t ORDER BY n")[0]!.rows,
    [[2],[2],[1],[2],[2],[1]]);
  assert.deepEqual(db.exec("SELECT count(*) OVER(RANGE CURRENT ROW) FROM t")[0]!.rows,
    [[6],[6],[6],[6],[6],[6]]);
});

test("RANGE following bounds allow empty frames within each partition", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(p,n); INSERT INTO t VALUES('a',1),('b',2),('a',2),('a',7);");
  const frame = "PARTITION BY p ORDER BY n RANGE BETWEEN 1 FOLLOWING AND 2 FOLLOWING";
  assert.deepEqual(db.exec(`SELECT count(*) OVER(${frame}), first_value(n) OVER(${frame}),
    last_value(n) OVER(${frame}), nth_value(n,1) OVER(${frame}) FROM t ORDER BY p,n`)[0]!.rows,
  [[1,2,2,2],[0,null,null,null],[0,null,null,null],[0,null,null,null]]);
});

test("RANGE without offsets allows multiple ordering terms and unbounded bounds", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(k,n); INSERT INTO t VALUES(1,1),(1,1),(1,2),(2,1);");
  assert.deepEqual(db.exec(`SELECT count(*) OVER(ORDER BY k,n RANGE CURRENT ROW),
    count(*) OVER(ORDER BY k,n RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING),
    count(*) OVER(ORDER BY k,n RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    FROM t ORDER BY k,n`)[0]!.rows, [[2,4,2],[2,4,2],[1,2,3],[1,1,4]]);
});
