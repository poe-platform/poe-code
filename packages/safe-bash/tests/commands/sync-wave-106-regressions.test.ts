import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["float sum", "0.1\\n0.2\\n", "awk '{ s += $1 } END { print s }'", "0.3"],
  ["rounded sum", "1.23456789\\n0\\n", "awk '{ s += $1 } END { print s }'", "1.23457"],
  ["float subtraction", "0.1\\n0.2\\n", "awk '{ s -= $1 } END { print s }'", "-0.3"],
  ["small sum", "0.000001\\n0\\n", "awk '{ s += $1 } END { print s }'", "1e-06"],
  ["initialized float", "1\\n", "awk 'BEGIN { s = 0.2 } { s += $1 } END { print s }'", "1.2"],
  ["integer sum", "1\\n2\\n", "awk '{ s += $1 } END { print s }'", "3"],
  ["NF", "a b\\nc d\\n", "awk '{ NF += 1 } END { print NF }'", "3"],
  ["NR", "a\\nb\\n", "awk '{ NR += 10 } END { print NR }'", "22"],
  ["FNR", "a\\nb\\n", "awk '{ FNR += 10 } END { print FNR }'", "22"],
  ["delete second", "a\\nb", "sed '2d' | wc -c", "2"],
  ["delete last", "a\\nb", "sed '$d' | wc -c", "2"],
  ["print first", "a\\nb", "sed -n '1p' | wc -c", "2"],
  ["print then delete", "a\\nb", "sed -n '1p;2d' | wc -c", "2"],
  ["retain last", "a\\nb", "sed -n '2p' | wc -c", "1"],
  ["duplicate last", "a\\nb", "sed 'p' | wc -c", "7"],
  ["transform and delete", "a\\nb", "sed 's/a/x/;2d' | wc -c", "2"],
  ["identical lines", "a\\na", "sed '$d' | wc -c", "2"],
  ["duplicate earlier line", "a\\nb", "sed '1p;$d' | wc -c", "4"],
  ["print last then delete", "a\\nb", "sed -n '$p;$d' | wc -c", "1"],
] as const;

for (const [name, input, filter, expected] of cases) {
  for (const mode of ["pipeline", "substitution", "loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]) });
      try {
        const pipeline = `printf '${input}' | ${filter}`;
        const source = mode === "pipeline" ? pipeline : mode === "substitution"
          ? `out=$(${pipeline}); printf '%s\\n' "$out"`
          : `for i in 1 2; do out=$(${pipeline}); done; printf '%s\\n' "$out"`;
        const result = await shell.exec(source);
        assert.equal(result.stdout.trim(), expected);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
