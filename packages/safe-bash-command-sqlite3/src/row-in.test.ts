import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command } from "./index.js";

const setup = "create table t(a, b); insert into t values(1, 'x'), (2, 'y'), (3, 'z');";
const queries = [
  "select a, b from t where (a, b) in (values (1, 'x'), (3, 'q'));",
  "select a from t where (a, b) in (select a, b from t where a > 2);"
];
for (const [i, query] of queries.entries()) {
  test(`row IN ${i === 0 ? "VALUES" : "SELECT"}`, () => {
    const results = new SqliteDatabase(100).exec(setup + query);
    assert.deepEqual(results.at(-1)?.rows, i === 0 ? [[1, "x"]] : [[3]]);
  });
}

test("row IN command produces both result sets", async () => {
  let stdout = "", stderr = "";
  const result = await createSqlite3Command().execute({
    command: "sqlite3", ...createCommandArguments([":memory:", setup + queries.join("")]),
    fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(stdout, "1|x\n3\n");
});

for (const [expression, expected] of [
  ["(1,NULL) IN (VALUES (2,NULL))", 0],
  ["(1,NULL) IN (VALUES (1,2))", null],
  ["(1,2) IN (VALUES (1,NULL),(1,2))", 1],
  ["(1,2) NOT IN (VALUES (1,NULL))", null],
  ["(1,2) NOT IN (VALUES (3,2))", 1],
  ["(NULL,2) IN (SELECT 1,2 WHERE 0)", 0],
  ["(NULL,2) NOT IN (SELECT 1,2 WHERE 0)", 1],
  ["('a' COLLATE NOCASE,2) IN (VALUES ('A',2))", 1],
  ["(1,2,3) IN (VALUES (1,2,3))", 1]
] as const) {
  test(expression, () => {
    assert.deepEqual(new SqliteDatabase(100).exec(`SELECT ${expression}`)[0]?.rows, [[expected]]);
  });
}

for (const sql of [
  "SELECT (1,2) IN (VALUES (1))",
  "CREATE TABLE t(a,b); SELECT * FROM t WHERE (a,b) IN (SELECT 1 WHERE 0)"
]) {
  test(`row IN rejects mismatched width: ${sql}`, () => {
    assert.throws(() => new SqliteDatabase(100).exec(sql), { message: "sub-select returns 1 columns - expected 2" });
  });
}
