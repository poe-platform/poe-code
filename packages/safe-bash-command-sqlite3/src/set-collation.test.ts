import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, type Sqlite3CommandsOptions } from "./index.js";

for (const op of ["INTERSECT", "EXCEPT"]) {
  for (const { name, left, right, equal } of [
    { name: "explicit NOCASE", left: "'a' COLLATE NOCASE", right: "'A'", equal: true },
    { name: "right fallback", left: "'a'", right: "'A' COLLATE NOCASE", equal: true },
    { name: "BINARY precedence", left: "'a' COLLATE BINARY", right: "'A' COLLATE NOCASE", equal: false },
    { name: "ASCII only", left: "'é' COLLATE NOCASE", right: "'É'", equal: false },
    { name: "RTRIM", left: "'a ' COLLATE RTRIM", right: "'a'", equal: true },
    { name: "NULL", left: "NULL", right: "NULL", equal: true },
    { name: "numeric equality", left: "1", right: "1.0", equal: true },
    { name: "storage classes", left: "1", right: "'1'", equal: false }
  ]) {
    test(`sqlite3 ${op}: ${name}`, async () => {
      const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:",
        `SELECT ${left} AS v ${op} SELECT ${right};`]);
      const original = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:", `SELECT ${left} AS v;`]);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout || "[]"), equal === (op === "INTERSECT") ? JSON.parse(original.stdout) : []);
    });
  }
  test(`sqlite3 ${op}: declared collation, duplicates and multiple columns`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:",
      `CREATE TABLE t(v TEXT COLLATE NOCASE, n INTEGER);
       INSERT INTO t VALUES ('a',1),('A',1),('a',2),('b',1);
       SELECT v,n FROM t ${op} SELECT 'A',1;`]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), op === "INTERSECT" ? [{v:"A",n:1}] : [{v:"a",n:2},{v:"b",n:1}]);
  });
}

async function runSqlite3(
  fs: FileSystem,
  args: string[],
  stdinText = "",
  options: Sqlite3CommandsOptions = {},
  signal = new AbortController().signal
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdin = createBytePipe();
  if (stdinText) {
    await writeText(stdin.writable, stdinText);
  }
  await stdin.close();

  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const output = collectBytes(stdout.readable, { maxBytes: Infinity });
  const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
  const cmd = createSqlite3Command(options);
  let res;
  try { res = await cmd.execute({
    command: "sqlite3",
    args: createCommandArguments(args).args,
    stdin: stdin.readable,
    stdout: stdout.writable,
    stderr: stderr.writable,
    fs,
    cwd: "/",
    env: {},
    signal
  }); } finally { await stdout.close(); await stderr.close(); }
  const [outBytes, errBytes] = await Promise.all([output, errors]);
  return {
    code: res.exitCode,
    stdout: Buffer.from(outBytes).toString("utf8"),
    stderr: Buffer.from(errBytes).toString("utf8")
  };
}
