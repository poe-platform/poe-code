import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases = [
  ["sed '1d;2d'", "a\\nb\\nc\\n", "c"],
  ["sed -e 1d -e 2d", "a\\nb\\nc\\n", "c"],
  ["sed '1d;1d'", "a\\nb\\n", "b"],
  ["sed '1,2d;3d'", "a\\nb\\nc\\nd\\n", "d"],
  ["sed 's/a/b/;1d;2d'", "a\\nb\\nc\\n", "c"],
  ["grep -Eo 'a|ab'", "ab\\n", "ab"],
  ["grep -oE 'a|ab|abc'", "abcab\\n", "abc\nab"],
  ["grep -Eo 'b|ab'", "ab\\n", "ab"],
] as const;

for (const [command, input, expected] of cases) {
  test(`substitution preserves text command semantics: ${command}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    for (let warmup = 0; warmup < 2; warmup++) {
      const result = await shell.exec(`echo "$(printf '${input}' | ${command})"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected + "\n");
      assert.equal(result.stderr, "");
    }
  });
}

for (const delimiter of ["\\:", "\\:\\:", "\\:\\:\\:"]) {
  test(`nl here-string substitution honors page delimiter ${delimiter}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
    t.after(() => shell.dispose());
    const command = `nl <<< $'a\\n${delimiter.replaceAll("\\", "\\\\")}\\nb'`;
    const direct = await shell.exec(command);
    assert.equal(direct.exitCode, 0, direct.stderr);
    assert.equal(direct.stdout, delimiter === "\\:\\:" ? "     1\ta\n\n     1\tb\n" : "     1\ta\n\n       b\n");
    for (let warmup = 0; warmup < 2; warmup++) {
      const result = await shell.exec(`echo "$( ${command} )"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, direct.stdout);
    }
  });
}
