import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "@poe-code/safe-js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

test("node exposes TextEncoder through the injected SafeJS runtime", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime: {
    run, makeFsModule, declareHostOperation, createBudget: options => new Budget(options),
  } }));
  try {
    const result = await shell.exec('node -e \'console.log(new TextEncoder().encode("abc").length)\' a b');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "3\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
