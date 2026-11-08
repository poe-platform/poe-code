import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

test("foreign key failures roll back the whole statement on a live connection", () => {
  const db = new SqliteDatabase();
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid REFERENCES p ON DELETE SET NULL NOT NULL); INSERT INTO p VALUES(1),(2); INSERT INTO c VALUES(1);");
  assert.throws(() => db.exec("DELETE FROM p"), /NOT NULL constraint failed/);
  assert.deepEqual(db.executeStatement("SELECT id FROM p ORDER BY id")?.rows, [[1], [2]]);
  assert.deepEqual(db.executeStatement("SELECT pid FROM c")?.rows, [[1]]);
  assert.throws(() => db.exec("INSERT INTO c VALUES(2),(9)"), /FOREIGN KEY constraint failed/);
  assert.deepEqual(db.executeStatement("SELECT pid FROM c")?.rows, [[1]]);
});

test("foreign keys cascade updates through triggers and honor parent affinity and collation", () => {
  const db = new SqliteDatabase();
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE p(id TEXT COLLATE NOCASE PRIMARY KEY); CREATE TABLE c(pid TEXT REFERENCES p ON UPDATE CASCADE); CREATE TABLE log(v TEXT); CREATE TRIGGER changed AFTER UPDATE ON c BEGIN INSERT INTO log VALUES(new.pid); END; INSERT INTO p VALUES('a'); INSERT INTO c VALUES('A'); UPDATE p SET id='b';");
  assert.deepEqual(db.executeStatement("SELECT pid FROM c")?.rows, [["b"]]);
  assert.deepEqual(db.executeStatement("SELECT v FROM log")?.rows, [["b"]]);
});

test("foreign key enforcement does not retroactively reject existing orphans", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id INTEGER PRIMARY KEY, pid REFERENCES p); INSERT INTO c VALUES(1,99); PRAGMA foreign_keys=ON; INSERT INTO p VALUES(2); INSERT INTO c VALUES(2,2);");
  assert.deepEqual(db.executeStatement("SELECT pid FROM c ORDER BY id")?.rows, [[99], [2]]);
});

test("self-referencing cascades terminate and pragma changes inside transactions are ignored", () => {
  const db = new SqliteDatabase();
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE t(id INTEGER PRIMARY KEY, parent REFERENCES t ON DELETE CASCADE); INSERT INTO t VALUES(1,1),(2,1),(3,2); BEGIN; PRAGMA foreign_keys=OFF;");
  assert.deepEqual(db.executeStatement("PRAGMA foreign_keys")?.rows, [[1]]);
  db.exec("DELETE FROM t WHERE id=1; COMMIT;");
  assert.deepEqual(db.executeStatement("SELECT * FROM t")?.rows, []);
});

test("replacing an existing orphan still enforces the new insert", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(id INTEGER PRIMARY KEY, pid REFERENCES p); INSERT INTO c VALUES(1,99); PRAGMA foreign_keys=ON;");
  assert.throws(() => db.exec("INSERT OR REPLACE INTO c VALUES(1,99)"), /FOREIGN KEY constraint failed/);
});

test("composite metadata, nullable keys, default actions and deferred rejection", () => {
  const db = new SqliteDatabase();
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE p(a INTEGER,b TEXT,PRIMARY KEY(a,b)); CREATE TABLE c(a INTEGER DEFAULT 0,b TEXT DEFAULT 'root', FOREIGN KEY(a,b) REFERENCES p ON DELETE SET DEFAULT); INSERT INTO p VALUES(0,'root'),(1,'one'); INSERT INTO c VALUES(1,'one'),(NULL,'missing'); DELETE FROM p WHERE a=1;");
  assert.deepEqual(db.executeStatement("SELECT * FROM c")?.rows, [[0,"root"],[null,"missing"]]);
  assert.deepEqual(db.executeStatement("PRAGMA foreign_key_list(c)")?.rows, [
    [0,0,"p","a",null,"NO ACTION","SET DEFAULT","NONE"],
    [0,1,"p","b",null,"NO ACTION","SET DEFAULT","NONE"]
  ]);
  assert.throws(() => db.exec("CREATE TABLE deferred(pid REFERENCES p DEFERRABLE INITIALLY DEFERRED)"), /unsupported deferred foreign key/);
});
