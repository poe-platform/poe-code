import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const sources: [string, string][] = [
  ['arr=(10 20); v=arr; for i in 1 2; do (( x = $v )); done; echo "x=$x"', "x=10\n"],
  ['arr=(10 20); v=arr; for i in 1 2; do (( $v = 99 )); done; echo "${arr[0]} ${arr[1]}"', "99 20\n"],
  ['arr=(10 20); v=arr; for i in 1 2; do (( ${v} = 99 )); done; echo "${arr[0]} ${arr[1]}"', "99 20\n"],
  ['declare -u u; v=u; for i in 1 2; do (( $v = 5 )); done; echo "$u"', "5\n"],
  ['v=IFS; for i in 1 2; do (( $v = 2 )); echo $((121)); done', "1 1\n1 1\n"],
  ['s=hello; for LC_ALL in C C; do echo "${s@Q}"; done', "'hello'\n'hello'\n"],
  ['s=hello; for LC_COLLATE in C C; do echo "${s@Q}"; done', "'hello'\n'hello'\n"],
  ['for IFS in 2 2; do echo $((121)); done', "1 1\n1 1\n"],
];

const cases = sources.flatMap(([source, stdout]): [string, string][] => source.includes("for i in 1 2")
  ? [
      [source, stdout],
      [source.replace("for i in 1 2", "for ((i=1;i<=2;i++))"), stdout],
      [source.replace("for i in 1 2", "i=0; while ((i++<2))"), stdout],
    ]
  : [[source, stdout]]);

for (const [source, stdout] of cases) {
  test(`expanded arithmetic and control loop variables: ${source}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, stdout);
    } finally {
      await shell.dispose();
    }
  });
}
