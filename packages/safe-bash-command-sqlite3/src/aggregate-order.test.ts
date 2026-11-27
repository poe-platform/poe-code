import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const { sql, expected } of [
  { sql: "select group_concat(x order by x desc) from (select 1 x union all select 2 union all select 3);", expected: "3,2,1\n" },
  { sql: "select string_agg(x, ':' order by x desc) filter (where x > 1), group_concat(x) from (select 1 x union all select 2 union all select 3);", expected: "3:2|1,2,3\n" },
  { sql: "create table t(x, k); insert into t values ('a',NULL),('b',1),('c',1),('d',2); select group_concat(x, ':' order by k asc nulls last, x desc) from t;", expected: "c:b:d:a\n" },
  { sql: "create table t(x text collate nocase); insert into t values ('a'),('B'),('c'),(NULL); select group_concat(x order by x desc), group_concat(distinct x order by x asc) from t;", expected: "c,B,a|a,B,c\n" },
  { sql: "select group_concat(x order by x) from (select 1 x) where 0;", expected: "\n" }
]) {
  test(`aggregate ORDER BY: ${sql}`, async () => {
    const args = [":memory:", sql];
    const stdin = createBytePipe();
    await stdin.close();
    const stdout = createBytePipe();
    const stderr = createBytePipe();
    const output = collectBytes(stdout.readable, { maxBytes: Infinity });
    const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
    const result = await createSqlite3Command().execute({
      command: "sqlite3", args: createCommandArguments(args).args,
      stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
      fs: createMemoryFileSystem(), cwd: "/work", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.equal(Buffer.from(await output).toString(), expected);
    assert.equal(evalSyncSqlite3(undefined, args), expected);
  });
}
