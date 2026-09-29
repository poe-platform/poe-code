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
  ['a="x=42"; for i in 1 2; do echo "$(( ${a} + 1 ))"; done; echo "x=$x"', "43\n43\nx=43\n"],
  ['a="x=42"; for i in 1 2; do out="$(( ${a} + 1 ))"; done; echo "out=$out x=$x"', "out=43 x=43\n"],
  ['arr=(10); a="1 << 3"; for i in 1 2; do echo "$(( ${a} + 1 ))"; done', "16\n16\n"],
  ['arr=(10); a="2 ** 4"; for i in 1 2; do echo "$(( ${a} + 1 ))"; done', "17\n17\n"],
  ['arr=(10 20); for i in 1 2; do echo "$(( arr + i ))"; done', "11\n12\n"],
  ['arr=(10 20); for i in 1 2; do out=$(( arr + i )); done; echo "out=$out"', "out=12\n"],
  ['a="x=42"; for i in 1 2; do echo "$(( a + 1 ))"; done; echo "x=$x"', "43\n43\nx=42\n"],
  ['for i in 1 2; do a="x=$i"; echo "$(( a + 1 ))"; done; echo "x=$x"', "2\n3\nx=2\n"],
  ['for i in 1 2; do if (( i == 1 )); then a="x=42"; fi; echo "$(( a + 1 ))"; done; echo "x=$x"', "43\n43\nx=42\n"],
  ['for i in 1 2; do case $i in 1) a="x=42";; esac; echo "$(( a + 1 ))"; done; echo "x=$x"', "43\n43\nx=42\n"],
  ['f() { a="x=42"; }; for i in 1 2; do f; echo "$(( a + 1 ))"; done; echo "x=$x"', "43\n43\nx=42\n"],
  ['for i in 1 2; do for j in 1; do a="x=42"; done; echo "$(( a + 1 ))"; done; echo "x=$x"', "43\n43\nx=42\n"],
  ['set -- -a -b; getopts "ab" o1; getopts "ab" o1b; for ((OPTIND=1; OPTIND<2; OPTIND++)); do x=$((x + 1)); done; getopts "ab" o2; echo "o1=$o1 o1b=$o1b o2=$o2 OPTIND=$OPTIND"', "o1=a o1b=b o2=b OPTIND=3\n"],
  ['for i in 1 "x=42"; do echo "$((i + 1))"; done; echo "x=$x"', "2\n43\nx=42\n"],
  ['for ((i=1;i<=2;i++)); do if ((i==1)); then a=1; else a="x=42"; fi; echo "$((a + 1))"; done; echo "x=$x"', "2\n43\nx=42\n"],
  ['f() { for ((i=1;i<=2;i++)); do echo "$((a + 1))"; done; }; a=1; f; a="x=42"; f; echo "x=$x"', "2\n2\n43\n43\nx=42\n"],
  ['f() { for i in {1..2}; do out=$((a + i)); done; }; a=1; f; a="x=42"; f; echo "out=$out x=$x"', "out=44 x=42\n"],
];

const cases = sources.flatMap(([source, stdout]): [string, string][] => source.includes("for i in 1 2")
  ? [
      [source, stdout],
      [source.replace("for i in 1 2", "for ((i=1;i<=2;i++))"), stdout],
      [source.replace("for i in 1 2", "i=0; while ((i++<2))"), stdout],
      [source.replace("for i in 1 2", "i=0; until ((i++>=2))"), stdout],
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
