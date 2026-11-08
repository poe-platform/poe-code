import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, type Sqlite3CommandsOptions } from "./index.js";

const expected = {
  "column": "id  txt   val\n--  ----  ---\n1   a,b      \n\n2   line  3.5\n    next     \n",
  "markdown": "| id | txt  | val |\n|----|------|-----|\n| 1  | a,b  |     |\n| 2  | line | 3.5 |\n|    | next |     |\n",
  "table": "+----+------+-----+\n| id | txt  | val |\n+----+------+-----+\n| 1  | a,b  |     |\n+----+------+-----+\n| 2  | line | 3.5 |\n|    | next |     |\n+----+------+-----+\n",
  "box": "┌────┬──────┬─────┐\n│ id │ txt  │ val │\n├────┼──────┼─────┤\n│ 1  │ a,b  │     │\n├────┼──────┼─────┤\n│ 2  │ line │ 3.5 │\n│    │ next │     │\n└────┴──────┴─────┘\n"
};

for (const [mode, stdout] of Object.entries(expected)) {
  test(`sqlite3 ${mode} aligns multiline cells and separates logical rows`, async () => {
    const sql = "WITH t(id,txt,val) AS (VALUES(1,'a,b',NULL),(2,'line\nnext',3.5)) SELECT * FROM t ORDER BY id;";
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), [`-${mode}`, "-header", ":memory:", sql]),
      { code: 0, stdout, stderr: "" });
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

test('sqlite3 aligned cells retain blank lines and ignore a final newline', async () => {
  assert.deepEqual(await runSqlite3(createMemoryFileSystem(), ['-table', ':memory:',
    "SELECT '\na\n\n' AS x, 'b\nc\nd' AS y UNION ALL SELECT 'z', 'q';"]), {
    code: 0, stderr: '',
    stdout: '+---+---+\n| x | y |\n+---+---+\n|   | b |\n| a | c |\n|   | d |\n+---+---+\n| z | q |\n+---+---+\n'
  });
});
