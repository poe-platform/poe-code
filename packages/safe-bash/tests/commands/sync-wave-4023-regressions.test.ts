import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["sed digits", "123\\n", "sed 's/[0-9]*/X/g'", "X"],
  ["sed adjacent", "a12b\\n", "sed 's/[0-9]*/X/g'", "XaXbX"],
  ["sed whitespace", "a  b\\n", "sed 's/[ \\t]*/X/g'", "XaXbX"],
  ["sed backreference", "a\\\\1\\n", "sed -E 's/(a).*/&\\1/'", "a\\1a"],
  ["awk match", "foo\\n", "awk '{ sub(/foo/, \"[&]\"); print }'", "[foo]"],
  ["awk global", "foo\\n", "awk '{ gsub(/o/, \"(&)\"); print }'", "f(o)(o)"],
  ["awk dollar", "foo\\n", "awk '{ sub(/foo/, \"a$$b\"); print }'", "a$$b"],
  ["awk variable", "1\\n2\\n", "awk -v s=10 '{ s += $1 } END { print s }'", "13"],
  ["jq ordering", "[1,\"0\",null,true,false]\\n", "jq -c 'unique'", "[null,false,true,1,\"0\"]"],
  ["version tilde", "1.0\\n1.0~rc1\\n", "sort -V", "1.0~rc1\n1.0"],
  ["version letter", "a-\\naa\\n", "sort -V", "aa\na-"],
  ["version punctuation", "a-b\\na.b\\n", "sort -V", "a.b\na-b"],
  ["tr octal", "ABC\\n", "tr '\\101-\\103' 'xyz'", "xyz"],
  ["jq null boolean", "[false,null]\\n", "jq -c 'unique'", "[null,false]"],
  ["awk initialized empty", "", "awk -v s=10 '{ s += $1 } END { print s }'", "10"],
  ["awk BEGIN overrides variable", "1\\n2\\n", "awk -v s=10 'BEGIN { s = 20 } { s += $1 } END { print s }'", "23"],
  ["awk field replacement", "foo bar\\n", "awk '{ sub(/foo/, \"[$&]\", $1); print }'", "[$foo] bar"],
  ["tr escaped start", "ABC\\n", "tr '\\101-C' 'xyz'", "xyz"],
  ["tr escaped end", "ABC\\n", "tr 'A-\\103' 'xyz'", "xyz"],
  ["version key", "x 1.0\\nx 1.0~rc1\\n", "sort -k2V", "x 1.0~rc1\nx 1.0"],
  ["sed second match after empty", "a12b\\n", "sed 's/[0-9]*/X/2'", "aXb"],
  ["sed third match skips adjacent empty", "a12b\\n", "sed 's/[0-9]*/X/3'", "a12bX"],
  ["sed absent second match", "123\\n", "sed 's/[0-9]*/X/2'", "123"],
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
