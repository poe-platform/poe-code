import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteDatabase } from "./engine.js";

test("dropping an index removes only its uniqueness constraint", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a TEXT); CREATE UNIQUE INDEX i ON t(a); CREATE UNIQUE INDEX j ON t(a); DROP INDEX i; INSERT INTO t VALUES ('x')");
  assert.throws(() => db.exec("INSERT INTO t VALUES ('x')"), /UNIQUE/);
  db.exec("DROP INDEX j; INSERT INTO t VALUES ('x')");
  assert.deepEqual(db.exec("SELECT count(*) FROM t")[0]!.rows, [[2]]);
});

test("unique indexes validate existing rows and respect index collation", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a TEXT); INSERT INTO t VALUES ('abc'), ('ABC')");
  assert.throws(() => db.exec("CREATE UNIQUE INDEX i ON t(a COLLATE NOCASE)"), /UNIQUE/);
  assert.equal(db.indexes.has("i"), false);
  db.exec("DELETE FROM t; CREATE UNIQUE INDEX i ON t(a COLLATE NOCASE); INSERT INTO t VALUES ('abc')");
  assert.throws(() => db.exec("INSERT INTO t VALUES ('ABC')"), /UNIQUE/);
  db.exec("INSERT INTO t VALUES (NULL), (NULL)");
  assert.throws(() => db.exec("UPDATE t SET a='ABC' WHERE a IS NULL"), /UNIQUE/);
});

test("creating a unique index rejects existing identical rows", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a TEXT); INSERT INTO t VALUES ('dup'), ('dup')");
  assert.throws(() => db.exec("CREATE UNIQUE INDEX i ON t(a)"), /UNIQUE/);
});

test("explicit rowid and updated integer primary keys synchronize allocation", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t1(a TEXT); INSERT INTO t1(rowid,a) VALUES(10,'ten')");
  assert.deepEqual(db.exec("SELECT rowid,a FROM t1")[0]!.rows, [[10,"ten"]]);
  db.exec("CREATE TABLE t2(id INTEGER PRIMARY KEY,a TEXT); INSERT INTO t2 VALUES(1,'one'); UPDATE t2 SET id=5 WHERE id=1; INSERT INTO t2(a) VALUES('auto')");
  assert.deepEqual(db.exec("SELECT rowid,id,a FROM t2 ORDER BY id")[0]!.rows, [[5,5,"one"],[6,6,"auto"]]);
  assert.throws(() => db.exec("INSERT INTO t2 VALUES(5,'duplicate')"), /UNIQUE/);
});

test("index collations remain distinct from table constraints and survive rollback", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a TEXT UNIQUE, b TEXT); CREATE UNIQUE INDEX i ON t(b COLLATE NOCASE DESC, a ASC); INSERT INTO t VALUES ('x','abc'), ('y','ABC')");
  db.exec("BEGIN; DROP INDEX i; ROLLBACK");
  assert.throws(() => db.exec("INSERT INTO t VALUES ('x','ABC')"), /UNIQUE/);
  db.exec("DROP INDEX i");
  assert.throws(() => db.exec("INSERT INTO t VALUES ('x','different')"), /UNIQUE/);
});
