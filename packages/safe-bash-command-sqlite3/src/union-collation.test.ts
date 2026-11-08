import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, type Sqlite3CommandsOptions } from "./index.js";

for (const { name, sql, rows } of [
  { name: "explicit NOCASE", sql: "SELECT v COLLATE NOCASE AS v FROM t WHERE v='a' UNION SELECT v COLLATE NOCASE FROM t WHERE v='A'", rows: [{v: "A"}] },
  { name: "UNION ALL", sql: "SELECT v COLLATE NOCASE AS v FROM t WHERE v='a' UNION ALL SELECT v COLLATE NOCASE FROM t WHERE v='A'", rows: [{v: "a"}, {v: "A"}] },
  { name: "declared NOCASE", sql: "SELECT n AS v FROM t WHERE v='a' UNION SELECT n FROM t WHERE v='A'", rows: [{v: "A"}] },
  { name: "right fallback", sql: "SELECT 'a' AS v UNION SELECT 'A' COLLATE NOCASE", rows: [{v: "A"}] },
  { name: "left BINARY precedence", sql: "SELECT 'a' COLLATE BINARY AS v UNION SELECT 'A' COLLATE NOCASE", rows: [{v: "A"}, {v: "a"}] },
  { name: "declared BINARY precedence", sql: "SELECT v FROM t WHERE v='a' UNION SELECT v COLLATE NOCASE FROM t WHERE v='A'", rows: [{v: "A"}, {v: "a"}] },
  { name: "ASCII only", sql: "SELECT 'é' COLLATE NOCASE AS v UNION SELECT 'É'", rows: [{v: "É"}, {v: "é"}] },
  { name: "multiple columns", sql: "SELECT 'a' COLLATE NOCASE AS v, 1 AS n UNION SELECT 'A', 2 UNION SELECT 'A', 1", rows: [{v: "A", n: 1}, {v: "A", n: 2}] },
  { name: "RTRIM", sql: "SELECT 'a ' COLLATE RTRIM AS v UNION SELECT 'a'", rows: [{v: "a"}] },
  { name: "NULL and numeric equality", sql: "SELECT NULL AS v UNION SELECT NULL UNION SELECT 1 UNION SELECT 1.0 UNION SELECT '1'", rows: [{v: null}, {v: 1}, {v: "1"}] },
  { name: "empty table", sql: "DELETE FROM t; SELECT n AS v FROM t UNION SELECT 'a' UNION SELECT 'A'", rows: [{v: "A"}] },
  { name: "empty left arm", sql: "SELECT n AS v FROM t WHERE 0 UNION SELECT 'a' UNION SELECT 'A'", rows: [{v: "A"}] }
]) {
  test(`sqlite3 UNION collation: ${name}`, async () => {
    const result = await runSqlite3(createMemoryFileSystem(), ["-json", ":memory:",
      `CREATE TABLE t(v TEXT, n TEXT COLLATE NOCASE); INSERT INTO t VALUES('a','a'),('A','A'); ${sql};`]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), rows);
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
