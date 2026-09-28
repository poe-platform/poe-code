import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { textCommands } from "../../src/commands/text.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

for (const match of [
  '[[ $s == "$pfx"* ]]',
  '[[ $s == a\\** ]]',
  'case $s in "$pfx"*) true ;; *) false ;; esac',
]) {
  test(`escaped star followed by wildcard: ${match}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`pfx='a*'; s='a*hello'; if ${match}; then echo MATCH; else echo MISS; fi`);
      assert.equal(result.stdout, "MATCH\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

const bodies = [
  ['x="1+2"; (( x += 1 ))', 'x:4'],
  ['shift; (( x += $1 ))', 'x:6'],
  ['x=$(printf "hello world\\n" | wc -w)', 'x:2'],
  ['x=$(printf "hello\\n" | cut -c 1-3)', 'x:hel'],
  ['flag=-w; x=$(printf "hello world\\n" | wc "$flag")', 'x:2'],
  ['fmt=%b; x=$(printf "$fmt" hi)', 'x:hi'],
  ['x=$(echo hi)', 'x:hi'],
] as const;

test("pure substitution pipeline works without Node Buffer", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  for (const command of textCommands()) shell.commands.register(command, { replace: true });
  for (const command of streamCommands()) shell.commands.register(command, { replace: true });
  const previous = globalThis.Buffer;
  try {
    // Browser/worker hosts expose Uint8Array, TextEncoder and TextDecoder.
    Object.defineProperty(globalThis, "Buffer", { value: undefined, writable: true, configurable: true });
    const result = await shell.exec('x=$(printf "héllo\\n" | tr a-z A-Z); echo "$x"');
    assert.equal(result.stdout, "HéLLO\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const sorted = await shell.exec('x=$(printf "hi\\nhi\\n" | sort -u); echo "$x"');
    assert.equal(sorted.stdout, "hi\n");
    assert.equal(sorted.stderr, "");
    assert.equal(sorted.exitCode, 0);
  } finally {
    globalThis.Buffer = previous;
    await shell.dispose();
  }
});

test("pure substitution pipeline preserves a leading UTF-8 BOM", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of [...basicCommands(), ...streamCommands()]) shell.commands.register(command);
  try {
    const result = await shell.exec(`x=$(printf "\uFEFFhello\\n" | tr a-z A-Z); echo "$x"`);
    assert.equal(result.stdout, "\uFEFFHELLO\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("arithmetic expansion fault does not replay earlier effects", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec('c=0; x=0; { c=$((c+1)); echo "step:$c"; x="1/0"; y=$((x+1)); }; echo final:$c');
    assert.equal(result.stdout, "step:1\n");
    assert.match(result.stderr, /division by 0/);
    assert.equal(result.exitCode, 1);
  } finally { await shell.dispose(); }
});

test("named shell options remain outside extension option loops", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec('set -o pipefail; false | true; echo "$?"');
    assert.equal(result.stdout, "1\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test("arithmetic loop awaits asynchronous conditions", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec('for ((i=0; i<$(printf 2); i++)); do echo "$i"; done', { limits: { maxLoopIterations: 8 } });
    assert.equal(result.stdout, "0\n1\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
for (const [body, expected] of bodies) {
  for (const wrap of [
    (s: string) => `{ ${s}; }`,
    (s: string) => `if true; then ${s}; fi`,
    (s: string) => `case yes in yes) ${s} ;; esac`,
    (s: string) => `f() { ${s}; }; f 10 '1+2+3'`,
  ]) {
    for (const counter of ['c=$((c+1))', 'c="${c}1"']) {
      const command = `set -- 10 '1+2+3'; c=0; x=0; ${wrap(`${counter}; echo "step:$c"; ${body}`)}; echo "x:$x final:$c"`;
      const count = counter.includes('$((') ? '1' : '01';
      test(`compound executes once: ${command}`, async () => {
        const shell = new Shell({ fs: createMemoryFileSystem() });
        for (const command of basicCommands()) shell.commands.register(command);
        for (const command of textCommands()) shell.commands.register(command, { replace: true });
        for (const command of streamCommands()) shell.commands.register(command, { replace: true });
        try {
          const result = await shell.exec(command);
          assert.equal(result.stdout, `step:${count}\n${expected} final:${count}\n`);
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, 0);
        } finally { await shell.dispose(); }
      });
    }
  }
}

for (const [expansion, expected] of [
  ['"${arr[@]}"', "3\n<one>\n<two>\n<three>\n"],
  ['"${arr[@]:1:2}"', "2\n<two>\n<three>\n"],
  ['"${arr[@]#t}"', "3\n<one>\n<wo>\n<hree>\n"],
  ['"${empty[@]}"', "0\n<>\n"],
  ['pre"${arr[@]}"post', "3\n<preone>\n<two>\n<threepost>\n"],
] as const) {
  for (const setup of ["", "set -f;"]) {
    test(`compound array preserves fields: ${setup} ${expansion}`, async context => {
      const shell = new Shell({ fs: createMemoryFileSystem() });
      for (const command of basicCommands()) shell.commands.register(command);
      context.after(() => shell.dispose());
      const script = `${setup} arr=(one two three); empty=(); b=(${expansion}); echo "\${#b[@]}"; printf '<%s>\\n' "\${b[@]}"`;
      const bash = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8" });
      assert.equal(bash.status, 0);
      const result = await shell.exec(script);
      assert.equal(bash.stdout, expected);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

for (const expression of ['"a += 1" "b = 1 / z"', '"a += 1" "b = (a += 1, 1 / z)"', '"a += 1" "z = 0" "b = 1 / z"']) {
  test(`let fault preserves mutations exactly once: ${expression}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(`z=0; a=0; let ${expression} || true; echo "a=$a"`);
    assert.equal(result.stdout, expression.includes("b = (a") ? "a=2\n" : "a=1\n");
    assert.match(result.stderr, /let:.*division by 0/);
    assert.equal(result.exitCode, 0);
  });
}

for (const builtin of ['let "x = i + 1"', 'unset u1 u2', 'let "x = i + 1"; unset u1 u2']) {
  test(`function loop does not replay ${builtin}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(`f() { local u1=one u2=two; for i in 1 2; do echo "iter:$i"; ${builtin}; echo "after:$i"; done; }; f`);
    assert.equal(result.stdout, "iter:1\nafter:1\niter:2\nafter:2\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const script of [
  'arr=(one two three); x="${arr[@]}"; echo "<$x>"',
  'arr=(one two three); case "${arr[@]}" in "one two three") echo match;; esac',
  'arr=(one two three); [[ "${arr[@]}" == "one two three" ]]; echo "$?"',
  'arr=(one two three); read -r x <<< "${arr[@]}"; echo "<$x>"',
  'a=0; let "a += 1" "b = a + 2"; echo "$? $a $b"; let "a = 0"; echo "$? $a"',
]) {
  test(`scalar expansion and successful let match Bash: ${script}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.commands.register(command);
    context.after(() => shell.dispose());
    const bash = spawnSync("/bin/bash", ["-c", script], { encoding: "utf8" });
    const result = await shell.exec(script);
    assert.equal(result.stdout, bash.stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, bash.status);
  });
}

test("compound array fallback does not replay a loop", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  context.after(() => shell.dispose());
  const script = 'arr=(one two three); for i in 1 2; do echo "iter:$i"; b=("${arr[@]}"); echo "${#b[@]}"; done';
  const result = await shell.exec(script);
  assert.equal(result.stdout, "iter:1\n3\niter:2\n3\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
