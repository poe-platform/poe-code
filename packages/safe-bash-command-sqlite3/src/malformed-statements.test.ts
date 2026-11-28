import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { SqliteDatabase } from "./engine.js";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const sql of ["select 1 +;", "select 2 from; select 3;", "select (2"]) {
  test(`rejects malformed SQL: ${sql}`, () => {
    assert.throws(() => new SqliteDatabase().exec(sql), /syntax error|incomplete input/);
    assert.equal(evalSyncSqlite3(undefined, [":memory:", sql]), undefined);
  });

  for (const stdin of [false, true]) {
    test(`malformed ${stdin ? "stdin" : "argument"} rejects invalid statement: ${sql}`, async () => {
      let stdout = "", stderr = "";
      const result = await createSqlite3Command().execute({
        command: "sqlite3", ...createCommandArguments(stdin ? [":memory:"] : [":memory:", sql]),
        fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield new TextEncoder().encode(sql); } },
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      assert.equal(result.exitCode, 1);
      assert.equal(stdout, stdin && sql === "select 2 from; select 3;" ? "3\n" : "");
      assert.match(stderr, /syntax error|incomplete input/);
    });
  }
}
