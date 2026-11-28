import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const { expression, expected } of [
  { expression: "datetime('2024-1-5')", expected: null },
  { expression: "date('Jan 5 2024')", expected: null },
  { expression: "date('2024/01/05')", expected: null },
  { expression: "datetime('2024-01-05 1:02')", expected: null },
  { expression: "date('20240105')", expected: null },
  { expression: "datetime('2024-01-05T01:02')", expected: "2024-01-05 01:02:00" },
  { expression: "datetime('2024-01-05 01:02+02:00')", expected: "2024-01-04 23:02:00" },
  { expression: "datetime('01:02+02:00')", expected: "1999-12-31 23:02:00" },
  { expression: "datetime('2024-01-05')", expected: "2024-01-05 00:00:00" },
  { expression: "datetime(0)", expected: "-4713-11-24 12:00:00" },
  { expression: "datetime(0, 'unixepoch')", expected: "1970-01-01 00:00:00" }
]) {
  test(`sqlite3 date input: ${expression}`, async () => {
    const sql = `SELECT ${expression} AS value;`;
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
