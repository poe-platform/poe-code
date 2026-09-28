import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases: ReadonlyArray<readonly [string, string, string, string?]> = [
  ["integer precedence", 'for i in 1 2; do declare -i x="1 + 2 * 3"; done; echo "$x"', "7\n"],
  ["integer hex", 'for i in 1 2; do declare -i x="0x10"; done; echo "$x"', "16\n"],
  ["integer shift", 'for i in 1 2; do declare -i x="1 << 4"; done; echo "$x"', "16\n"],
  ["integer ternary", 'a=1; for i in 1 2; do declare -i x="a ? 10 : 20"; done; echo "$x"', "10\n"],
  ["upper assignments", 'for i in 1 2; do declare -u x; x="hello_$i"; done; echo "$x"', "HELLO_2\n"],
  ["lower assignments", 'for i in 1 2; do declare -l x=FIRST; x="SECOND_$i"; done; echo "$x"', "second_2\n"],
  ["integer assignments", 'for i in 1 2; do declare -i x=1; x="2 + 3"; done; echo "$x"', "5\n"],
  ["local attributes restore", 'x=outer; f() { for i in 1 2; do local -u x; x=inner; done; echo "$x"; }; f; x=after; echo "$x"', "INNER\nafter\n"],
  ["zero iteration read", 'arr=scalar; for ((i=0;i<0;i++)); do read -ra arr <<< "a b"; done; declare -p arr', 'declare -- arr="scalar"\n'],
  ["skipped read", 'arr=scalar; for i in 1 2; do ((0)) && read -ra arr <<< "a b"; done; declare -p arr', 'declare -- arr="scalar"\n'],
  ["while diagnostic", 'i=0; while ((i < 3)); do i="1/0"; done; echo after', "after\n", "division by 0"],
  ["body diagnostic", 'for k in 1 2; do x="1/0"; (( y = x + 1 )); done; echo after', "after\n", "division by 0"],
  ["body diagnostic status", 'for k in 1 2; do x="1/0"; (( y = x + 1 )); echo "$?"; done', "1\n1\n", "division by 0"],
  ["invalid variable syntax", 'for k in 1 2; do x="1+"; (( y = x + 1 )); echo "$?"; done; echo after', "1\n1\nafter\n", "syntax error"],
  ["until diagnostic stops", 'i=0; until ((i > 3)); do i="1/0"; done; echo after', "after\n", "division by 0"],
  ["nested diagnostic", 'for k in 1 2; do for j in 1 2; do x="1/0"; (( y = x + 1 )); echo "$?"; done; done', "1\n1\n1\n1\n", "division by 0"],
  ["read executes", 'arr=scalar; for i in 1 2; do read -ra arr <<< "a b"; done; echo "${arr[@]}"', "a b\n"],
  ["integer append", 'for i in 1 2; do declare -i x=1; x+="2 * 3"; done; echo "$x"', "7\n"],
];

for (const [name, source, expected, diagnostic] of cases) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      if (diagnostic) assert.ok(result.stderr.includes(diagnostic), result.stderr);
      else assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally {
      await shell.dispose();
    }
  });
}
