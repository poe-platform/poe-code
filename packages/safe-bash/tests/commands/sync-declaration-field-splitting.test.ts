import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases: [string, string, (string | undefined)?][] = [];
for (const header of ['for i in 1 2', 'for ((i=0;i<2;i++))']) {
  for (const builtin of ['local', 'declare', 'typeset']) {
    cases.push([`${header}: ${builtin} self reference`, `x=outer; f() { ${header}; do ${builtin} x="$x"; done; echo "in:$x"; }; f; echo "out:$x"`]);
    cases.push([`${header}: ${builtin} argument expansion order`, `a=outer; f() { ${header}; do ${builtin} a=1 b="$a"; done; echo "a:$a b:$b"; }; f`]);
  }
  for (const builtin of ['declare', 'typeset', 'export']) {
    cases.push([`${header}: ${builtin} global expansion order`, `a=outer; ${header}; do ${builtin} a=1 b="$a"; done; echo "a:$a b:$b"`]);
    for (const operator of ['=', '+=']) cases.push([`${header}: ${builtin} ${operator} last argument`, `${header}; do x=foo; ${builtin} x${operator}bar; done; printf '[%s][%s]\\n' "$x" "$_"`, builtin === 'export' ? `[${operator === '=' ? 'bar' : 'foobar'}][x${operator}bar]\n` : undefined]);
  }
  // Expansion of the exported name is observable without external env/grep.
  cases.push([`${header}: unset export attribute`, `${header}; do unset x; export x; done; x=99; export -p | while read -r line; do case "$line" in *'x="99"') echo found ;; esac; done`]);
  cases.push([`${header}: local export attribute`, `f() { ${header}; do local x; export x; done; x=99; export -p | while read -r line; do case "$line" in *'x="99"') echo found ;; esac; done; }; f`]);
  for (const whitespace of ['\\r', '\\v', '\\f', ' ']) {
    cases.push([`${header}: nested for preserves ${whitespace}`, `v=$'a${whitespace} b${whitespace}'; ${header}; do for y in $v; do printf '[%s]\\n' "$y"; done; done`]);
    cases.push([`${header}: set preserves ${whitespace}`, `v=$'a${whitespace} b${whitespace}'; ${header}; do set -- $v; printf '[%s][%s]\\n' "$1" "$2"; done`]);
    cases.push([`${header}: substitution preserves ${whitespace}`, `v=$'a${whitespace} b${whitespace}'; ${header}; do for y in $(printf '%s' "$v"); do printf '[%s]\\n' "$y"; done; set -- $(printf '%s' "$v"); printf '[%s][%s]\\n' "$1" "$2"; done`]);
  }
  for (const ifs of [':', '', ' ']) cases.push([`${header}: dynamic IFS ${JSON.stringify(ifs)}`, `v='a:b c'; ${header}; do IFS='${ifs}'; for y in $v; do printf '[%s]' "$y"; done; done; echo`]);
}
for (const [name, source, expected] of cases) test(name, async () => {
  const oracle = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? '/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'en_US.UTF-8' } });
  assert.equal(oracle.error, undefined);
  assert.equal(oracle.status, 0);
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    // Bash 3.2 strips export assignment values from $_; target Bash 5.2
    // retains the expanded argument. Keep this assertion portable on macOS.
    if (expected !== undefined && process.env.SAFE_BASH_TEST_BASH) assert.equal(oracle.stdout, expected);
    assert.equal(result.stdout, expected ?? oracle.stdout);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.exitCode, oracle.status);
  } finally { await shell.dispose(); }
});
