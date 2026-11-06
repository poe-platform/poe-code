import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command } from "./index.js";
import { SqliteDatabase } from "./engine.js";

const cte = "WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<350)";

for (const [select, expected] of [
  ["SELECT * FROM c LIMIT 3", [[1], [2], [3]]],
  ["SELECT c.n+1 AS value FROM c LIMIT 2 OFFSET 3", [[5], [6]]],
  ["SELECT x.* FROM c AS x LIMIT 3,2", [[4], [5]]],
  ["SELECT * FROM c LIMIT 0", []],
  ["SELECT * FROM c LIMIT 3 OFFSET -2", [[1], [2], [3]]],
  ['SELECT "x".* FROM "c" "x" LIMIT 2', [[1], [2]]],
  ["SELECT abs(n) FROM c LIMIT 2", [[1], [2]]],
] as const) {
  test(`recursive outer limit stops work: ${select}`, () => {
    assert.deepEqual(new SqliteDatabase(200).exec(`${cte} ${select}`)[0]!.rows, expected);
  });
}

test("outer limit composes with recursive limit and offset", () => {
  assert.deepEqual(new SqliteDatabase(10).exec(`WITH RECURSIVE c(n) AS
    (VALUES(1) UNION ALL SELECT n+1 FROM c LIMIT 100 OFFSET 2)
    SELECT * FROM c LIMIT 2 OFFSET 1`)[0]!.rows, [[4], [5]]);
});

test("outer limit stops before evaluating an unused recursive step", () => {
  assert.deepEqual(new SqliteDatabase(10).exec(`WITH RECURSIVE c(n) AS
    (VALUES(1) UNION ALL SELECT abs(-9223372036854775808) FROM c)
    SELECT * FROM c LIMIT 1`)[0]!.rows, [[1]]);
});

for (const select of [
  "SELECT * FROM c LIMIT -1",
  "SELECT * FROM c LIMIT 3 OFFSET 210",
  "SELECT count(*) FROM c LIMIT 3",
  "SELECT * FROM c ORDER BY n DESC LIMIT 3",
  "SELECT * FROM c WHERE n>300 LIMIT 3",
  "SELECT DISTINCT n FROM c LIMIT 3",
  "SELECT sum(n) OVER () FROM c LIMIT 3",
  "SELECT a.n FROM c a JOIN c b ON a.n=b.n LIMIT 3",
  "SELECT * FROM c UNION ALL SELECT 0 LIMIT 3",
]) {
  test(`outer limit preserves full-work bounds: ${select}`, () => {
    assert.throws(() => new SqliteDatabase(200).exec(`${cte} ${select}`), /maxRows/);
  });
}

test("MATERIALIZED retains the full recursive work budget", () => {
  assert.throws(() => new SqliteDatabase(200).exec(`${cte.replace("AS (", "AS MATERIALIZED (")} SELECT * FROM c LIMIT 3`), /maxRows/);
});


test("sqlite3 command returns the reported limited recursion within maxRows", async () => {
  let stdout = "", stderr = "";
  const result = await createSqlite3Command({ limits: { maxRows: 200 } }).execute({
    command: "sqlite3", ...createCommandArguments([":memory:", `${cte} SELECT * FROM c LIMIT 3;`]),
    fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stdout, "1\n2\n3\n");
  assert.equal(stderr, "");
});

test("bounded recursive results still prepare invalid columns", () => {
  assert.throws(() => new SqliteDatabase(200).exec(`${cte} SELECT missing FROM c LIMIT 0`), /no such column/);
  assert.throws(() => new SqliteDatabase(200).exec(`WITH RECURSIVE c(n) AS
    (VALUES(1) UNION ALL SELECT missing FROM c) SELECT * FROM c LIMIT 0`), /no such column/);
});
