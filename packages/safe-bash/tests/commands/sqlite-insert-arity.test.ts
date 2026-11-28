import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("sqlite3 column-count errors stop the SQL batch and set the shell status", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec('sqlite3 :memory: "create table t(a); insert into t values(1,2); select count(*) from t;"; echo "rc=$?"');
    assert.equal(result.stdout, "rc=1\n");
    assert.equal(result.stderr, "Error: in prepare, table t has 1 columns but 2 values were supplied\n");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});
