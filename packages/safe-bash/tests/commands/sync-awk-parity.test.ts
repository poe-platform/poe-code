import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["abc", '{ print index($1, "") }', "1"],
  ["😀b", '{ print length($1), index($1, "b") }', "5 5"],
  ["éB", '{ print toupper($1), tolower($1) }', "éB éb"],
  ["😀b", '{ print substr($1, 5, 1) }', "b"],
  ["😀b", '{ print substr($1, 2, 1) }', "�"],
  ["bé", '{ print index($1, "é") }', "2"],
  ["1e2suffix", '{ print $1 + 1 }', "101"],
  ["1e2", '{ print $1 + 1 }', "101"],
  ["1e2\n2e2", '{ s += $1 } END { print s }', "300"],
  ["100", '-v x=1e2 \'$1 == x { print }\'', "100"],
  ["100", '-v x=+1e2 \'$1 == x { print }\'', "100"],
  ["1.5e-2", '-v x=1e2 \'{ print $1 + x }\'', "100.015"],
  ["a   b", '{ sub(/nomatch/, "x", $1); print $0 }', "a   b"],
  ["a   b", '{ gsub(/nomatch/, "x", $1); print $0 }', "a   b"],
  ["a   b", '{ sub(/a/, "a", $1); print $0 }', "a b"],
];
for (const [input, program, expected] of cases) {
  test(`sync awk parity: ${program} on ${input}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    await shell.use(textProgramCommands());
    try {
      const args = program!.startsWith("-v") ? program : `'${program}'`;
      const command = `printf '%s\\n' '${input}' | awk ${args}`;
      const direct = await shell.exec(command);
      assert.equal(direct.exitCode, 0);
      assert.equal(direct.stdout, `${expected}\n`);
      const loop = await shell.exec(`for i in 1 2; do x=$(${command}); done; printf '%s\\n' "$x"`);
      assert.equal(loop.exitCode, 0);
      assert.equal(loop.stderr, "");
      assert.equal(loop.stdout, direct.stdout);
    } finally { await shell.dispose(); }
  });
}
