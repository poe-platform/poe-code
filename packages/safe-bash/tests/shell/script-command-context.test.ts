import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { columnCommands } from "../../src/commands/column/index.js";
import { getCommandArguments } from "../../src/contracts/index.js";

for (const interpreter of ["sh", "bash"]) {
  test(`${interpreter} VFS commands retain their own command context and execution scope`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode("a 1\nlong 2\n"));
    await fs.writeFile("/run.sh", new TextEncoder().encode("witness -t /input | cat"));
    const shell = new Shell({ fs }).use(standardCommands()).use(columnCommands());
    let witnessed = false;
    shell.commands.register({ name: "witness", async execute(context) {
      assert.equal(context.command, "witness");
      assert.deepEqual(context.args, ["-t", "/input"]);
      assert.deepEqual(getCommandArguments(context).args, context.args);
      assert.equal(typeof context.executionScope, "object");
      witnessed = true;
      return shell.commands.get("column")!.execute(context);
    } });
    try {
      const result = await shell.exec(`${interpreter} /run.sh`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "a     1\nlong  2\n");
      assert.equal(witnessed, true);
    } finally { await shell.dispose(); }
  });
}
