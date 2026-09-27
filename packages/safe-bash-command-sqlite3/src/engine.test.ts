import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const functionName of ["json_each", "json_tree"]) {
  test(`empty correlated ${functionName} join retains its schema`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE empty_tbl(id INT, col TEXT)");
    const result = db.exec(`SELECT * FROM empty_tbl JOIN ${functionName}(empty_tbl.col)`)[0]!;
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.columns, ["id", "col", "key", "value", "type", "atom", "id", "parent", "fullkey", "path"]);
    assert.throws(() => db.exec(`SELECT * FROM empty_tbl JOIN ${functionName}(empty_tbl.bad_col)`), /no such column/);
  });
}

for (const sql of [
  "WITH RECURSIVE c(x) AS (SELECT 1 WHERE 0 UNION ALL SELECT bad_col FROM c) SELECT * FROM c",
  "UPDATE empty_tbl SET id = bad_col",
  "UPDATE empty_tbl SET missing = 1",
  "UPDATE empty_tbl SET id = 1 WHERE bad_col",
  "UPDATE empty_tbl SET id = (SELECT bad_col)",
  "UPDATE empty_tbl SET id = 1 RETURNING bad_col",
  "DELETE FROM empty_tbl WHERE bad_col",
  "DELETE FROM empty_tbl WHERE id = (SELECT bad_col)",
  "DELETE FROM empty_tbl RETURNING bad_col",
  "DELETE FROM empty_tbl RETURNING (SELECT bad_col)",
  "UPDATE empty_tbl SET id = 1 RETURNING (SELECT bad_col)",
  "SELECT (SELECT id FROM empty_tbl LIMIT (SELECT bad_col)) WHERE 0",
  "SELECT (SELECT id FROM empty_tbl LIMIT 1 OFFSET (SELECT bad_col)) WHERE 0",
  "SELECT (SELECT id FROM empty_tbl LIMIT (SELECT bad_col), 1) WHERE 0",
]) {
  test(`prepares unvisited expressions: ${sql}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE empty_tbl(id INT, col TEXT)");
    assert.throws(() => db.exec(sql), /no such column/);
  });
}

for (const write of [
  "INSERT INTO aff VALUES ('9007199254740993', '9223372036854775807', '-9223372036854775808')",
  "INSERT INTO aff VALUES (0, 0, 0); INSERT INTO aff VALUES (0, 0, 0) ON CONFLICT(i) DO UPDATE SET i = '9007199254740993', n = '9223372036854775807', m = '-9223372036854775808'",
  "INSERT INTO aff VALUES (0, 0, 0); UPDATE aff SET i = '9007199254740993', n = '9223372036854775807', m = '-9223372036854775808'",
]) {
  test(`preserves signed 64-bit affinity: ${write}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE aff(i INT UNIQUE, n NUMERIC, m INT)");
    db.exec(write);
    assert.deepEqual(db.exec("SELECT i, typeof(i), n, typeof(n), m, typeof(m) FROM aff")[0]!.rows,
      [[9007199254740993n, "integer", 9223372036854775807n, "integer", -9223372036854775808n, "integer"]]);
  });
}

test("invalid RETURNING is rejected before writes", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INT); INSERT INTO t VALUES (1)");
  assert.throws(() => db.exec("UPDATE t SET id = 2 RETURNING bad_col"), /no such column/);
  assert.throws(() => db.exec("DELETE FROM t RETURNING bad_col"), /no such column/);
  assert.deepEqual(db.exec("SELECT id FROM t")[0]!.rows, [[1]]);
});

test("empty left input preserves ordinary RIGHT JOIN rows", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE a(id INT); CREATE TABLE b(id INT); INSERT INTO b VALUES (2)");
  assert.deepEqual(db.exec("SELECT a.id, b.id FROM a RIGHT JOIN b ON a.id = b.id")[0]!.rows, [[null, 2]]);
});

test("valid recursive, write and limit expressions still execute", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INT); INSERT INTO t VALUES (1)");
  assert.deepEqual(db.exec("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3) SELECT * FROM c")[0]!.rows, [[1], [2], [3]]);
  assert.deepEqual(db.exec("UPDATE t SET id = id + 1 RETURNING id")[0]!.rows, [[2]]);
  assert.deepEqual(db.exec("SELECT (SELECT id FROM t LIMIT (SELECT 1) OFFSET (SELECT 0))")[0]!.rows, [[2]]);
  assert.deepEqual(db.exec("DELETE FROM t WHERE id = 2 RETURNING id")[0]!.rows, [[2]]);
});

test("affinity retains real, out-of-range and nonnumeric storage classes", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(n NUMERIC, r REAL); INSERT INTO t VALUES ('9223372036854775808', '9007199254740993'); INSERT INTO t VALUES ('abc', 'abc'); INSERT INTO t VALUES ('3.0e+5', '3.0e+5')");
  assert.deepEqual(db.exec("SELECT typeof(n), typeof(r) FROM t")[0]!.rows, [["real", "real"], ["text", "text"], ["integer", "real"]]);
});

test("empty left input preserves uncorrelated RIGHT JOIN TVF rows", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INT)");
  assert.deepEqual(db.exec("SELECT t.id, j.value FROM t RIGHT JOIN json_each('[2]') AS j ON 1")[0]!.rows, [[null, 2]]);
});
