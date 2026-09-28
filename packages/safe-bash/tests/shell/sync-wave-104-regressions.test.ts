import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";

const cases = [
  ["unique field key", "a:2\na:1\nb:1\n", "sort -t: -k1,1 -u", "a:2\nb:1\n", 0],
  ["unique numeric key", "01\n1\n", "sort -nu", "01\n", 0],
  ["literal key whitespace", "a\tz\na b\n", "sort -k1,2", "a\tz\na b\n", 0],
  ["field leading blanks", "x  b\nx a\n", "sort -k2,2", "x  b\nx a\n", 0],
  ["complement translation", "1", "tr -c '0' 'A-Za-z'", "w", 0],
  ["invalid translation class", "1", "tr -c '0' '[:alpha:]'", "", 1],
  ["negative field", "onlyone\n", "awk '{ print $(NF - 2) }'", "", 2],
  ["zero field", "x y\n", "awk '{ print $(NF - 2) }'", "x y\n", 0],
  ["positive field", "x y z\n", "awk '{ print $(NF - 2) }'", "x\n", 0],
  ...["NFNR", "NRNF", "lengthNR", "lengthNF"].map(name => [name, "x y\n", `awk '{ print ${name} }'`, "\n", 0] as const),
  ["identifier concatenation", "x y\n", "awk '{ print NF NR }'", "21\n", 0],
] as const;

for (const [name, input, command, stdout, exitCode] of cases) {
  test(`wave 104: ${name}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]) });
    try {
      const direct = await shell.exec(command, { stdin: input });
      assert.equal(direct.stdout, stdout);
      assert.equal(direct.exitCode, exitCode, direct.stderr);
      for (const loop of [false, true]) {
        const result = await shell.exec(`s='${input}'; ${loop ? "for ((i=0;i<3;i++)); do" : ""} out=$(printf '%s' "$s" | ${command}); status=$?; ${loop ? "done;" : ""} printf '%s' "$out"; exit "$status"`);
        assert.equal(result.stdout, stdout.replace(/\n+$/, ""));
        assert.equal(result.exitCode, exitCode);
        assert.equal(result.stderr, direct.stderr.repeat(loop ? 3 : 1));
      }
    } finally { await shell.dispose(); }
  });
}
