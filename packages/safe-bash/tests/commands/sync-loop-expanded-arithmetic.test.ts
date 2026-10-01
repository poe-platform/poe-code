import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/types.js";

for (const loop of ["for i in {0..2}", "for ((i=0;i<3;i++))"]) {
  for (const [expression, expected] of [
    ["arr[i]", " 10 20 30\n"],
    ["arr[$i]", " 10 20 30\n"],
    ["i + $zero", " 0 1 2\n"],
    ["arr[$i] + 1", " 11 21 31\n"],
  ]) {
    test(`finite expansion limits read current loop operands: ${loop}: ${expression}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxExpansionBytes: 1024 * 1024 } });
      try {
        const result = await shell.exec(`arr=(10 20 30); i=2; zero=0; out=""; ${loop}; do val=$(( ${expression} )); out="$out $val"; done; echo "$out"`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, expected);
      } finally {
        await shell.dispose();
      }
    });
  }
}

test("finite expansion limits read the current array assignment operand", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), limits: { maxExpansionBytes: 1024 * 1024 } });
  try {
    const result = await shell.exec('arr=(10); i=2; out=""; for i in {0..2}; do (( arr[0] = i )); out="$out ${arr[0]}"; done; echo "$out"');
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, " 0 1 2\n");
  } finally {
    await shell.dispose();
  }
});

for (const command of ['echo $(( a + b ))', 'val=$(( a + b )); echo "$val"', '(( val = a + b )); echo "$val"']) {
  test(`indirect arithmetic mutation executes once through array fallback: ${command}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(`arr=(100 200); a="z += 1"; b="arr"; z=10; ${command}; echo "z=$z"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "111\nz=11\n");
    } finally {
      await shell.dispose();
    }
  });
}

for (const operator of ["#", "##", "%", "%%"]) {
  test(`pattern ${operator} admits the input before trimming`, async () => {
    const prefix = operator.startsWith("#");
    const pattern = "a".repeat(200);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()), env: { BIG: prefix ? `${pattern}ok` : `ok${pattern}` }, limits: { maxExpansionBytes: 100 } });
    try {
      await assert.rejects(shell.exec('echo "${BIG' + operator + pattern + '}"'), (error: unknown) => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    } finally {
      await shell.dispose();
    }
  });
}

const sources: [string, string][] = [
  ...["unset operand", 'operand=""', 'operand="-0"'].map((setup, index): [string, string] => [
    `${setup}; for ((i=1;i<=5;i++)); do result=$((i + operand)); done; echo "result=$result operand=[\${operand-UNSET}]"`,
    `result=5 operand=[${["UNSET", "", "-0"][index]}]\n`,
  ]),
  ...["for i in {1..5}", "for ((i=1;i<=5;i++))"].map((loop): [string, string] => [
    `unset K; E=""; Z="-0"; sum=0; ${loop}; do sum=$((sum + i + K + E + Z)); done; echo "sum=$sum K=\${K-UNSET} E=[$E] Z=[$Z]"`,
    "sum=15 K=UNSET E=[] Z=[-0]\n",
  ]),
  ...["for i in {1..5}", "for ((i=1;i<=5;i++))"].map((loop): [string, string] => [
    `f() { unset K; E=""; Z="-0"; sum=0; ${loop}; do sum=$((sum + i + K + E + Z)); done; echo "sum=$sum K=\${K-UNSET} E=[$E] Z=[$Z]"; }; f; f`,
    "sum=15 K=UNSET E=[] Z=[-0]\nsum=15 K=UNSET E=[] Z=[-0]\n",
  ]),
  ...["unset bodyVar", 'bodyVar=""', 'bodyVar="-0"'].map((setup, index): [string, string] => [
    `${setup}; for ((j=5;j<1;j++)); do bodyVar=$((bodyVar + 1)); done; echo "j=$j bodyVar=[\${bodyVar-UNSET}]"`,
    `j=5 bodyVar=[${["UNSET", "", "-0"][index]}]\n`,
  ]),
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
