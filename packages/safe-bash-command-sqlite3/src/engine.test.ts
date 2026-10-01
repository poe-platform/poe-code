import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const expression of [
  "COALESCE(NULL, 7, ABS(-9223372036854775808))",
  "IFNULL(7, ABS(-9223372036854775808))",
  "IIF(1, 7, ABS(-9223372036854775808))",
  "IIF(0, ABS(-9223372036854775808), 7)",
  "IIF(NULL, ABS(-9223372036854775808), 7)"
]) {
  test(`conditional functions skip unused branches: ${expression}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(id INT); INSERT INTO t VALUES (1), (2)");
    for (const sql of [
      `SELECT ${expression}`,
      `SELECT ${expression} FROM t GROUP BY id HAVING id = 1`,
      `SELECT ${expression} FROM t WHERE id = 1`,
      `SELECT 7 FROM t GROUP BY id HAVING id = 1 AND ${expression} = 7`,
      `SELECT FIRST_VALUE(${expression}) OVER (ORDER BY id) FROM t LIMIT 1`
    ]) {
      assert.deepEqual(db.exec(sql)[0]!.rows, [[7]], sql);
    }
  });
}

test("conditional functions still evaluate selected branches", () => {
  const db = new SqliteDatabase();
  for (const expression of [
    "COALESCE(NULL, ABS(-9223372036854775808))",
    "IFNULL(NULL, ABS(-9223372036854775808))",
    "IIF(1, ABS(-9223372036854775808), 7)",
    "IIF(0, 7, ABS(-9223372036854775808))"
  ]) {
    assert.throws(() => db.exec(`SELECT ${expression}`), { message: "integer overflow" });
  }
  assert.deepEqual(db.exec("SELECT COALESCE(NULL, NULL), IFNULL(NULL, NULL), IIF(NULL, 1, NULL), COALESCE(0, 1), IFNULL('', 1), IIF('0', 1, 2)")[0]!.rows,
    [[null, null, null, 0, "", 2]]);
  assert.deepEqual(db.exec("SELECT typeof(COALESCE(NULL, 88.0)), typeof(IFNULL(NULL, 88.0)), typeof(IIF(1, 88.0, 0)), COALESCE(NULL, 9007199254740993)")[0]!.rows,
    [["real", "real", "real", 9007199254740993n]]);
});

test("conditional functions evaluate aggregate arguments and HAVING lazily", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(g TEXT, score INT); INSERT INTO t VALUES ('a', 10), ('a', 20), ('b', NULL)");
  const result = db.exec(`SELECT g,
    COALESCE(SUM(score), 0, ABS(-9223372036854775808)),
    IFNULL(SUM(score), 0), IIF(COUNT(score) > 0, SUM(score), 0)
    FROM t GROUP BY g
    HAVING COALESCE(SUM(score), 0) >= 0 AND IFNULL(SUM(score), 0) >= 0
      AND IIF(COUNT(score) > 0, SUM(score) > 0, 1)
    ORDER BY g`)[0]!;
  assert.deepEqual(result.rows, [["a", 30, 30, 30], ["b", 0, 0, 0]]);
});

test("conditional functions resolve window ORDER BY and PARTITION BY expressions", () => {
  const db = new SqliteDatabase();
  db.exec(`CREATE TABLE t(id INT, name TEXT, score REAL);
    INSERT INTO t VALUES (1, 'Alice', 95.5), (2, 'Bob, Jr.', NULL), (3, 'Carol "C"', 88.0), (4, 'Dan', NULL)`);
  const result = db.exec(`SELECT name,
    RANK() OVER (ORDER BY COALESCE(score, 0) DESC),
    RANK() OVER (ORDER BY IFNULL(score, 0) DESC),
    RANK() OVER (ORDER BY IIF(score IS NULL, 0, score) DESC),
    COUNT(*) OVER (PARTITION BY COALESCE(score, 0)),
    COUNT(*) OVER (PARTITION BY IFNULL(score, 0)),
    COUNT(*) OVER (PARTITION BY IIF(score IS NULL, 0, score))
    FROM t ORDER BY id`)[0]!;
  assert.deepEqual(result.rows, [
    ["Alice", 1, 1, 1, 1, 1, 1], ["Bob, Jr.", 3, 3, 3, 2, 2, 2],
    ['Carol "C"', 2, 2, 2, 1, 1, 1], ["Dan", 3, 3, 3, 2, 2, 2]
  ]);
});

test("conditional functions retain both aggregate and window evaluation contexts", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INT, score INT); INSERT INTO t VALUES (1, 10), (2, NULL), (3, 20), (4, NULL)");
  const result = db.exec(`SELECT
    COALESCE(SUM(score), ROW_NUMBER() OVER (ORDER BY id)),
    IFNULL(SUM(score), LAG(id) OVER (ORDER BY id)),
    IIF(SUM(score) > 0, SUM(score), ROW_NUMBER() OVER (ORDER BY id))
    FROM t GROUP BY id ORDER BY id`)[0]!;
  assert.deepEqual(result.rows, [[10, 10, 10], [2, 1, 2], [20, 20, 20], [4, 3, 4]]);
});

test("conditional functions preserve windows nested inside casts, CASE and predicates", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INT); INSERT INTO t VALUES (1), (2), (3)");
  const result = db.exec(`SELECT
    COALESCE(CAST(LAG(id) OVER (ORDER BY id) AS INTEGER), 0),
    IFNULL(CASE WHEN id > 1 THEN LAG(id) OVER (ORDER BY id) END, 0),
    IIF(LAG(id) OVER (ORDER BY id) IS NULL, 0, id),
    IIF(ROW_NUMBER() OVER (ORDER BY id) BETWEEN 2 AND 3, id, 0),
    IIF(ROW_NUMBER() OVER (ORDER BY id) IN (2, 3), id, 0)
    FROM t ORDER BY id`)[0]!;
  assert.deepEqual(result.rows, [[0, 0, 0, 0, 0], [1, 1, 2, 2, 2], [2, 2, 3, 3, 3]]);
});

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

for (const [sql, expected] of [
  ["SELECT DISTINCT a FROM t", [[9007199254740993n], [9007199254740994n]]],
  ["SELECT a, COUNT(*) FROM t GROUP BY a", [[9007199254740993n, 2], [9007199254740994n, 1]]],
  ["SELECT COUNT(DISTINCT a) FROM t", [[2]]],
  ["SELECT a FROM t UNION SELECT a FROM t", [[9007199254740993n], [9007199254740994n]]],
  ["SELECT a FROM t INTERSECT SELECT 9007199254740993", [[9007199254740993n]]],
  ["SELECT a FROM t EXCEPT SELECT 9007199254740993", [[9007199254740994n]]],
  ["WITH RECURSIVE c(x) AS (SELECT 9007199254740993 UNION SELECT x FROM c) SELECT x FROM c", [[9007199254740993n]]],
  ["SELECT a, RANK() OVER (PARTITION BY a ORDER BY a) FROM t", [[9007199254740993n, 1], [9007199254740993n, 1], [9007199254740994n, 1]]],
  ["SELECT json_array(a), json_object('k', a) FROM t LIMIT 1", [["[9007199254740993]", '{"k":9007199254740993}']]],
  ["SELECT ABS(-9007199254740993)", [[9007199254740993n]]],
  ["SELECT 1 << 40, (1 << 40) >> 4, (1 << 40) | 1, (1 << 40) & (1 << 40)", [[1099511627776, 68719476736, 1099511627777, 1099511627776]]],
  ["SELECT 1 << 63, 1 << 64, -1 >> 64, 8 << -1, 8 >> -1, ~9223372036854775807", [[-9223372036854775808n, 0, -1, 4, 16, -9223372036854775808n]]],
] as const) {
  test(`int64 parity: ${sql}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a INT); INSERT INTO t VALUES (9007199254740993), (9007199254740993), (9007199254740994)");
    assert.deepEqual(db.exec(sql)[0]!.rows, expected);
  });
}

test("ABS rejects minimum signed integer overflow", () => {
  assert.throws(() => new SqliteDatabase().exec("SELECT ABS(-9223372036854775808)"), /integer overflow/);
});

for (const sql of [
  "INSERT INTO t AS u VALUES (1, 5) ON CONFLICT(a) DO UPDATE SET b = u.b + excluded.b WHERE u.a = 1 RETURNING t.a, t.b",
  "UPDATE t AS u SET b = u.b + s.y FROM s WHERE u.a = s.x RETURNING t.a, t.b",
]) {
  test(`mutation alias parity: ${sql}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a INT PRIMARY KEY, b INT); CREATE TABLE s(x INT, y INT); INSERT INTO t VALUES (1, 10); INSERT INTO s VALUES (1, 5)");
    assert.deepEqual(db.exec(sql)[0]!.rows, [[1, 15]]);
  });
}

test("JSON mutation functions preserve supplied int64 values", () => {
  const db = new SqliteDatabase();
  assert.deepEqual(db.exec("SELECT json_set('{}', '$.x', 9007199254740993), json_insert('[]', '$[0]', 9007199254740993), json_replace('{\"x\":0}', '$.x', 9007199254740993)")[0]!.rows,
    [['{"x":9007199254740993}', '[9007199254740993]', '{"x":9007199254740993}']]);
});

test("UPDATE FROM validates empty sources and updates each matching target once", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a INT, b INT); CREATE TABLE s(x INT, y INT); INSERT INTO t VALUES (1, 10), (2, 20)");
  assert.throws(() => db.exec("UPDATE t SET b = s.missing FROM s"), /no such column/);
  assert.throws(() => db.exec("UPDATE t SET y = 1 FROM s"), /no such column/);
  assert.deepEqual(db.exec("UPDATE t SET b = s.y FROM s RETURNING a")[0]!.rows, []);
  db.exec("INSERT INTO s VALUES (1, 5), (1, 5)");
  assert.deepEqual(db.exec("UPDATE t AS u SET b = u.b + s.y FROM s WHERE u.a = s.x RETURNING t.a, t.b")[0]!.rows, [[1, 15]]);
  assert.deepEqual(db.exec("SELECT * FROM t ORDER BY a")[0]!.rows, [[1, 15], [2, 20]]);
});

test("set and window keys equate integer and real numbers while distinguishing text", () => {
  const db = new SqliteDatabase();
  assert.equal(db.exec("SELECT 1 UNION SELECT 1.0 UNION SELECT '1'")[0]!.rows.length, 2);
  assert.deepEqual(db.exec("WITH t(a) AS (SELECT 1 UNION ALL SELECT 1.0) SELECT COUNT(DISTINCT a) FROM t")[0]!.rows, [[1]]);
});

for (const initial of ["", "INSERT INTO t VALUES (1, 2)"]) {
  for (const clause of ["SET b = missing", "SET missing = 1", "SET b = excluded.missing", "SET b = 1 WHERE missing", "SET b = (SELECT missing)"]) {
    test(`prepares UPSERT before any write: ${initial}; ${clause}`, () => {
      const db = new SqliteDatabase();
      db.exec("CREATE TABLE t(a INT PRIMARY KEY, b INT)");
      if (initial) db.exec(initial);
      const before = db.exec("SELECT * FROM t")[0]!.rows;
      assert.throws(() => db.exec(`INSERT INTO t VALUES (2, 3) ON CONFLICT(a) DO UPDATE ${clause}`), /no such column/);
      assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, before);
    });
  }
  for (const sql of [
    "SELECT (SELECT 1, 2) FROM t",
    "INSERT INTO t VALUES (2, (SELECT 1, 2))",
    "SELECT * FROM t WHERE a IN (SELECT 1, 2)",
    "SELECT * FROM t WHERE a NOT IN (SELECT 1, 2 WHERE 0)",
    "UPDATE t SET b = (SELECT 1, 2) WHERE 0",
    "DELETE FROM t WHERE a IN (SELECT 1, 2)",
    "INSERT INTO t VALUES (2, 3) ON CONFLICT(a) DO UPDATE SET b = (SELECT 1, 2)",
  ]) {
    test(`prepares scalar subquery arity: ${initial}; ${sql}`, () => {
      const db = new SqliteDatabase();
      db.exec("CREATE TABLE t(a INT PRIMARY KEY, b INT)");
      if (initial) db.exec(initial);
      assert.throws(() => db.exec(sql), /sub-select returns 2 columns - expected 1/);
    });
  }
}

test("valid UPSERT bindings and multi-column EXISTS remain supported", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a INT PRIMARY KEY, b INT); INSERT INTO t VALUES (1, 2)");
  db.exec("INSERT INTO t AS u VALUES (1, 3) ON CONFLICT(a) DO UPDATE SET b = u.b + excluded.b WHERE excluded.a = u.a");
  assert.deepEqual(db.exec("SELECT b, EXISTS(SELECT 1, 2), (SELECT b FROM t) FROM t WHERE a IN (SELECT a FROM t)")[0]!.rows, [[5, 1, 5]]);
});

for (const [sql, expected] of [
  ["WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x<10000) SELECT count(*), max(x), sum(x) FROM cnt", [[10000, 10000, 50005000]]],
  ["SELECT count(*), max(value) FROM generate_series(1,150000)", [[150000, 150000]]],
  ["SELECT length(zeroblob(100000)), length(randomblob(100000))", [[100000, 100000]]],
] as const) {
  test(`uncapped SQLite query: ${sql}`, () => {
    assert.deepEqual(new SqliteDatabase().exec(sql)[0]!.rows, expected);
  });
}

for (const alias of ['rowid', '_rowid_', 'oid']) {
  test(`explicit ${alias} insert/update preserves identity and uniqueness`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(x); INSERT INTO t(${alias}, x) VALUES (10, 'a')`);
    assert.deepEqual(db.exec('SELECT rowid, x FROM t')[0]!.rows, [[10, 'a']]);
    assert.throws(() => db.exec(`INSERT INTO t(${alias}, x) VALUES (10, 'b')`), /UNIQUE constraint failed/);
    db.exec(`UPDATE t SET ${alias} = 20 WHERE rowid = 10; INSERT INTO t(x) VALUES ('b')`);
    assert.deepEqual(db.exec('SELECT rowid, x FROM t')[0]!.rows, [[20, 'a'], [21, 'b']]);
    assert.throws(() => db.exec(`UPDATE t SET ${alias} = 20 WHERE rowid = 21`), /UNIQUE constraint failed/);
  });
}

test('rowid aliases synchronize integer primary keys and preserve shadowing', () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, x); INSERT INTO t(rowid, x) VALUES(10, 'a'); UPDATE t SET id=20");
  assert.deepEqual(db.exec('SELECT id, rowid FROM t')[0]!.rows, [[20, 20]]);
  db.exec('UPDATE t SET oid=30');
  assert.deepEqual(db.exec('SELECT id, rowid FROM t')[0]!.rows, [[30, 30]]);
  db.exec("CREATE TABLE shadow(rowid TEXT, x); INSERT INTO shadow(rowid, x) VALUES('label', 1); UPDATE shadow SET rowid='other'");
  assert.deepEqual(db.exec('SELECT rowid, _rowid_ FROM shadow')[0]!.rows, [['other', 1]]);
});
test('rowid accepts numeric text and insert NULL but rejects invalid identities', () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(x); INSERT INTO t(rowid,x) VALUES('10','a'),(NULL,'b')");
  assert.deepEqual(db.exec('SELECT rowid FROM t')[0]!.rows, [[10], [11]]);
  for (const value of ["'invalid'", '1.5']) {
    assert.throws(() => db.exec(`INSERT INTO t(rowid) VALUES(${value})`), /datatype mismatch/);
    assert.throws(() => db.exec(`UPDATE t SET rowid=${value}`), /datatype mismatch/);
  }
});

test("aggregate predicates retain SQL expression semantics", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE sales(dept TEXT, amount INT); INSERT INTO sales VALUES ('eng',100),('eng',200),('hr',50)");
  for (const [predicate, expected] of [
    ["COUNT(*) >= 2 AND SUM(amount) >= 200", [["eng"]]],
    ["COUNT(*) >= 2 OR SUM(amount) >= 50", [["eng"],["hr"]]],
    ["COUNT(*) IN (1,2)", [["eng"],["hr"]]],
    ["COUNT(*) IN (SELECT 2)", [["eng"]]],
    ["CAST(COUNT(*) AS TEXT) LIKE '2' ESCAPE '/'", [["eng"]]]
  ] as const) assert.deepEqual(db.exec(`SELECT dept FROM sales GROUP BY dept HAVING ${predicate} ORDER BY dept`)[0]!.rows, expected);
  assert.deepEqual(db.exec("SELECT COALESCE(SUM(amount),0), IFNULL(MAX(amount),-1), IIF(COUNT(*)>0,'nonempty','empty'), COUNT(*)>0 AND SUM(amount)>0 FROM sales")[0]!.rows, [[350,200,"nonempty",1]]);
});

test("join stars suppress shared columns but preserve qualified stars", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE a(id INT, va TEXT); CREATE TABLE b(id INT, vb TEXT); INSERT INTO a VALUES(1,'x'); INSERT INTO b VALUES(1,'y'),(2,'z')");
  for (const join of ["NATURAL JOIN", "JOIN b USING (id)"]) {
    const sql = join === "NATURAL JOIN" ? "a NATURAL JOIN b" : `a ${join}`;
    const result = db.exec(`SELECT * FROM ${sql}`)[0]!;
    assert.deepEqual(result.columns, ["id","va","vb"]);
    assert.deepEqual(result.rows, [[1,"x","y"]]);
  }
  assert.deepEqual(db.exec("SELECT * FROM a FULL JOIN b USING(id) ORDER BY id")[0]!.rows, [[1,"x","y"],[2,null,"z"]]);
  assert.deepEqual(db.exec("SELECT a.*, b.* FROM a JOIN b USING(id)")[0]!.rows, [[1,"x",1,"y"]]);
});

test("binary persistence retains signed rowids in key order", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES(10,'ten'),(-5,'neg'),(2,'two')");
  const reopened = new SqliteDatabase();
  reopened.loadFromBytes(db.serializeToBytes());
  assert.deepEqual(reopened.exec("SELECT id,name FROM t ORDER BY id")[0]!.rows, [[-5,"neg"],[2,"two"],[10,"ten"]]);
});

test("WITHOUT ROWID persistence stores primary key columns first", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(value TEXT, k INT, part TEXT, PRIMARY KEY(part,k)) WITHOUT ROWID; INSERT INTO t VALUES('one',2,'b'),('two',1,'a')");
  const bytes = db.serializeToBytes();
  assert.equal(bytes[4096], 0x0a);
  const reopened = new SqliteDatabase();
  reopened.loadFromBytes(bytes);
  assert.deepEqual(reopened.exec("SELECT * FROM t ORDER BY part,k")[0]!.rows, [["two",1,"a"],["one",2,"b"]]);
});

test("WITHOUT ROWID preserves records across interior and overflow pages", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(value TEXT, id INTEGER PRIMARY KEY) WITHOUT ROWID");
  const expected = Array.from({length: 100}, (_, id) => ["x".repeat(id === 0 ? 10000 : 900), id]);
  for (const [value, id] of [...expected].reverse()) db.exec(`INSERT INTO t VALUES('${value}',${id})`);
  const bytes = db.serializeToBytes();
  assert.equal(bytes[4096], 0x02);
  const reopened = new SqliteDatabase();
  reopened.loadFromBytes(bytes);
  assert.deepEqual(reopened.exec("SELECT * FROM t ORDER BY id")[0]!.rows, expected);
});

test("correlations preserve literals, inner aliases and unqualified outer columns", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE a(b INT); INSERT INTO a VALUES(7); CREATE TABLE users(id INT); INSERT INTO users VALUES(1),(2); CREATE TABLE orders(user_id INT); INSERT INTO orders VALUES(1),(1)");
  assert.deepEqual(db.exec("SELECT (SELECT 'a.b'), (SELECT a.b FROM (SELECT 9 AS b) AS a) FROM a")[0]!.rows, [["a.b",9]]);
  assert.deepEqual(db.exec("SELECT id,(SELECT COUNT(*) FROM orders WHERE user_id=id) FROM users ORDER BY id")[0]!.rows, [[1,2],[2,0]]);
  assert.deepEqual(db.exec("SELECT 1 BETWEEN 2 AND NULL, 1 NOT BETWEEN 2 AND NULL, 10 NOT BETWEEN NULL AND 5")[0]!.rows, [[0,1,1]]);
});

for (const key of ["id TEXT PRIMARY KEY DESC", "id TEXT PRIMARY KEY COLLATE NOCASE", "id TEXT, PRIMARY KEY(id COLLATE NOCASE DESC)"]) {
  test(`WITHOUT ROWID serializes declared key ordering: ${key}`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(${key}) WITHOUT ROWID; INSERT INTO t VALUES('a'),('B'),('c')`);
    const reopened = new SqliteDatabase();
    reopened.loadFromBytes(db.serializeToBytes());
    const expected = key.includes('NOCASE') ? (key.includes('DESC') ? [['c'],['B'],['a']] : [['a'],['B'],['c']]) : [['c'],['a'],['B']];
    assert.deepEqual(reopened.exec("SELECT * FROM t")[0]!.rows, expected);
  });
}
