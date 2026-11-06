import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const cases: string[][] = [
  ["WITH c(x,y) AS (VALUES(1)) SELECT * FROM c", "table c has 1 values for 2 columns"],
  ["WITH c(x) AS (VALUES(1,2)) SELECT * FROM c", "table c has 2 values for 1 columns"],
  ["WITH c(x,y) AS (SELECT 1 WHERE 0) SELECT * FROM c", "table c has 1 values for 2 columns"],
  ["WITH RECURSIVE c(n,m) AS (VALUES(1) UNION ALL SELECT n+1,m FROM c WHERE n<3) SELECT * FROM c", "table c has 1 values for 2 columns"],
  ...["UNION", "UNION ALL"].flatMap(op => [
    `WITH RECURSIVE c(n) AS (VALUES(1) ${op} SELECT n+1,n FROM c WHERE n<3) SELECT * FROM c`,
    `WITH RECURSIVE c(n) AS (SELECT 1 WHERE 0 ${op} SELECT n+1,n FROM c) SELECT * FROM c`,
    `WITH RECURSIVE c(n) AS (VALUES(1) ${op} SELECT n+1,n FROM c LIMIT 0) SELECT * FROM c`,
    `WITH c AS (SELECT 1 ${op} SELECT 2,3) SELECT * FROM c`
  ].map(sql => [sql, `SELECTs to the left and right of ${op} do not have the same number of result columns`]))
];

for (const [sql, message] of cases) {
  test(`rejects mismatched CTE columns: ${sql}`, async () => {
    assert.throws(() => new SqliteDatabase(200).exec(sql!), { message: `in prepare, ${message}` });
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql!]), undefined);
    let stdout = "", stderr = "";
    const result = await createSqlite3Command({ limits: { maxRows: 200 } }).execute({
      command: "sqlite3", ...createCommandArguments([":memory:", sql!]),
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "");
    assert.equal(stderr, `Error: in prepare, ${message}\n`);
  });
}

test("matching CTE column counts preserve aliases and recursive rows", () => {
  assert.deepEqual(new SqliteDatabase(200).exec(
    "WITH RECURSIVE c(n,m) AS (VALUES(1,10) UNION ALL SELECT n+1,m+10 FROM c WHERE n<3) SELECT * FROM c"
  ), [{ columns: ["n", "m"], rows: [[1, 10], [2, 20], [3, 30]] }]);
});
