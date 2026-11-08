import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3, type Sqlite3CommandsOptions } from "./index.js";

for (const [mode, expected] of [
  ["list", "A||AB|9223372036854775807\n"],
  ["csv", "A,,AB,9223372036854775807\r\n"],
  ["json", '[{"n":"A","z":null,"b":"\\u0041\\u0042","i":9223372036854775807}]\n'],
  ["quote", "'A',NULL,X'4142',9223372036854775807\n"],
  ["insert t", "INSERT INTO t VALUES('A',NULL,X'4142',9223372036854775807);\n"]
]) {
  test(`TEXT NUL truncation in ${mode} preserves other storage classes`, async () => {
    const script = `.mode ${mode}\nSELECT char(65,0,66) AS n,NULL AS z,x'4142' AS b,9223372036854775807 AS i;`;
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:"], script),
      {code: 0, stdout: expected, stderr: ""});
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  });
}

test("dump truncates TEXT at NUL without changing stored bytes and restores valid SQL", async () => {
  const script = "CREATE TABLE t(n);\nINSERT INTO t VALUES('a''z'||char(0)||'b'),(char(0)),('');\n.dump";
  const expected = "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE t(n);\n" +
    "INSERT INTO \"t\" VALUES('a''z');\nINSERT INTO \"t\" VALUES('');\nINSERT INTO \"t\" VALUES('');\nCOMMIT;\n";
  const fs = createMemoryFileSystem();
  const result = await runSqlite3(fs, ["/test.db"], script);
  assert.deepEqual(result, {code: 0, stdout: expected, stderr: ""});
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]), expected);
  assert.deepEqual(await runSqlite3(fs, ["/test.db", "SELECT hex(n) FROM t;"]),
    {code: 0, stdout: "61277A0062\n00\n\n", stderr: ""});
  assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:"], result.stdout + "SELECT hex(n) FROM t;"),
    {code: 0, stdout: "61277A\n\n\n", stderr: ""});
});

test("JSON preserves every BLOB byte, including NUL, without changing TEXT rendering", async () => {
  const script = ".mode json\nSELECT hex(x'00ff') AS hx,x'00ff' AS b,x'41004200' AS middle,x'' AS empty,x'22415c08090a0c0d1f7f80c3a9' AS bytes,char(65,0,66) AS text;";
  const expected = [{ hx: "00FF", b: "\0ÿ", middle: "A\0B\0", empty: "",
    bytes: String.fromCharCode(0x22, 0x41, 0x5c, 8, 9, 10, 12, 13, 31, 127, 128, 195, 169), text: "A" }];
  const result = await runSqlite3(createMemoryFileSystem(), [":memory:"], script);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  const syncOutput = evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"]);
  assert.ok(syncOutput);
  assert.equal(syncOutput, result.stdout);
  assert.deepEqual(JSON.parse(syncOutput), expected);
});

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
