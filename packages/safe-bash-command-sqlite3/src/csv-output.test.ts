import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3, type Sqlite3CommandsOptions } from "./index.js";

for (const args of [[":memory:"], ["-csv", ":memory:"]]) {
  test(`sqlite3 CSV preserves NULL and empty text through ${args[0]}`, async () => {
    const input = (args[0] === "-csv" ? "" : ".mode csv\n") + "SELECT NULL,'',0,' ';";
    const stdout = ',"",0," "' + (args[0] === "-csv" ? "\n" : "\r\n");
    assert.deepEqual(await runSqlite3(createMemoryFileSystem(), args, input), {
      code: 0, stdout, stderr: ""
    });
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(input), args), stdout);
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

