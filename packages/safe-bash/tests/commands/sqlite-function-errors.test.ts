import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("sqlite3 invalid functions report errors and set the shell status", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec(`sqlite3 :memory: "select nofunc(1);"; echo "rc=$?";
      sqlite3 :memory: "select max();"; echo "rc=$?";
      sqlite3 :memory: "select substr('a');"; echo "rc=$?"`);
    assert.equal(result.stdout, "rc=1\nrc=1\nrc=1\n");
    assert.equal(result.stderr, "Error: in prepare, no such function: nofunc\n" +
      "Error: in prepare, wrong number of arguments to function max()\n" +
      "Error: in prepare, wrong number of arguments to function substr()\n");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});
