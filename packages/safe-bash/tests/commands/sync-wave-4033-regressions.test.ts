import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["jq mixed sort", '[{"k":"a"},{"k":1},{"k":true},{"k":false},{"k":null}]\\n', "jq -c 'sort_by(.k)'", '[{"k":null},{"k":false},{"k":true},{"k":1},{"k":"a"}]'],
  ["jq unique types", '[{"k":1},{"k":"1"},{"k":false},{"k":"false"},{"k":null},{"k":"null"}]\\n', "jq -c 'unique_by(.k)'", '[{"k":null},{"k":false},{"k":1},{"k":"1"},{"k":"false"},{"k":"null"}]'],
  ["jq group types", '[{"k":null},{"k":"null"},{"k":null}]\\n', "jq -c 'group_by(.k)'", '[[{"k":null},{"k":null}],[{"k":"null"}]]'],
  ["jq group boolean and number", '[{"k":"false"},{"k":false},{"k":"1"},{"k":1}]\\n', "jq -c 'group_by(.k)'", '[[{"k":false}],[{"k":1}],[{"k":"1"}],[{"k":"false"}]]'],
  ["sed whole range change", "a\\nb\\nc\\n", "sed '1,3c\\REPL'", "REPL"],
  ["sed unterminated insert", "a", "sed '1i\\REPL' | wc -c", "6"],
  ["sed range change", "a\\nb\\nc\\nd\\n", "sed '1,3c\\REPL'", "REPL\nd"],
  ["sed unterminated change", "a", "sed '1c\\REPL' | wc -c", "5"],
  ["sed unterminated append", "a", "sed '1a\\REPL' | wc -c", "7"],
  ["sed quiet insert", "a", "sed -n '1i\\REPL' | wc -c", "5"],
  ["awk decimal precision", "7\\n", `awk '{ printf "%.4d\\n", $1 }'`, "0007"],
  ["awk hex precision", "10\\n", `awk '{ printf "%.4x %.4X\\n", $1, $1 }'`, "000a 000A"],
  ["awk arithmetic precision", "1234567.5\\n", `awk '{ printf "%.1f %d\\n", $1 + 0, $1 + 0 }'`, "1234567.5 1234567"],
  ["awk exponent input", "1.2345675e6\\n", `awk '{ printf "%.1f\\n", $1 + 0 }'`, "1234567.5"],
] as const;

for (const [name, input, filter, expected] of cases) {
  for (const mode of ["pipeline", "substitution", "loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createStructuredCommands()]) });
      try {
        const pipeline = `printf '${input}' | ${filter}`;
        const source = mode === "pipeline" ? pipeline : mode === "substitution"
          ? `out=$(${pipeline}); printf '%s\\n' "$out"`
          : `for i in 1 2; do out=$(${pipeline}); done; printf '%s\\n' "$out"`;
        const result = await shell.exec(source);
        assert.equal(result.stdout, `${expected}\n`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
