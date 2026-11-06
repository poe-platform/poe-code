import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const existing of [false, true]) {
  for (const schema of ["main", "MAIN", "missing"]) {
    const csv = new TextEncoder().encode(`${existing ? "" : "a,b,c,d,e\n"}1,2,3,4,5\n6,7,8,9,10\n`);
    const script = new TextEncoder().encode([
      ...(existing ? ["CREATE TABLE t(a,b,c,d,e);"] : []),
      `.import --csv --schema ${schema} /rows.csv t`,
      existing || schema !== "missing" ? "SELECT count(*),sum(a) FROM t;" : "SELECT count(*) FROM sqlite_master WHERE name='t';"
    ].join("\n"));

    test(`import into ${existing ? "existing" : "new"} table with schema ${schema}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/rows.csv", csv);
      let stdout = "", stderr = "";
      const result = await createSqlite3Command().execute({
        command: "sqlite3", ...createCommandArguments([":memory:"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield script; } },
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      assert.equal(result.exitCode, schema === "missing" ? 1 : 0, stderr);
      assert.equal(stdout, schema === "missing" ? (existing ? "0|\n" : "0\n") : "2|7\n");
      if (schema === "missing") assert.ok(stderr.includes("unknown database"), stderr);
      else assert.equal(stderr, "");
    });

    test(`sync import into ${existing ? "existing" : "new"} table with schema ${schema}`, () => {
      const result = evalSyncSqlite3(script, [":memory:"], path => {
        assert.equal(path, "/rows.csv");
        return csv;
      });
      if (schema === "missing") assert.equal(result, undefined);
      else assert.equal(result, "2|7\n");
    });
  }
}
