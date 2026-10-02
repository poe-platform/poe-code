import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const bodies = [
  'tmp="keep_$i"; unset tmp',
  'echo "keep_$i" >/dev/null; (( x = i + 1 ))',
  'echo "keep_$i"; (( x = i + 1 ))',
  'echo "keep_$i" >/dev/null; if [[ $i == 2 ]]; then case $i in 99) : ;; esac; fi',
  'echo "keep_$i" >/dev/null; case $i in 2) if [[ $i == 99 ]]; then true; fi ;; esac',
  'echo "keep_$i" >/dev/null; [[ $i == 2 ]]',
  'echo "keep_$i" >/dev/null; [ "$i" = 2 ]',
  'echo "keep_$i" >/dev/null; case $i in 99) echo never ;; esac',
  'echo "keep_$i" >/dev/null; if [[ $i == 99 ]]; then echo never; fi',
  'echo "keep_$i" >/dev/null; if (( 0 )); then echo never; fi',
  'echo "keep_$i" >/dev/null; if [ "$i" = 99 ]; then echo never; fi',
  'if [[ $i == 2 ]]; then echo hello >/dev/null; :; fi',
  'if [[ $i == 2 ]]; then echo hello >/dev/null; true; fi',
  'case $i in 2) echo hello >/dev/null; : ;; esac',
  '(( x = i + 1 ))',
  '(( x = i + 1 )); (( y = x + 1 ))',
  'x=$((i + 1)); (( y = x + 1 ))',
  '(( x = i + 1 )); y=$((x + 1))',
  '[[ $i == 2 ]]',
  'case $i in 99) : ;; esac',
  'if (( 0 )); then true; fi',
  'case $i in 2) echo hello >/dev/null; true ;; esac',
  'echo "keep_$i" >/dev/null; if [[ $i == 2 ]]; then (( 1 )); fi',
  'echo "keep_$i" >/dev/null; case $i in 2) [[ $i == 2 ]] ;; esac',
  'echo "keep_$i" >/dev/null; if [ "$i" = 2 ]; then (( 1 )); fi',
  'echo "keep_$i" >/dev/null; if [[ $i == 99 ]]; then :; elif [ "$i" = 99 ]; then true; fi',
];
for (const header of ['for i in 1 2', 'for ((i=1;i<=2;i++))']) {
  for (const body of bodies) test(`${header}: ${body}`, async () => {
    const source = `echo seed >/dev/null; ${header}; do ${body}; done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8' });
    assert.equal(oracle.status, 0);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}

const issue3957Bodies = [
  '((i == 0)) && echo "redir_$i" >/f',
  '((i == 0)) && { echo "redir_$i" >/f; }',
  'echo "$v" >/f; ((v++))',
  'echo first >/f; echo "$v" >/f; ((v++))',
  'echo "before_$i" >/f; for y in "${empty[@]}"; do echo never; done',
  'echo "before_$i" >/f; for ((j=0;j<0;j++)); do echo never; done',
  'echo "before_$i" >/f; while [[ $i -lt 0 ]]; do echo never; done',
  'echo "before_$i" >/f; until (( 1 )); do echo never; done',
  'echo "before_$i" >/f; while [ "$i" -lt 0 ]; do echo never; done',
  'echo "before_$i" >/f; until [ "$i" -ge 0 ]; do echo never; done',
  'j=0; while [ "$j" -lt 2 ]; do echo "body_$j" >/f; ((j++)); done',
  'j=0; until [ "$j" -ge 2 ]; do echo "body_$j" >/f; ((j++)); done',
  'j="run"; while [ "$j" != "done" ]; do echo "body_$j" >/f; j="done"; done',
  'j="run"; until [ "$j" = "done" ]; do echo "body_$j" >/f; j="done"; done',
  'echo "before_$i" >/f; while [ "$i" = "never" ]; do echo never; done',
  'echo "before_$i" >/f; until [ "$i" != "never" ]; do echo never; done',
];
for (const header of ['for i in 0 1', 'for ((i=0;i<2;i++))']) {
  for (const body of issue3957Bodies) test(`3957 ${header}: ${body}`, async () => {
    const source = `v=0; empty=(); echo seed >/f; ${header}; do ${body}; done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
    assert.equal(oracle.status, 0);
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}
for (const header of ['while [ "$j" -lt 2 ]', 'until [ "$j" -ge 2 ]', 'while [ "$j" -lt 0 ]', 'until [ "$j" -ge 0 ]']) {
  test(`3957 outer ${header}`, async () => {
    const source = `j=0; echo seed >/f; ${header}; do echo "body_$j" >/f; ((j++)); done; printf '[%s]\\n' "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}

test('3957 outer string bracket condition', async () => {
  const source = 'j="run"; while [ "$j" != "done" ]; do echo "body_$j" >/f; j="done"; done; printf "[%s]\\n" "$_"';
  const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source.replaceAll('>/f', '>/dev/null')], { encoding: 'utf8' });
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.exitCode, oracle.status);
    assert.equal(result.stdout, oracle.stdout);
  } finally { await shell.dispose(); }
});

const issue4078Scripts = [
  ...['declare', 'typeset', 'export'].flatMap(kind => [
    `x=outer; for i in 1 2; do ${kind} x="in_$i" y="$x"; echo "y:$y"; done`,
    ...(kind === "export" ? [] : [`x=foo; for i in 1 2; do ${kind} x+=bar; done; echo "x:$x last:$_"`]),
  ]),
  'x=outer; fn() { for i in 1 2; do local x="in_$i" y="$x"; echo "y:$y"; done; }; fn; echo "after:$x"',
  'fn() { local x=foo; for i in 1 2; do local x+=bar; done; echo "x:$x last:$_"; }; fn',
  'x=outer; fn() { for i in 1 2; do local x y="${x:-UNSET}"; echo "y:$y"; x=outer; done; }; fn',
  ...['fn arg1 arg2', 'fn', 'X=1 fn arg1 arg2', 'X=1 fn', 'fn arg1 arg2 >/dev/null', 'for i in 1 2; do fn arg1 arg2; done'].map(call =>
    `fn() { echo "in1:$_"; echo "in2:$_"; }; echo before >/dev/null; ${call}; echo "after:$_"`),
  ...["eval 'echo in_eval:$_'", "X=1 eval 'echo in_eval:$_'", "eval 'echo in_eval:$_; read -r v <<< value; echo read:$v'", "eval ''", 'eval', "eval 'echo in_eval:$_' >/dev/null"].map(call =>
    `echo before_eval >/dev/null; ${call}; echo "after:$_"`),
];
for (const middleware of [false, true]) for (const source of issue4078Scripts) test(`issue 4078 (${middleware ? "middleware" : "fast"}): ${source}`, async () => {
  const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8' });
  assert.equal(oracle.status, 0);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  if (middleware) shell.use(async (_context, next) => next());
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, oracle.stderr);
    assert.equal(result.exitCode, oracle.status);
    assert.equal(result.stdout, oracle.stdout);
  } finally { await shell.dispose(); }
});

const issue4080Calls = [
  ...["eval", "command eval", "builtin eval", "command -- eval", "command builtin eval"].map(name => `${name} 'echo "inside:$_"; : inner'`),
  ...[".", "source", "command .", "builtin .", "command source", "builtin source"].flatMap(name => [
    `${name} /dev/stdin arg1 arg2 <<< 'echo "inside:$_"; : inner'`,
    `${name} /dev/stdin <<< 'echo "inside:$_"; : inner'`,
    `${name} /dev/stdin arg1 arg2 <<< 'echo "inside:$_"; return 7'`,
  ]),
];
for (const middleware of [false, true]) for (const call of new Set([...issue4080Calls, ...issue4080Calls.filter(call => call.includes("<<<")).map(call => call.split(" <<<")[0]!)])) for (const setup of ["", "X=1 ", "loop"]) {
  test(`issue 4080 (${middleware ? "middleware" : "fast"}): ${setup}${call}`, async () => {
    const source = setup === "loop"
      ? `for i in ${call.includes("/dev/stdin") && !call.includes("<<<") ? "1" : "1 2"}; do : before; ${call}; echo "after:$_"; done`
      : `: before; ${setup}${call}; echo "after:$_"`;
    // Prepare stdin in Bash before sourcing it; an externally supplied pipe can
    // be observed empty while spawnSync is still delivering its input.
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `exec <<< 'echo "inside:$_"; : inner'; ${source}`], { encoding: "utf8" });
    assert.equal(oracle.status, 0);
    const fs = new MemoryFileSystem();
    const body = call.includes("return 7") ? 'echo "inside:$_"; return 7' : 'echo "inside:$_"; : inner';
    await fs.writeFile("/script.sh", new TextEncoder().encode(body));
    const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
    if (middleware) shell.use(async (_context, next) => next());
    try {
      const result = await shell.exec(source.replaceAll("/dev/stdin", "/script.sh"));
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout.replaceAll("/dev/stdin", "/script.sh"));
    } finally { await shell.dispose(); }
  });
}

const issue3978Loops = [
  'i=0; while [[ -n "$i" ]]; do echo "iter=$i status=$?"; [[ "$i" == 0 ]] && i=1 || i=""; [[ "$i" == 999 ]]; done',
  'i=0; until [[ -z "$i" ]]; do echo "iter=$i status=$?"; i=""; done',
  'i=0; while ((i < 2)); do echo "iter=$i status=$?"; ((i++)); false; done',
  'i=0; until ((i >= 2)); do echo "iter=$i status=$?"; ((i++)); done',
  's=hello; while test -n "$s"; do s=""; done',
  's=hello; until test -z "$s"; do s=""; done',
  's=hello; while test "$s" = hello; do s=done; done',
  's=hello; while test -z "$s"; do echo never; done',
  's=hello; while [ -n "$s" ]; do s=""; done',
  'for j in 1 2; do test "$j" = 9; done',
  'for j in 1 2; do test -n "$?"; done',
  'for j in 1 2; do echo x >/dev/null; test "$j" = 9; done',
  'for j in 1 2; do if test "$j" = 2; then s=yes; fi; done',
];
for (const loop of issue3978Loops) {
  for (const header of ['', 'for outer in 1', 'for ((outer=0;outer<1;outer++))']) test(`3978 ${header || 'outer'}: ${loop}`, async () => {
    const source = `${header ? `${header}; do ${loop}; done` : loop}; printf 'status=%s lastarg=[%s]\\n' "$?" "$_"`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], { encoding: 'utf8' });
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, oracle.stderr);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stdout, oracle.stdout);
    } finally { await shell.dispose(); }
  });
}
