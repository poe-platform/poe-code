import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const substitutions = [
  'for ((k=16;k>1;k/=2)); do printf "%d," "$k"; done',
  'for ((k=0;k<arr[0];k++)); do printf "%d," "$k"; done',
  'while ((j<arr[0])); do printf "%d," "$j"; ((j++)); done',
  'while ((j<(k=3))); do printf "%d," "$j"; ((j++)); done',
  'for x in $(echo a b); do printf "%s," "$x"; done',
];
for (const inner of substitutions) {
  test(`nested substitution preserves output: ${inner}`, async () => {
    await compare(`arr=(3); j=0; for ((i=1;i<=2;i++)); do x=$(${inner}); echo "i=$i x=[$x]"; done`);
  });
}
for (const inner of [
  'while ((j<2)); do printf "%d," "$j"; ((j++)); done',
  'for ((j=0;j<2;j++)); do printf "%d," "$j"; done',
  'for j in a b; do printf "%s," "$j"; done',
]) {
  test(`substitution preserves export attributes: ${inner}`, async () => {
    await compare(`j=0; set -a; for ((i=1;i<=2;i++)); do x=$(${inner}); done; declare -p j`);
  });
}
for (const mutation of ['pat+="|^b$"', 'declare pat="a.b"', 'export pat="a.b"', 'chg', 'echo "$((pat=1))" >/dev/null']) {
  test(`regex observes mutation: ${mutation}`, async () => {
    const subject = mutation.startsWith('pat+=') ? 'b' : mutation.startsWith('echo') ? '1' : 'axb';
    await compare(`pat="^a$"; chg() { pat="a.b"; }; for ((i=1;i<=3;i++)); do if [[ "${subject}" =~ $pat ]]; then echo "match:$i:\${BASH_REMATCH[0]}"; else echo "no:$i"; fi; ${mutation}; done`);
  });
}
for (const pattern of ['a.b', '[', '[[:digit:]]+', '^a\\.b$']) {
  test(`nested regex observes outer assignment: ${pattern}`, async () => {
    const subject = pattern === '[[:digit:]]+' ? '123' : 'a.b';
    await compare(`pat="^a$"; for ((i=1;i<=2;i++)); do case "$i" in (*) if ((1)); then [[ "${subject}" =~ $pat ]]; echo "st:$i:$?:\${BASH_REMATCH[0]}"; fi ;; esac; pat='${pattern}'; done`, pattern === '[');
  });
}
for (const source of [
  'pat="^a$"; for ((i=1;i<=3;i++)); do if [[ "b" =~ $pat ]]; then echo "match:$i:${BASH_REMATCH[0]}"; else echo "no:$i"; fi; pat+="|^b$"; done',
  'pat="^a$"; chg() { pat="^a\\.b$"; }; for ((i=1;i<=3;i++)); do if [[ "a.b" =~ $pat ]]; then echo "match:$i:${BASH_REMATCH[0]}"; else echo "no:$i"; fi; chg; done',
  'f() { local pat="^a$"; for ((i=1;i<=3;i++)); do [[ "axb" =~ $pat ]]; echo "$i:$?"; local pat="a.b"; done; }; f',
  'pat="^a$"; for ((i=1;i<=3;i++)); do j=0; while ((j<1)); do if [[ "axb" =~ $pat ]]; then echo "match:$i"; else echo "no:$i"; fi; ((j++)); done; pat="a.b"; done',
]) {
  test(`regex mutation matches Bash: ${source}`, async () => { await compare(source); });
}
async function compare(source: string, invalidPattern = false): Promise<void> {
  const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const actual = await shell.exec(source);
    assert.equal(actual.stdout, expected.stdout);
    if (invalidPattern) {
      // Safe Bash reports syntax diagnostics; Bash only publishes status 2.
      assert.equal(actual.stderr.startsWith("shell: line 1: [[ invalid ERE"), true);
    } else {
      assert.equal(actual.stderr, expected.stderr);
    }
    assert.equal(actual.exitCode, expected.status);
  } finally { await shell.dispose(); }
}
