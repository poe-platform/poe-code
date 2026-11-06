import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

for (const [tail, expected] of [
  ["LIMIT 3", [[1], [2], [3]]],
  ["LIMIT 0", []],
  ["LIMIT 3 OFFSET 2", [[3], [4], [5]]],
  ["LIMIT 2, 3", [[3], [4], [5]]],
  ["LIMIT -1 OFFSET 5", [[6], [7]]],
  ["LIMIT 3 OFFSET -2", [[1], [2], [3]]],
] as const) {
  test(`recursive traversal applies ${tail} globally`, () => {
    const db = new SqliteDatabase(20);
    assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS
      (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<7 ${tail}) SELECT * FROM c`)[0]!.rows, expected);
  });
}

test("recursive ORDER BY prioritizes the whole pending queue before LIMIT and OFFSET", () => {
  const db = new SqliteDatabase(20);
  db.exec("CREATE TABLE edge(src TEXT,dst TEXT); INSERT INTO edge VALUES ('a','b'),('a','c'),('b','d'),('b','e'),('c','f')");
  for (const [tail, expected] of [
    ["ORDER BY 2 DESC,1 LIMIT 4", [["a",0],["b",1],["d",2],["e",2]]],
    ["ORDER BY 2 ASC,1 LIMIT 3 OFFSET 2", [["c",1],["d",2],["e",2]]],
    ["", [["a",0],["b",1],["c",1],["d",2],["e",2],["f",2]]],
  ] as const) {
    assert.deepEqual(db.exec(`WITH RECURSIVE walk(name,depth) AS
      (SELECT 'a',0 UNION ALL SELECT edge.dst,walk.depth+1 FROM walk
       JOIN edge ON edge.src=walk.name WHERE depth<3 ${tail}) SELECT * FROM walk`)[0]!.rows, expected);
  }
});

test("UNION deduplicates queued and offset rows including anchor duplicates", () => {
  const db = new SqliteDatabase(20);
  assert.deepEqual(db.exec(`WITH RECURSIVE c(n) AS
    (VALUES(1),(1),(2) UNION SELECT n+1 FROM c WHERE n<4 LIMIT 2 OFFSET 1)
    SELECT * FROM c`)[0]!.rows, [[2],[3]]);
});

test("LIMIT stops recursion before evaluating another row", () => {
  const db = new SqliteDatabase(20);
  assert.deepEqual(db.exec("WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT ABS(-9223372036854775808) FROM c LIMIT 1) SELECT * FROM c")[0]!.rows, [[1]]);
  assert.deepEqual(db.exec("WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c LIMIT 3 OFFSET 2) SELECT * FROM c")[0]!.rows, [[3],[4],[5]]);
});

test("reported dependency graph respects global traversal bounds", () => {
  const db = new SqliteDatabase(200);
  db.exec(`CREATE TABLE edge(src TEXT,dst TEXT);
    INSERT INTO edge VALUES
    ('safe-bash-command-jq','@poe-code/safe-fs'),
    ('safe-bash-command-jq','safe-bash-contracts'),
    ('safe-bash-command-jq','safe-bash-query-engine'),
    ('safe-bash-command-jq','safe-bash-byte-engine'),
    ('safe-bash-command-jq','safe-bash-io-engine'),
    ('safe-bash-query-engine','safe-bash-contracts'),
    ('safe-bash-query-engine','safe-bash-regex-engine'),
    ('safe-bash-query-engine','@poe-code/safe-fs')`);
  for (const [tail, expected] of [
    ["ORDER BY 2 DESC,1 LIMIT 4", [
      ["safe-bash-command-jq",0],["@poe-code/safe-fs",1],
      ["safe-bash-byte-engine",1],["safe-bash-contracts",1]
    ]],
    ["ORDER BY 2 ASC,1 LIMIT 3 OFFSET 2", [
      ["safe-bash-byte-engine",1],["safe-bash-contracts",1],["safe-bash-io-engine",1]
    ]]
  ] as const) {
    assert.deepEqual(db.exec(`WITH RECURSIVE walk(name,depth) AS
      (SELECT 'safe-bash-command-jq',0 UNION ALL
       SELECT edge.dst,walk.depth+1 FROM walk JOIN edge ON edge.src=walk.name
       WHERE depth<3 ${tail}) SELECT name,depth FROM walk`)[0]!.rows, expected);
  }
});

test("recursive tail clauses still validate empty traversals and enforce resource bounds", () => {
  const db = new SqliteDatabase(10);
  assert.throws(() => db.exec("WITH RECURSIVE c(n) AS (SELECT 1 WHERE 0 UNION ALL SELECT n+1 FROM c LIMIT (SELECT missing)) SELECT * FROM c"), /no such column/);
  assert.throws(() => db.exec("WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c LIMIT 1 OFFSET 20) SELECT * FROM c"), /maxRows/);
  assert.deepEqual(db.exec("WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c LIMIT (SELECT 2) OFFSET (SELECT 1)) SELECT * FROM c")[0]!.rows, [[2],[3]]);
});
