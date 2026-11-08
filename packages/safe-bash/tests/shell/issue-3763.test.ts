import { parseShellUnit } from "../../src/shell/parser.js";
import { shellValueBytes } from "../../src/contracts/value.js";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";

const scripts = [
  'f() { echo "step 1: $1"; echo "step 2: $@"; }; f a b',
  '{ echo "block 1"; echo "block 2: $(echo sub)"; }',
  'if true; then echo "if 1"; [ -f /nonexistent ]; fi',
  'case x in x) echo first; [ -d /nonexistent ]; esac',
  'f() { echo starting; local out="$@"; echo "out=$out"; }; f a b',
  'arr=(1 2); y=3; a=0; { (( a += 1 )); (( x = $y << 1 )); }; echo "a=$a x=$x"',
  'a=0; (( a++, b = 1 / 0 )); echo "a=$a"',
  'a=0; b="foo bar"; (( a++, x = b )); echo "a=$a"',
  'a=0; b="c[2]=4"; ((a++,x=b)); echo "$a:${c[2]}"',
  'a=0; b="c[2]++"; ((a++,x=b)); echo "$a:${c[2]}"',
  'a=0; b="a++"; ((a++,x=b)); echo "$a:$x"',
  'a=0; b="a++"; echo "$((a++,x=b)):$a"',
  'a=0; b=94906266; ((a++,x=b)); echo "$a:$x"',
  'a=0; b=0; c="a++"; ((a++,b++,x=c)); echo "$a:$b:$x"',
  'a=0; b="b"; ((a++,x=b)); echo "$a"',
  'a=0; b="c"; c="b"; ((a++,x=b)); echo "$a"',
  'for n in 1 2; do a=0; b="c[2]=4"; ((a++,x=b)); echo "$a:${c[2]}"; done',
  'a=0; b="c[2]=4"; echo "$((a++,x=b)):$a:${c[2]}"',
  'a=0; ((x=$((a++)) << 1)); echo "$a:$x"',
  'set -a; one=42; (( anum = $one )); declare -p anum',
  '{ echo first; printf "%q\\n" "a b"; }',
  '{ echo first; export out="$(echo value)"; echo "$out"; }',
  'f() { echo first; local out=$(true); echo "out=$out"; }; f',
  '{ a=0; (( a++, b=1/0 )); echo "$a"; }; echo done',
  'a=0; ! (( a++, b=1/0 )); echo "$a:$?"',
  '[ ! != x -a y = y ]',
  '[ ! = ! -a x = x ]',
  '[ 1 -eq 1 -a 2 -eq 99999999999999999999999 ]',
  '[ 1 -eq 1 -a 2 -eq -9223372036854775809 ]',
];
for (const script of scripts) test(`issue 3763 Bash parity: ${script}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
  const expected = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  assert.ifError(expected.error);
  const actual = await shell.exec(script);
  assert.equal(actual.stdout, expected.stdout);
  assert.equal(actual.exitCode, expected.status);
  assert.equal(Boolean(actual.stderr), Boolean(expected.stderr));
});

test('issue 3763 core shell operations work without global Buffer', async () => {
  const saved = globalThis.Buffer;
  try {
    // Node is the test host; product execution must use portable byte primitives.
    Reflect.deleteProperty(globalThis, 'Buffer');
    for (const [script, stdout] of [
      ['echo {1..3}', '1 2 3\n'],
      ['declare -a arr; arr[0]=1; echo "${arr[0]}"', '1\n'],
      ['declare -A arr; arr[é]=1; echo "${arr[é]}"', '1\n'],
      ['declare -A arr; key=abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz; arr[$key]=2; echo "${arr[$key]}"', '2\n'],
      ['[[ "é" < "f" ]]; echo $?', '1\n'],
      ['[ a \\< b ]; echo $?', '0\n'],
      ['x="é"; echo "${x^^}"', 'É\n'],
      ['mapfile -t arr <<< "hello"; echo "${arr[0]}"', 'hello\n'],
    ]) {
      const { shell } = setup();
      for (const command of [...basicCommands(), ...predicateCommands()]) shell.commands.register(command);
      const result = await shell.exec(script!);
      assert.equal(result.stdout, stdout, `${script}: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
    }
  } finally { globalThis.Buffer = saved; }
});

test('arithmetic errors still obey errexit', async () => {
  const { shell } = setup();
  const result = await shell.exec('set -e; a=0; (( a++, b=1/0 )); say unreachable');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /division by 0/);
});

test('byte-source scripts and directory stack restoration work without Buffer', async () => {
  const { shell } = setup();
  const saved = globalThis.Buffer;
  try {
    Reflect.deleteProperty(globalThis, 'Buffer');
    async function* source() { yield new TextEncoder().encode('say "é"\n'); }
    const result = await shell.exec('sh', { stdin: source() });
    assert.deepEqual([...result.stdoutBytes], [195, 169, 10]);
    const parsed = parseShellUnit('say "\xff"', 0, false, true).script;
    const command = parsed.lists[0]!.pipelines[0]!.commands[0]!;
    assert.equal(command.kind, "simple");
    if (command.kind !== "simple") throw new Error("Expected simple command");
    const part = command.words[1]!.parts.find(part => part.kind === "text" && part.byteValue)!;
    assert.equal(part.kind, "text");
    if (part.kind !== "text" || !part.byteValue) throw new Error("Expected byte value");
    assert.deepEqual([...shellValueBytes(part.byteValue)], [255]);
    assert.equal(result.exitCode, 0, result.stderr);
    let state: import('../../src/shell/index.js').ShellSessionState | undefined;
    await shell.exec(':', { onState(snapshot) { state = { ...snapshot, directoryStack: ['/é', '/'] }; } });
    assert.ok(state);
    const restored = await shell.exec(':', { state });
    assert.equal(restored.exitCode, 0, restored.stderr);
  } finally { globalThis.Buffer = saved; }
});
