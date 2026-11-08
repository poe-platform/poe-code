import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const foreignKeys of ["OFF", "ON"]) {
  for (const constraint of ["UNIQUE", "NOT NULL", "CHECK(x > 0)"]) {
    test(`INSERT OR ROLLBACK restores the transaction for ${constraint}, foreign_keys=${foreignKeys}`, () => {
      const db = new SqliteDatabase();
      db.exec(`PRAGMA foreign_keys=${foreignKeys}; CREATE TABLE t(x INT ${constraint});
        INSERT INTO t VALUES(1); BEGIN; INSERT INTO t VALUES(2); SAVEPOINT s`);
      const value = constraint === "UNIQUE" ? "1" : constraint === "NOT NULL" ? "NULL" : "0";
      assert.throws(() => db.exec(`INSERT OR ROLLBACK INTO t VALUES(3),(${value})`),
        { message: constraint === "UNIQUE" ? "UNIQUE constraint failed: t.x" : constraint === "NOT NULL" ? "NOT NULL constraint failed: t.x" : "CHECK constraint failed: x > 0" });
      assert.equal(db.inTransaction, false);
      assert.deepEqual(db.exec("SELECT x FROM t ORDER BY x")[0]!.rows, [[1]]);
      assert.throws(() => db.exec("ROLLBACK TO s"), { message: "no such savepoint: s" });
      db.exec("BEGIN; INSERT INTO t VALUES(4); COMMIT");
      assert.deepEqual(db.exec("SELECT x FROM t ORDER BY x")[0]!.rows, [[1], [4]]);
    });
  }
}

for (const begin of ["", "SAVEPOINT outer_savepoint"]) {
  test(`INSERT OR ROLLBACK restores changes with ${begin || "an implicit transaction"}`, () => {
    const db = new SqliteDatabase();
    db.exec(`CREATE TABLE t(x INT UNIQUE); INSERT INTO t VALUES(1); ${begin}`);
    if (begin) db.exec("INSERT INTO t VALUES(2)");
    assert.throws(() => db.exec("INSERT OR ROLLBACK INTO t VALUES(3),(1)"), { message: "UNIQUE constraint failed: t.x" });
    assert.equal(db.inTransaction, false);
    assert.deepEqual(db.exec("SELECT x FROM t ORDER BY x")[0]!.rows, [[1]]);
  });
}

test("INSERT OR ROLLBACK does not roll back a transaction for foreign-key or evaluation errors", () => {
  const db = new SqliteDatabase();
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE parent(x INT PRIMARY KEY);
    CREATE TABLE child(x INT REFERENCES parent(x)); BEGIN; INSERT INTO parent VALUES(1)`);
  assert.throws(() => db.exec("INSERT OR ROLLBACK INTO child VALUES(2)"), { message: "FOREIGN KEY constraint failed" });
  assert.throws(() => db.exec("INSERT OR ROLLBACK INTO parent VALUES(abs(-9223372036854775808))"), { message: "integer overflow" });
  assert.equal(db.inTransaction, true);
  assert.deepEqual(db.exec("SELECT x FROM parent")[0]!.rows, [[1]]);
});
