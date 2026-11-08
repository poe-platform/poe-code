import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteDatabase } from "./engine.js";

test("UPDATE OR IGNORE skips conflicting rows and continues with RETURNING and changes", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v UNIQUE); INSERT INTO t VALUES(1, 'a'),(2, 'b'),(3, 'c')");
  assert.deepEqual(db.exec("UPDATE OR IGNORE t SET v='a' WHERE id > 1 RETURNING id")[0]!.rows, []);
  assert.deepEqual(db.exec("SELECT id,v FROM t")[0]!.rows, [[1,"a"],[2,"b"],[3,"c"]]);
  assert.deepEqual(db.exec("UPDATE OR IGNORE t SET id=id+1 RETURNING id")[0]!.rows, [[4]]);
  assert.deepEqual(db.exec("SELECT changes()")[0]!.rows, [[1]]);
});

test("UPDATE OR REPLACE removes every conflicting row and never updates deleted matches", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v UNIQUE, w UNIQUE); INSERT INTO t VALUES(1,'a','x'),(2,'b','y'),(3,'c','z')");
  assert.deepEqual(db.exec("UPDATE OR REPLACE t SET v='b', w='z' WHERE id=1 RETURNING id,v,w")[0]!.rows, [[1,"b","z"]]);
  assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, [[1,"b","z"]]);
  db.exec("INSERT INTO t VALUES(2,'a','x'),(3,'c','y')");
  assert.deepEqual(db.exec("UPDATE OR REPLACE t SET id=id+1 RETURNING id")[0]!.rows, [[2],[4]]);
  assert.deepEqual(db.exec("SELECT changes()")[0]!.rows, [[2]]);
});

test("UPDATE OR IGNORE handles NOT NULL and CHECK constraints without hiding evaluation errors", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL, n INT CHECK(n>0)); INSERT INTO t VALUES(1,'a',1)");
  db.exec("UPDATE OR IGNORE t SET v=NULL; UPDATE OR IGNORE t SET n=0");
  assert.deepEqual(db.exec("SELECT * FROM t")[0]!.rows, [[1,"a",1]]);
  assert.throws(() => db.exec("UPDATE OR IGNORE t SET n=abs(-9223372036854775808)"), /integer overflow/);
});

test("UPDATE OR REPLACE uses NOT NULL defaults but still rejects CHECK failures", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL DEFAULT 'fallback', n INT CHECK(n>0)); INSERT INTO t VALUES(1,'a',1)");
  db.exec("UPDATE OR REPLACE t SET v=NULL");
  assert.deepEqual(db.exec("SELECT v FROM t")[0]!.rows, [["fallback"]]);
  assert.throws(() => db.exec("UPDATE OR REPLACE t SET n=0"), /CHECK constraint failed/);
});
