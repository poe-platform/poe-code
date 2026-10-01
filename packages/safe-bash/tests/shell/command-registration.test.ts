import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { searchCommands } from "../../src/commands/search/index.js";
import { grepCommands } from "../../src/commands/grep/index.js";
import { whichCommands } from "../../src/commands/which/index.js";

for (const search of [searchCommands, grepCommands]) {
  test(`${search.name} does not grant unrelated command capabilities`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(search()).use(whichCommands());
    context.after(() => shell.dispose());
    for (const name of ["sqlite3", "bc", "fd", "sponge", "less"]) {
      assert.equal(shell.commands.has(name), false);
      assert.equal((await shell.exec(`which ${name}`)).exitCode, 1);
      const discovered = await shell.exec(`command -v ${name}`);
      assert.equal(discovered.exitCode, 1, `${name} must not be discoverable`);
      assert.equal(discovered.stdout, "");
      assert.equal((await shell.exec(`${name} --help`)).exitCode, 127);
    }
  });
}
