import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ["command substitution keeps outer stdout", 'for k in 1 2; do echo "OUTER:$k"; y=$(for j in a b; do echo "$j"; done); echo "GOT:$y"; done'],
  ["command substitution keeps same-name induction variable", 'for i in 1 2; do y=$(for i in a b; do echo "$i"; done); echo "outer_i=$i y=$y"; done'],
  ["getopts re-expands mutated optstring", 'opts=":ab"; set -- -a -b; while getopts "$opts" opt; do echo "opt=$opt:$OPTARG"; opts=":a"; done'],
  ["getopts re-expands optstring through a branch", 'opts=":ab"; set -- -a -b; while getopts "$opts" opt; do echo "opt=$opt:$OPTARG"; if [[ $opt == a ]]; then opts=":a"; fi; done'],
  ["literal getopts remains compatible", 'set -- -a -b value; while getopts ":ab:" opt; do echo "opt=$opt:$OPTARG"; done'],
] as const;
for (const body of ['arr=(a b)', 'mapfile -t arr <<< "hi"', 'readarray -t arr <<< "hi"', 'read -ra arr <<< "a b"']) {
  for (const header of ['for ((i=0;i<0;i++))', 'while false']) {
    for (const suffix of ["", "; echo fallback | cat"]) {
      const source = `${header}; do ${body}${suffix}; done; declare -p arr 2>/dev/null || echo unset`;
      test(source, () => compare(source));
    }
  }
  test(`executed array statement: ${body}`, async () => {
    const source = `for i in 1 2; do ${body}; done; printf '<%s>\\n' "${'${arr[@]}'}"`;
    const expected = body.includes('file') || body.includes('array -t') ? '<hi>\n' : '<a>\n<b>\n';
    const shell = new Shell({ fs: new MemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
for (const [name, source] of cases) test(name, () => compare(source));
async function compare(source: string): Promise<void> {
  const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(oracle.error, undefined);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, oracle.stdout);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.exitCode, oracle.status);
  } finally { await shell.dispose(); }
}
