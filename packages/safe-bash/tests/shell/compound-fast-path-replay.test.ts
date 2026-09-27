import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const match of [
  '[[ $s == "$pfx"* ]]',
  '[[ $s == a\\** ]]',
  'case $s in "$pfx"*) true ;; *) false ;; esac',
]) {
  test(`escaped star followed by wildcard: ${match}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`pfx='a*'; s='a*hello'; if ${match}; then echo MATCH; else echo MISS; fi`);
      assert.equal(result.stdout, "MATCH\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
