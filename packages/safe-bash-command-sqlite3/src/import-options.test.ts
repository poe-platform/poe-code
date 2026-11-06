import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createSqlite3Command, evalSyncSqlite3 } from "./index.js";

for (const existing of [false, true]) {
  const script = [
    ...(existing ? ["CREATE TABLE t(a,b,c,d,e);"] : []),
    ".import --csv --bogus /rows.csv t",
    existing ? "SELECT count(*) FROM t;" : "SELECT count(*) FROM sqlite_master WHERE name='t';"
  ].join("\n");

  test(`unknown import switch rejects before ${existing ? "inserting rows" : "creating a table"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/rows.csv", new TextEncoder().encode("a,b,c,d,e\n1,2,3,4,5\n"));
    let stdout = "", stderr = "";
    const result = await createSqlite3Command().execute({
      command: "sqlite3", ...createCommandArguments([":memory:"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(script); } },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "0\n");
    assert.ok(stderr.includes('unknown option: "--bogus"'), stderr);
  });

  test(`sync import defers unknown switches before reading input (${existing})`, () => {
    let reads = 0;
    const result = evalSyncSqlite3(new TextEncoder().encode(script), [":memory:"], () => {
      reads++;
      return new TextEncoder().encode("a,b,c,d,e\n1,2,3,4,5\n");
    });
    assert.equal(result, undefined);
    assert.equal(reads, 0);
  });
}
