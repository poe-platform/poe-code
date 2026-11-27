import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const { name, sql, expected } of [
  {
    name: "filters by all columns and compares literal rows",
    sql: "create table t(a,b); insert into t values(1,2),(1,3); select * from t where (a,b) = (1,3); select (1,2) = (1,3), (1,2) < (1,3);",
    expected: "1|3\n0|1\n"
  },
  {
    name: "compares rows lexicographically with every comparison operator",
    sql: "select (1,2) == (1,2), (1,2) != (1,3), (1,2) <> (1,2), (1,2) <= (1,2), (1,3) > (1,2), (1,2) >= (1,3), (1,9,0) < (2,0,0);",
    expected: "1|1|0|1|1|0|1\n"
  },
  {
    name: "handles unknown and decisive NULL comparisons",
    sql: "select (1,NULL) = (1,2), (1,NULL,3) = (1,2,4), (1,NULL,3) != (1,2,4), (1,NULL) < (1,2), (1,NULL) < (2,0), (1,NULL) IS (1,NULL), (1,NULL) IS NOT (1,2);",
    expected: "|0|1||1|1|1\n"
  },
  {
    name: "traverses aggregate expressions in row values",
    sql: "create table t(a,b); insert into t values(1,2),(1,3); select (sum(a),sum(b)) = (2,5) from t;",
    expected: "1\n"
  },
  {
    name: "skips later elements once the result is known",
    sql: "select (1,abs(-9223372036854775808)) < (2,0), (1,abs(-9223372036854775808)) = (2,0);",
    expected: "1|0\n"
  },
  {
    name: "uses each column's affinity and collation",
    sql: "create table t(a INTEGER,b TEXT COLLATE NOCASE); insert into t values(1,'a'); select (a,b) = ('1','A'), (a,b) < ('1','B'), (a,b COLLATE BINARY) = ('1','A') from t;",
    expected: "1|1|0\n"
  }
]) {
  test(`sqlite3 row values: ${name}`, async () => {
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
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
    });
    await stdout.close();
    await stderr.close();
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(await errors).toString(), "");
    assert.equal(Buffer.from(await output).toString(), expected);
    assert.equal(evalSyncSqlite3(undefined, args), expected);
  });
}

for (const expression of ["(1,2)", "(1,2) = 1", "1 = (1,2)", "(1,2) = (1,2,3)", "(1,2) + (1,2)"]) {
  test(`sqlite3 rejects misused row values: ${expression}`, () => {
    assert.throws(() => new SqliteDatabase().exec(`SELECT ${expression}`), /row value misused/);
  });
}
