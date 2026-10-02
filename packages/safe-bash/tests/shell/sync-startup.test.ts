import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/command.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/node.js";

// Execute during module evaluation, before queued initialization microtasks run.
const fs = new MemoryFileSystem();
const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
const first = shell.exec(": >/ready; printf ready", { signal: new AbortController().signal });

test("first execution can redirect and capture output before a microtask turn", async () => {
  try {
    const result = await first;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "ready");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/ready"), new Uint8Array());
    const again = await shell.exec("printf again");
    assert.equal(again.stdout, "again");
    assert.equal(again.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});
