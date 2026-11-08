import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

test("FTS5 tables support inserts, column and table MATCH, and token boundaries", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, body); INSERT INTO docs VALUES ('Hello', 'world'), ('shelloworld', 'other'), ('other', 'hello world')");
  assert.deepEqual(db.exec("SELECT * FROM docs WHERE docs MATCH 'HELLO' ORDER BY rowid")[0]!.rows, [["Hello", "world"], ["other", "hello world"]]);
  assert.deepEqual(db.exec("SELECT rowid FROM docs WHERE title MATCH 'hello'")[0]!.rows, [[1]]);
  assert.deepEqual(db.exec("SELECT rowid FROM docs WHERE docs MATCH 'hello world'")[0]!.rows, [[1], [3]]);
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title, body)");
  db.exec("UPDATE docs SET title = 'goodbye' WHERE rowid = 1; DELETE FROM docs WHERE rowid = 3");
  assert.deepEqual(db.exec("SELECT * FROM docs WHERE docs MATCH 'hello'")[0]!.rows, []);
});

for (const args of ["fts4(title)", "rtree(title)", "fts5(title, tokenize='porter')", "fts5(title, content='external')", "fts5(title UNINDEXED)", "fts5()", "fts5(title, title)"]) {
  test(`unsupported virtual table definition fails: ${args}`, () => {
    const db = new SqliteDatabase();
    assert.throws(() => db.exec(`CREATE VIRTUAL TABLE docs USING ${args}`), /unsupported|duplicate/i);
    assert.throws(() => db.exec("SELECT * FROM docs"), /no such table/);
  });
}

test("unsupported MATCH syntax fails explicitly", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(body); INSERT INTO docs VALUES ('hello world')");
  for (const query of ["hello OR world", "hello*", '"hello world"', "hello.world", "café"]) {
    assert.throws(() => db.exec("SELECT * FROM docs WHERE docs MATCH ?", [query]), /unsupported FTS5/);
  }
});

test("FTS5 metadata survives rollback and rejects incompatible binary storage", () => {
  const db = new SqliteDatabase();
  db.exec('CREATE VIRTUAL TABLE "docs" USING fts5("title", "body"); INSERT INTO docs VALUES (\'hello\', NULL); BEGIN; DELETE FROM docs; ROLLBACK');
  assert.deepEqual(db.exec("SELECT * FROM docs WHERE docs MATCH 'hello'")[0]!.rows, [["hello", null]]);
  assert.throws(() => db.serializeToBytes(), /unsupported FTS5 binary persistence/);
  assert.throws(() => db.exec("CREATE VIRTUAL TABLE docs USING fts5(title)"), /already exists/);
});

test("MATCH on ordinary tables is rejected instead of treated as a regular expression", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE ordinary(body); INSERT INTO ordinary VALUES ('hello')");
  assert.throws(() => db.exec("SELECT * FROM ordinary WHERE body MATCH 'hell.*'"), /MATCH requires an FTS5/);
});

test("FTS column aliases retain their source and ordinary aliases cannot impersonate FTS tables", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(body); INSERT INTO docs VALUES ('hello'); CREATE TABLE ordinary(body); INSERT INTO ordinary VALUES ('hello')");
  assert.deepEqual(db.exec("SELECT d.body FROM docs AS d WHERE d.body MATCH 'hello'")[0]!.rows, [["hello"]]);
  assert.throws(() => db.exec("SELECT * FROM ordinary AS docs WHERE body MATCH 'hello'"), /MATCH requires an FTS5/);
});

test("unsupported literal queries fail even on empty FTS tables", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(body)");
  assert.throws(() => db.exec("SELECT * FROM docs WHERE docs MATCH 'hello*'"), /unsupported FTS5/);
});
