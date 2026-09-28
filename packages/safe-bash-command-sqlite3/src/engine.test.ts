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

for (const alias of ["AS u", "u"]) {
  test(`mutation aliases preserve predicates and bindings: ${alias}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a INT, b INT); INSERT INTO t VALUES (1, 10), (2, 20), (3, 30)");
    db.exec(`DELETE FROM t ${alias} WHERE u.a = 999`);
    assert.deepEqual(db.exec("SELECT a FROM t")[0]!.rows, [[1], [2], [3]]);
    db.exec(`UPDATE t ${alias} SET b = u.b + 1 WHERE u.a = 2`);
    assert.deepEqual(db.exec("SELECT b FROM t")[0]!.rows, [[10], [21], [30]]);
    db.exec(`DELETE FROM t ${alias} WHERE u.a = 2`);
    assert.deepEqual(db.exec("SELECT a FROM t")[0]!.rows, [[1], [3]]);
  });
}

for (const sql of [
  "WITH c(v) AS (SELECT 42) UPDATE t SET a = (SELECT v FROM c) WHERE a = (SELECT v - 41 FROM c) RETURNING a",
  "WITH c(v) AS (SELECT 1) DELETE FROM t WHERE a = (SELECT v FROM c) RETURNING a + (SELECT v + 40 FROM c)",
  "WITH c(v) AS (SELECT 41) INSERT INTO t VALUES (1) RETURNING a + (SELECT v FROM c)",
]) {
  test(`mutation evaluates CTE scope: ${sql}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a INT); INSERT INTO t VALUES (1)");
    assert.deepEqual(db.exec(sql)[0]!.rows, [[42]]);
  });
}

for (const sql of [
  "INSERT INTO t VALUES (7) RETURNING t.a, rowid, _rowid_, oid, t.rowid, t._rowid_, t.oid",
  "UPDATE t SET a = 7 RETURNING t.a, rowid, _rowid_, oid, t.rowid, t._rowid_, t.oid",
  "DELETE FROM t RETURNING t.a, rowid, _rowid_, oid, t.rowid, t._rowid_, t.oid",
]) {
  test(`RETURNING binds qualified columns and rowid aliases: ${sql}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a INT)");
    if (!sql.startsWith("INSERT")) db.exec("INSERT INTO t VALUES (7)");
    assert.deepEqual(db.exec(sql)[0]!.rows, [[7, 1, 1, 1, 1, 1, 1]]);
  });
}

for (const [expr, expected] of [
  ["9007199254740993 + 1", 9007199254740994n],
  ["9007199254740993 - 1", 9007199254740992n],
  ["9007199254740993 * 3", 27021597764222979n],
  ["9007199254740993 / 3", 3002399751580331],
  ["9007199254740993 % 2", 1],
  ["-9007199254740993", -9007199254740993n],
  ["CAST('9007199254740993' AS INTEGER)", 9007199254740993n],
  ["CAST(9007199254740993 AS INTEGER)", 9007199254740993n],
  ["CAST('9223372036854775808' AS INTEGER)", 9223372036854775807n],
  ["CAST('-9223372036854775809' AS INTEGER)", -9223372036854775808n],
  ["CAST('123e5' AS INTEGER)", 123],
] as const) {
  test(`exact integer expression: ${expr}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(`SELECT ${expr}`)[0]!.rows, [[expected]]);
  });
}

test("SUM retains int64 precision and reports integer overflow", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(x INT); INSERT INTO t VALUES ('9007199254740993'), (1)");
  assert.deepEqual(db.exec("SELECT SUM(x) FROM t")[0]!.rows, [[9007199254740994n]]);
  db.exec("DELETE FROM t; INSERT INTO t VALUES (9223372036854775807), (1)");
  assert.throws(() => db.exec("SELECT SUM(x) FROM t"), /integer overflow/);
});

test("integer arithmetic promotes overflow to REAL and handles division by zero", () => {
  const db = new SqliteDatabase();
  assert.deepEqual(db.exec("SELECT typeof(9223372036854775807 + 1), typeof(9223372036854775807 * 2), typeof(-9223372036854775808 / -1), 9007199254740993 / 0, 9007199254740993 % 0")[0]!.rows,
    [["real", "real", "real", null, null]]);
});

test("RETURNING respects declared rowid alias columns including NULL", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(rowid INT, _rowid_ INT, oid INT)");
  assert.deepEqual(db.exec("INSERT INTO t VALUES (NULL, 7, 8) RETURNING rowid, _rowid_, oid")[0]!.rows, [[null, 7, 8]]);
});

test("SUM DISTINCT accepts exact int64 values", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(x INT); INSERT INTO t VALUES (9007199254740993), (9007199254740993), (1)");
  assert.deepEqual(db.exec("SELECT SUM(DISTINCT x) FROM t")[0]!.rows, [[9007199254740994n]]);
});

test("malformed DELETE alias is rejected before removing rows", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a INT); INSERT INTO t VALUES (1)");
  assert.throws(() => db.exec("DELETE FROM t AS"), /syntax error/);
  assert.deepEqual(db.exec("SELECT a FROM t")[0]!.rows, [[1]]);
});

for (const [expr, expected] of [
  ["'9007199254740993' + 1", 9007199254740994n],
  ["-9007199254740993 / 2", -4503599627370496],
  ["-9007199254740993 % 2", -1],
  ["9007199254740993 + NULL", null],
  ["typeof(9007199254740993 + 1.0)", "real"],
  ["typeof('9007199254740993.0' + 1)", "real"],
] as const) {
  test(`integer coercion and mixed arithmetic: ${expr}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(`SELECT ${expr}`)[0]!.rows, [[expected]]);
  });
}
