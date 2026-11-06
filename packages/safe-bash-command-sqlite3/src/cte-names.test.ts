import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const [sql, name] of [
  ["WITH one(n) AS (VALUES(1)), one(n) AS (VALUES(2)) SELECT * FROM one", "one"],
  ['WITH one(n) AS (VALUES(1)), "ONE"(n) AS (VALUES(2)) SELECT * FROM one', "ONE"],
  ["WITH RECURSIVE one(n) AS (VALUES(1)), one(n) AS (VALUES(2)) SELECT * FROM one", "one"],
  ["WITH one AS (VALUES(1)), other AS (VALUES(3)), one AS (VALUES(2)) SELECT 4", "one"]
]) {
  test(`rejects duplicate WITH names: ${sql}`, async () => {
    const message = `in prepare, duplicate WITH table name: ${name}`;
    assert.throws(() => new SqliteDatabase(200).exec(sql!), { message });
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
    assert.equal(stderr, `Error: ${message}\n`);
  });
}

test("nested WITH names shadow outer names without replacing the outer definition", () => {
  assert.deepEqual(new SqliteDatabase(200).exec(
    "WITH one(n) AS (VALUES(1)) SELECT (WITH one(n) AS (VALUES(2)) SELECT n FROM one), n FROM one"
  )[0]!.rows, [[2, 1]]);
});
