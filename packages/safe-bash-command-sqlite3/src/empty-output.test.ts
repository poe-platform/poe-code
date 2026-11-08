import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

const setup = `CREATE TABLE a(dep TEXT,leftpos INTEGER);
  INSERT INTO a VALUES ('@poe-code/safe-fs',1),('safe-bash-contracts',2),
    ('safe-bash-query-engine',3),('safe-bash-byte-engine',4),('safe-bash-io-engine',5);
  CREATE TABLE b(dep TEXT,rightpos INTEGER);
  INSERT INTO b VALUES ('safe-bash-contracts',1),('safe-bash-regex-engine',2),('@poe-code/safe-fs',3);`;
const query = "SELECT * FROM a NATURAL JOIN (SELECT dep AS dep,rightpos AS leftpos FROM b) q ORDER BY dep;";

for (const mode of ["list", "csv", "column", "line", "json", "tabs", "html", "markdown", "box", "table", "quote", "ascii", "insert"]) {
  for (const suffix of ["", "SELECT 1 AS present;"]) {
    test(`empty join emits no ${mode} output before ${suffix || "end of input"}`, async () => {
      const args = ["-header", "-nullvalue", "NULL", "-cmd", `.mode ${mode}`, ":memory:", setup, query + suffix];
      const expected = suffix ? evalSyncSqlite3(undefined, ["-header", "-cmd", `.mode ${mode}`, ":memory:", suffix]) : "";
      let stdout = "", stderr = "";
      const result = await createSqlite3Command().execute({
        command: "sqlite3", ...createCommandArguments(args),
        fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, expected);
      assert.equal(evalSyncSqlite3(undefined, args), expected);
    });
  }
}
