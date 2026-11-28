import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,'x'),(1,'z'),(2,'y'),(2,'w');";

for (const { sql, expected } of [
  { sql: `${setup} SELECT a,b,max(rowid) FROM t GROUP BY a;`, expected: "1|z|2\n2|w|4\n" },
  { sql: `${setup} SELECT a,b,min(b) FROM t GROUP BY a;`, expected: "1|x|x\n2|w|w\n" },
  { sql: `${setup} SELECT max(a),b FROM t;`, expected: "2|y\n" },
  { sql: `${setup} SELECT a,b,max(rowid) FROM t GROUP BY a; SELECT a,b,min(b) FROM t GROUP BY a; SELECT max(a),b FROM t;`, expected: "1|z|2\n2|w|4\n1|x|x\n2|w|w\n2|y\n" },
  { sql: `${setup} SELECT *,max(rowid) FROM t GROUP BY a;`, expected: "1|z|2\n2|w|4\n" },
  { sql: `${setup} SELECT b || '!',max(rowid)+1,count(*),group_concat(b) FROM t GROUP BY a HAVING b IN ('z','w') ORDER BY b;`, expected: "w!|5|2|y,w\nz!|3|2|x,z\n" },
  { sql: `${setup} SELECT a,b FROM t GROUP BY a HAVING max(rowid)>0 ORDER BY b;`, expected: "2|w\n1|z\n" },
  { sql: `${setup} SELECT a,b FROM t GROUP BY a ORDER BY max(rowid);`, expected: "1|z\n2|w\n" },
  { sql: `${setup} SELECT b,max(rowid) FILTER (WHERE b!='w') FROM t;`, expected: "y|3\n" },
  { sql: `${setup} SELECT b,max(DISTINCT rowid ORDER BY b) FROM t;`, expected: "w|4\n" },
  { sql: "CREATE TABLE t(k,v TEXT COLLATE NOCASE); INSERT INTO t VALUES('low','a'),('high','Z'); SELECT k,max(v) FROM t; SELECT k,min(v COLLATE BINARY) FROM t;", expected: "high|Z\nhigh|Z\n" },
  { sql: "CREATE TABLE t(k,v); INSERT INTO t VALUES('null',NULL),('low',1),('high',9),('tie',9); SELECT k,max(v),count(*) FROM t; SELECT k,min(v) FROM t;", expected: "high|9|4\nlow|1\n" },
  { sql: "CREATE TABLE t(k,v); SELECT k,max(v) FROM t;", expected: "|\n" },
  { sql: `${setup} SELECT b,sum(a),group_concat(b),max(a,0) FROM t;`, expected: "x|6|x,z,y,w|1\n" },
  { sql: `${setup} SELECT b,max(a) OVER () FROM t;`, expected: "x|2\nz|2\ny|2\nw|2\n" },
  { sql: `${setup} SELECT b,count(*),(SELECT max(rowid) FROM t) FROM t;`, expected: "x|4|4\n" }
]) {
  test(`bare columns with min/max: ${sql}`, async () => {
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
