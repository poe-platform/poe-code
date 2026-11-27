import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

test("ORDER BY honors declared NOCASE through async and sync sqlite3 commands", async () => {
  const args = [":memory:", "create table t(a text collate nocase); insert into t values('B'),('a'),('C'); select a from t order by a;"];
  let stdout = "", stderr = "";
  const result = await createSqlite3Command().execute({
    command: "sqlite3", ...createCommandArguments(args),
    fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "a\nB\nC\n");
  assert.equal(evalSyncSqlite3(undefined, args), "a\nB\nC\n");
});

for (const [query, expected] of [
  ["SELECT a FROM t ORDER BY t.a", ["a", "B", "C"]],
  ["SELECT a AS label FROM t ORDER BY LABEL", ["a", "B", "C"]],
  ["SELECT a FROM t ORDER BY 1", ["a", "B", "C"]],
  ["SELECT a FROM t ORDER BY a DESC", ["C", "B", "a"]],
  ["SELECT a FROM t ORDER BY a COLLATE BINARY", ["B", "C", "a"]],
  ["SELECT a COLLATE BINARY AS label FROM t ORDER BY label", ["B", "C", "a"]],
  ["SELECT a COLLATE BINARY AS a FROM t ORDER BY a", ["B", "C", "a"]],
  ["SELECT a COLLATE BINARY AS label FROM t ORDER BY label COLLATE NOCASE", ["a", "B", "C"]],
  ["SELECT a COLLATE BINARY FROM t ORDER BY 1", ["B", "C", "a"]],
  ["SELECT a FROM t ORDER BY +a", ["a", "B", "C"]],
  ["SELECT a FROM t ORDER BY CAST(a AS TEXT)", ["a", "B", "C"]],
  ["SELECT a FROM t ORDER BY a || ''", ["B", "C", "a"]],
  ["SELECT a FROM t ORDER BY (a COLLATE NOCASE) || ''", ["a", "B", "C"]]
] as const) {
  test(`ORDER BY collation resolution: ${query}`, () => {
    const db = new SqliteDatabase();
    db.exec("CREATE TABLE t(a TEXT COLLATE NOCASE); INSERT INTO t VALUES('B'),('a'),('C');");
    assert.deepEqual(db.exec(query)[0]!.rows, expected.map(value => [value]));
  });
}

test("ORDER BY keeps null placement and secondary keys with declared RTRIM", () => {
  const db = new SqliteDatabase();
  db.exec("CREATE TABLE t(a TEXT COLLATE RTRIM, id INTEGER); INSERT INTO t VALUES('a',1),('a ',2),(NULL,3),('b',4);");
  assert.deepEqual(db.exec("SELECT id FROM t ORDER BY a NULLS LAST, id DESC")[0]!.rows,
    [[2], [1], [4], [3]]);
  assert.deepEqual(db.exec("SELECT id FROM t ORDER BY a DESC NULLS FIRST, id DESC")[0]!.rows,
    [[3], [4], [2], [1]]);
});
