import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const { expression, expected } of [
  { expression: "NULLIF('a' COLLATE NOCASE,'A')", expected: null },
  { expression: "NULLIF('a','A' COLLATE NOCASE)", expected: null },
  { expression: "NULLIF('a' COLLATE BINARY,'A' COLLATE NOCASE)", expected: "a" },
  { expression: "NULLIF(n,'A' COLLATE BINARY)", expected: null },
  { expression: "NULLIF(b,'A' COLLATE NOCASE)", expected: "a" },
  { expression: "NULLIF(n COLLATE BINARY,'A')", expected: "a" },
  { expression: "NULLIF('a ','a' COLLATE RTRIM)", expected: null },
  { expression: "NULLIF('a','A')", expected: "a" },
  { expression: "NULLIF('é' COLLATE NOCASE,'É')", expected: "é" },
  { expression: "NULLIF(NULL COLLATE NOCASE,'A')", expected: null },
  { expression: "NULLIF('a' COLLATE NOCASE,NULL)", expected: "a" }
]) {
  test(`sqlite3 collation: ${expression}`, async () => {
    const sql = `CREATE TABLE t(n TEXT COLLATE NOCASE, b TEXT);
      INSERT INTO t VALUES('a','a'); SELECT ${expression} AS value FROM t;`;
    const args = ["-json", ":memory:", sql];
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
    assert.deepEqual(JSON.parse(Buffer.from(await output).toString()), [{ value: expected }]);
    assert.deepEqual(JSON.parse(evalSyncSqlite3(undefined, args)!), [{ value: expected }]);
  });
}
