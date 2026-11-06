import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments, writeText } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3, type Sqlite3CommandsOptions } from "./index.js";

for (const [flags, data, expected] of [
  ["--ascii", "a\x1fb\x1ec\x1fd\x1e", "61|62\n63|64\n"],
  ["--csv --ascii", '"a\n"\x1fb\r\n\x1e\x1f', "22610A22|620D0A\n|\n"],
  ["--ascii --skip 1", "header\x1fother\x1ea\x1fb", "61|62\n"],
  ["--ascii --csv", 'a,b\nc,d\n', "61|62\n63|64\n"]
]) {
  test(`ASCII import separators and literal data: ${flags}`, async () => {
    const fs = createMemoryFileSystem();
    const bytes = new TextEncoder().encode(data);
    await fs.writeFile("/rows", bytes);
    const script = `CREATE TABLE t(a,b);\n.import ${flags} /rows t\nSELECT hex(a),hex(b) FROM t;`;
    assert.deepEqual(await runSqlite3(fs, [":memory:"], script), { code: 0, stdout: expected, stderr: "" });
    assert.equal(evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => bytes), expected);
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
