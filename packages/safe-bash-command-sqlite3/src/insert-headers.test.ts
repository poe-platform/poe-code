import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3, type Sqlite3CommandsOptions } from "./index.js";

for (const args of [[":memory:"], ["-header", ":memory:"]]) {
  test(`sqlite3 insert headers preserve destination columns through ${args[0]}`, async () => {
    const input = (args[0] === "-header" ? "" : ".headers on\n") + ".mode insert dest\nSELECT 10 AS b,20 AS a UNION ALL SELECT 30,40;";
    const stdout = 'INSERT INTO dest("b","a") VALUES(10,20);\nINSERT INTO dest("b","a") VALUES(30,40);\n';
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), args, input), {code: 0, stdout, stderr: ""});
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(input), args), stdout);
    const replay = "CREATE TABLE dest(a,b);\n" + stdout + "SELECT a,b FROM dest;";
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:"], replay), {
      code: 0, stdout: "20|10\n40|30\n", stderr: ""
    });
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(replay), [":memory:"]), "20|10\n40|30\n");
  });
}

test("sqlite3 insert headers follow toggles and escape column identifiers", async () => {
  const input = '.mode insert dest\nSELECT 1 AS a;\n.headers on\nSELECT 2 AS "a b",3 AS "a""b",4 AS "select";\n.headers off\nSELECT 5 AS a;';
  const stdout = 'INSERT INTO dest VALUES(1);\nINSERT INTO dest("a b","a""b","select") VALUES(2,3,4);\nINSERT INTO dest VALUES(5);\n';
  assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [":memory:"], input), {code: 0, stdout, stderr: ""});
  assert.equal(evalSyncSqlite3(new TextEncoder().encode(input), [":memory:"]), stdout);
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

