import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { setup } from "./helpers.js";
import { nativeOptions, runNative } from "./extensions/trap/oracle.js";

const compounds = [
  'if true; then return 5; fi',
  'while true; do return 5; done',
  'until false; do return 5; done',
  '{ return 5; }',
  'for ((i=0; i<3; i++)); do return 5; done',
];
const cases: Array<[string, string, boolean?]> = [];
for (const body of compounds) {
  for (const call of ['f 1', 'f > /result', 'res=$(f); saved=$?; echo "res=$res status=$saved"', 'say async; f', `f() { say async; ${body}; echo UNREACHABLE; }; f`]) {
    cases.push([`return from ${body} via ${call}`, `f() { ${body}; echo UNREACHABLE; }; ${call}; echo status=$?; g() { echo clean; }; g; echo done`]);
  }
}
cases.push(
  ['bare return in sync function', 'f() { if true; then false; return; fi; echo UNREACHABLE; }; f 1; echo status=$?'],
  ['nested return stays in inner function', 'inner() { if true; then return 7; fi; echo UNREACHABLE; }; outer() { inner 1; echo inner=$?; return 3; }; outer 1; echo outer=$?'],
  ['bare arithmetic return executes once', 'cnt=0; f() { for ((i=0;i<3;i++)); do cnt=$((cnt+1)); echo step; return; done; }; f; echo cnt=$cnt'],
  ['zero argument helper after mutation', 'cnt=0; calls=0; helper() { calls=$((calls+1)); }; while [ $cnt -lt 1 ]; do cnt=$((cnt+1)); echo before; helper; done; echo "$cnt $calls"'],
  ['zero argument builtin shadow', 'cnt=0; calls=0; true() { calls=$((calls+1)); }; while [ $cnt -lt 1 ]; do cnt=$((cnt+1)); true; done; echo calls=$calls'],
  ['nested zero argument helper', 'cnt=0; helper() { echo helper; }; inner() { echo before; helper; }; outer() { inner 1; }; while [ $cnt -lt 1 ]; do outer 1; cnt=$((cnt+1)); done'],
);
for (const local of ['local a=1', 'local a=1 b=2', 'local -a arr', 'local arr=(1 2)', 'local a+=1', 'local a=$(echo value)', 'local a b=$(echo value)', 'local a=$value', 'local a=1 b=$value']) {
  cases.push([`local eligibility ${local}`, `value='two words'; cnt=0; f() { echo before; ${local}; echo after; }; while [ $cnt -lt 1 ]; do f 1; cnt=$((cnt+1)); done; echo cnt=$cnt`]);
}
for (const ifs of [':', '', ' ']) {
  cases.push([`array assignment joining IFS=${ifs}`, `arr=(a b c); IFS='${ifs}'; x=\${!arr[@]}; y="\${!arr[@]}"; z=\${arr[@]}; q="\${arr[@]}"; star="\${arr[*]}"; echo "<$x><$y><$z><$q><$star>"`, true]);
}
for (const maxExpansionBytes of [65536, undefined]) {
  for (const [name, source, modernBash = false] of cases) {
    test(`${name} (expansion budget ${maxExpansionBytes})`, modernBash ? nativeOptions() : {}, async () => {
      // Host Bash is an oracle only; all product execution uses the memory VFS.
      // Array-key scalar joining differs between macOS Bash 3.2 and pinned GNU Bash 5.2.
      const oracleSource = `say() { echo "$@"; }; ${source.replace('> /result', '> /dev/null')}`;
      const oracle = modernBash ? runNative(oracleSource) : spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', oracleSource], { encoding: 'utf8' });
      assert.equal(oracle.error, undefined);
      const { shell, commands } = setup({ limits: { maxCommands: 1000, ...(maxExpansionBytes === undefined ? {} : { maxExpansionBytes }) } });
      for (const command of [...basicCommands(), ...predicateCommands()]) commands.register(command);
      try {
        const result = await shell.exec(source);
        assert.equal(result.stdout, oracle.stdout.toString());
        assert.equal(result.stderr, oracle.stderr.toString());
        assert.equal(result.exitCode, oracle.status);
      } finally { await shell.dispose(); }
    });
  }
}

test("readonly local declarations preserve diagnostics without replaying the body", async () => {
  const source = 'readonly a=7; cnt=0; f() { echo before; local a=1; echo "local=$? a=$a"; }; while [ $cnt -lt 1 ]; do f 1; cnt=$((cnt+1)); done';
  const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8' });
  const { shell, commands } = setup();
  for (const command of [...basicCommands(), ...predicateCommands()]) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, oracle.stdout);
    assert.equal(result.exitCode, oracle.status);
    assert.ok(result.stderr.includes('a: readonly variable'));
  } finally { await shell.dispose(); }
});
