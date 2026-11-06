import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const hint of ["", "MATERIALIZED ", "NOT MATERIALIZED "]) {
  for (const used of [false, true]) {
    test(`${used ? "used" : "unused"} ${hint}CTE with a missing table`, async () => {
      const sql = `WITH a AS ${hint}(SELECT n FROM missing) SELECT ${used ? "* FROM a" : "1"};`;
      const args = [":memory:", sql];
      const stdin = createBytePipe();
      await stdin.close();
      const stdout = createBytePipe();
      const stderr = createBytePipe();
      const output = collectBytes(stdout.readable, { maxBytes: Infinity });
      const errors = collectBytes(stderr.readable, { maxBytes: Infinity });
      let result;
      try {
        result = await createSqlite3Command({ limits: { maxRows: 200 } }).execute({
          command: "sqlite3", args: createCommandArguments(args).args,
          stdin: stdin.readable, stdout: stdout.writable, stderr: stderr.writable,
          fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal
        });
      } finally {
        await stdout.close();
        await stderr.close();
      }
      assert.equal(result.exitCode, used ? 1 : 0);
      assert.equal(new TextDecoder().decode(await output), used ? "" : "1\n");
      assert.equal(new TextDecoder().decode(await errors), used ? "Error: no such table: missing\n" : "");
      if (!used) assert.equal(evalSyncSqlite3(new Uint8Array(), args), "1\n");
    });
  }
}
