import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const terminator of [";&", ";;&"]) {
  test(`case ${terminator} never replays output or mutations on fallback`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`cnt=0; case foo in foo) cnt=$((cnt+1)); echo "clause1:$cnt" ${terminator} foo|bar) if [ -e /dev/null ]; then cnt=$((cnt+10)); echo "clause2:$cnt"; fi ;; esac; echo "final:$cnt"`);
    assert.equal(result.stdout, "clause1:1\nclause2:11\nfinal:11\n");
    assert.equal(result.exitCode, 0);
  });
}

