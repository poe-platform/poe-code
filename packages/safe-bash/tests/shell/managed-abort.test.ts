import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, createAgentCommands, Shell } from "../../src/core.js";

for (const [script, stdout] of [
  ["touch /file && ls /file", "/file\n"],
  ["touch /file && ls /file | cat", "/file\n"],
  ["printf '%s\\n' alpha beta | cat", "alpha\nbeta\n"],
] as const) {
  test(`managed object waiters support shell execution: ${script}`, async context => {
    const shell = new Shell({
      fs: createMemoryFileSystem(),
      commands: new CommandRegistry(createAgentCommands()),
    });
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
  });
}
