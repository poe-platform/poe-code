import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ["output redirect precedes input", 'printf "alpha\\nbeta\\n" > /same; while read -r line; do echo "got:$line"; done > /same < /same; echo "$(</same)"', "\n"],
  ["input redirect precedes output", 'printf "alpha\\nbeta\\n" > /same; while read -r line; do echo "got:$line"; done < /same > /same; echo "$(</same)"', "\n"],
  ["body appends to input", 'echo first > /in; while read -r line; do echo "read:$line"; [[ $line == first ]] && echo second >> /in; done < /in; echo "status:$?"', "read:first\nread:second\nstatus:1\n"],
  ["dynamic IFS", `sep=":"; while IFS="$sep" read -r a b; do printf "[%s][%s]\\n" "$a" "$b"; sep=","; done <<< $'x:y\\nu,v'`, "[x][y]\n[u][v]\n"],
] as const;
for (const [name, source, expected] of cases) test(name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const body of ['for ((j=0;j<0;j++)); do x=1; done', 'for ((j=0;j<2;j++)); do ((sum+=j)); done', 'for ((j=0;j<2;j++)); do [[ 1 == 2 ]]; done']) {
  test(`nested last argument: ${body}`, async () => {
    await compare(`echo seed >/dev/null; sum=0; for ((i=1;i<=2;i++)); do echo "keep_$i" >/dev/null; ${body}; done; printf '[%s]:%d\\n' "$_" "$sum"`);
  });
}
for (const ending of ["((0))", "[[ 1 == 2 ]]"]) {
  for (const nested of ["for j in {1..2}", "while ((j<2))", "until ((j>=2))"]) {
    test(`nested ${nested} ending ${ending}`, async () => {
      await compare(`for ((i=0;i<1;i++)); do j=0; ${nested}; do ((j++)); ${ending}; done; done; printf '%d\\n' "$?"`);
    });
  }
  for (const header of ["while ((k<2))", "until ((k>=2))", "for ((i=0;i<1;i++))", "for i in {1..2}"]) {
    test(`${header} status ending ${ending}`, async () => {
      await compare(`k=0; ${header}; do ((k++)); ${ending}; done; s1=$?; for ((i=0;i<1;i++)); do for ((j=0;j<1;j++)); do ${ending}; done; done; s2=$?; printf '%d:%d\\n' "$s1" "$s2"`);
    });
  }
}
test("empty arithmetic loop status", async () => {
  await compare('false; for ((i=0;i<0;i++)); do for ((j=0;j<1;j++)); do ((0)); done; done; printf "%d\\n" "$?"');
});
async function compare(source: string): Promise<void> {
  const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(oracle.status, 0, oracle.stderr);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.stdout, oracle.stdout);
    assert.equal(result.exitCode, oracle.status);
  } finally { await shell.dispose(); }
}
