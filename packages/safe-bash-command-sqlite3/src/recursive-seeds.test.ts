import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

test("all initial UNION ALL members seed recursive traversal exactly once", () => {
  const db = new SqliteDatabase(200);
  assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS
    (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT n+1 FROM c WHERE n<4)
    SELECT * FROM c ORDER BY n`)[0]!.rows, [[1], [2], [2], [3], [3], [4], [4]]);
});

test("compound seeds preserve duplicates according to the recursive UNION operator", () => {
  const db = new SqliteDatabase(200);
  assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS
    (SELECT 1 UNION ALL SELECT 1 UNION SELECT n+1 FROM c WHERE n<3)
    SELECT * FROM c ORDER BY n`)[0]!.rows, [[1], [2], [3]]);
});

test("multiple seeds and recursive members share global traversal limits", () => {
  const db = new SqliteDatabase(200);
  const body = `SELECT 1 UNION ALL SELECT 2
    UNION ALL SELECT n+2 FROM c WHERE n<3
    UNION ALL SELECT n+4 FROM c WHERE n<3`;
  assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS (${body})
    SELECT * FROM c ORDER BY n`)[0]!.rows, [[1], [2], [3], [4], [5], [6]]);
  assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS (${body} LIMIT 3)
    SELECT * FROM c`)[0]!.rows, [[1], [2], [3]]);
  assert.throws(() => db.exec(`WITH RECURSIVE c(n) AS
    (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT n+1 FROM c)
    SELECT * FROM c`), /maxRows limit exceeded/);
});
