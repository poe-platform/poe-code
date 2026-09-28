import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const outer of ["set -- echo", "set --"]) {
  test(`function discovery substitution uses local positionals: ${outer}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`has_cmd() { command -v "$1"; }; kind_of() { type -t "$1"; }; ${outer}; printf '%s %s\\n' "$(has_cmd printf)" "$(kind_of for)"; printf '<%s>\\n' "$1"`);
    assert.equal(result.stdout, `printf keyword\n<${outer === "set -- echo" ? "echo" : ""}>\n`);
    assert.equal(result.exitCode, 0);
  });
}

