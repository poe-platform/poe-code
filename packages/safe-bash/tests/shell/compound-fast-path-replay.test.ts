import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { textCommands } from "../../src/commands/text.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

const syncAssignmentCases = [
  ["dynamic function and directory arrays", 'f() { for i in 1 2; do local -a fn=("${FUNCNAME[@]}"); local -a ds=("${DIRSTACK[@]}"); echo "i=$i fn=${fn[*]} ds=${ds[*]}"; done; }; f', "i=1 fn=f ds=/tmp\ni=2 fn=f ds=/tmp\n"],
  ["dynamic array keys and slices", 'f() { for i in 1 2; do fn=("${FUNCNAME[@]}"); fk=("${!FUNCNAME[@]}"); fs=("${FUNCNAME[@]:0:1}"); ds=("${DIRSTACK[@]}"); dk=("${!DIRSTACK[@]}"); echo "$i:${fn[*]}:${fk[*]}:${fs[*]}:${ds[*]}:${dk[*]}"; done; }; f', "1:f:0:f:/tmp:0\n2:f:0:f:/tmp:0\n"],
  ["sparse array copy and keys", 'arr=([5000]=tail); for i in 1 2; do echo iter=$i; copy=("${arr[@]}"); keys=("${!arr[@]}"); echo "${copy[*]}:${keys[*]}"; done', "iter=1\ntail:5000\niter=2\ntail:5000\n"],
  ["array becomes sparse inside loop", 'arr=(head); for i in 1 2; do echo iter=$i; arr=([0]=head [4096]=tail); copy=("${arr[@]}"); echo "${copy[*]}"; done', "iter=1\nhead tail\niter=2\nhead tail\n"],
  ["sparse negative slice", 'arr=([0]=head [4096]=tail); for i in 1 2; do echo iter=$i; slice=("${arr[@]: -1:1}"); echo "${slice[*]}"; done', "iter=1\ntail\niter=2\ntail\n"],
  ["parenthesized slice offset and length", 'arr=(a b c); for i in 1 2; do echo iter=$i; slice=("${arr[@]:(i-1):(1+1)}"); echo "${slice[*]}"; done', "iter=1\na b\niter=2\nb c\n"],
  ["slice operand changes to arithmetic expression", 'arr=(a b c); n=0; for i in 1 2; do echo iter=$i; slice=("${arr[@]:n:1}"); echo "${slice[*]}"; n="1+1"; done', "iter=1\na\niter=2\nc\n"],
  ["nested nameref restoration with batched arithmetic", 'y=0; inner() { local -n ref=y; ref=99; }; outer() { local x=10; local -n ref=x; inner; ref=500; echo "i=$i x=$x y=$y ref=$ref"; }; for i in 1 2; do (( i += 0 )); outer; done', "i=1 x=500 y=99 ref=500\ni=2 x=500 y=99 ref=500\n"],
  ["nameref pure substitution", 'x=hello; f() { local -n ref=x; out=$(echo "$ref"); }; for i in 1 2; do echo iter=$i; f; echo "$out"; done', "iter=1\nhello\niter=2\nhello\n"],
  ["nameref printf assignment", 'x=hello; f() { local -n ref=x; printf -v out %s "$ref"; }; for i in 1 2; do echo iter=$i; f; echo "$out"; done', "iter=1\nhello\niter=2\nhello\n"],
  ["printf writes through scalar nameref", 'x=old; f() { local -n ref=x; printf -v ref %s new; echo "$x:$ref"; }; for i in 1 2; do echo iter=$i; f; done', "iter=1\nnew:new\niter=2\nnew:new\n"],
  ["printf writes through array nameref", 'x=(old tail); f() { local -n ref=x; printf -v ref[1] %s new; echo "${x[*]}:${ref[*]}"; }; for i in 1 2; do echo iter=$i; f; done', "iter=1\nold new:old new\niter=2\nold new:old new\n"],
  ["global declaration behind a local shadow", 'x=global1; f() { local x=local1; declare -g x=global2; echo "$x"; }; for i in 1 2; do echo iter=$i; f; echo "$x"; done', "iter=1\nlocal1\nglobal2\niter=2\nlocal1\nglobal2\n"],
  ["global declaration behind nested shadows", 'x=global; inner() { local x=inner; typeset -g x+=tail; echo "$x"; }; outer() { local x=outer; inner; echo "$x"; }; outer; echo "$x"', "inner\nouter\nglobaltail\n"],
  ["global indexed declaration behind array shadow", 'x=(global tail); f() { local -a x=(local); declare -ga x+=(added); echo "${x[*]}"; }; f; echo "${x[*]}"', "local\nglobal tail added\n"],
  ["global integer declaration retains global attributes", 'declare -i x=10; f() { local x=local; declare -g x+=2; echo "$x"; }; f; echo "$x"', "local\n12\n"],
  ["plain local shadows outer nameref", 'x=10; inner() { local ref=99; echo "$ref"; }; outer() { local -n ref=x; inner; ref=500; echo "$x:$ref"; }; for i in 1 2; do echo iter=$i; outer; done', "iter=1\n99\n500:500\niter=2\n99\n500:500\n"],
] as const;

for (const [name, source, expected] of syncAssignmentCases) {
  for (const limits of [{}, { maxExpansionBytes: 65536 }]) {
    test(`sync assignment preserves effects: ${name}, limits ${JSON.stringify(limits)}`, async context => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/tmp", { recursive: true });
      const shell = new Shell({ fs, cwd: "/tmp", limits });
      for (const command of basicCommands()) shell.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    });
  }
}

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

test("function-scoped local -a / local -A, outer array subscript mutation with local vars, and whole-array unset in loops", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  for (const command of textCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(
      [
        'arr="outer_val"',
        'fn_idx() { local -a arr=(x "$1" z); arr+=("w"); arr[1]="p_$1"; REPLY="${arr[1]}:${#arr[@]}:${arr[3]}"; }',
        'for ((i=0;i<60;i++)); do fn_idx "$i"; done',
        'echo "idx:$arr|$REPLY"',
        'fn_assoc() { local -A map=([a]="$1" [b]="two"); map[c]="three_$1"; REPLY="${map[a]}:${map[c]}:${#map[@]}"; }',
        'for ((i=0;i<60;i++)); do fn_assoc "$i"; done',
        'echo "assoc:${#map[@]}|$REPLY"',
        'g=(0 1 2 3)',
        'fn_mut() { local k=$(( $1 * 2 )); g[$1]="$k"; }',
        'for ((i=0;i<60;i++)); do fn_mut "$(( i % 4 ))"; done',
        'echo "mut:${g[*]}"',
        'for ((i=0;i<60;i++)); do tmp=(a b c d); unset "tmp[1]"; tmp+=("$i"); unset tmp; done',
        'echo "unset:${#tmp[@]}"'
      ].join("\n")
    );
    assert.equal(result.stdout, "idx:outer_val|p_59:4:w\nassoc:0|59:three_59:3\nmut:0 2 4 6\nunset:0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("comma arithmetic in while loops, associative key iteration arithmetic, modulo subscript mutation, and regex BASH_REMATCH in loops", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  for (const command of textCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(
      [
        'fn_while() { local n=5 sum=0; while (( n > 0 )); do (( sum += n, n-- )); done; REPLY="$sum"; }',
        'for ((i=0;i<60;i++)); do fn_while; done',
        'echo "while:$REPLY"',
        'declare -A map=([x]=10 [y]=20 [z]=30); sum=0',
        'for ((i=0;i<60;i++)); do for k in "${!map[@]}"; do (( sum += map[$k] )); done; done',
        'echo "map:$sum"',
        'arr=(0 0 0 0)',
        'for ((i=0;i<60;i++)); do (( arr[i % 4] += i )); done',
        'echo "arr:${arr[*]}"',
        'c=0',
        'for ((i=0;i<60;i++)); do s="item_${i}_ok"; if [[ "$s" =~ ^item_([0-9]+)_ok$ ]]; then (( c += BASH_REMATCH[1] )); fi; done',
        'echo "re:$c"'
      ].join("\n")
    );
    assert.equal(result.stdout, "while:15\nmap:3600\narr:420 435 450 465\nre:1770\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }

});

test("assign-default parameter expansions (: \"${x:=default}\"), mapfile -t <<< here-strings, and getopts with local OPTIND=1 in sync loops", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  for (const command of textCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(
      [
        'parse_cfg() {',
        '  local val="$1"',
        '  : "${val:=fallback_$2}"',
        '  local empty=""',
        '  local unset_var',
        '  : "${empty=keep_empty}" "${unset_var=set_unset}"',
        '  OUT="$val|$empty|$unset_var"',
        '}',
        'acc=0',
        'for ((i = 0; i < 40; i++)); do',
        '  if (( i % 2 == 0 )); then',
        '    parse_cfg "" "$i"',
        '  else',
        '    parse_cfg "explicit_$i" "$i"',
        '  fi',
        '  acc=$((acc + ${#OUT}))',
        'done',
        'printf "cfg:%d:%s\n" "$acc" "$OUT"',
        'text=$\'alpha\nbeta\ngamma\ndelta\'',
        'total=0',
        'for ((i = 0; i < 40; i++)); do',
        '  mapfile -t lines <<< "$text"',
        '  total=$((total + ${#lines[@]} + ${#lines[1]} + ${#lines[3]}))',
        'done',
        'readarray -t single <<< "solo_line"',
        'printf "mapfile:%d:%s:%d:%s\n" "$total" "${lines[2]}" "${#single[@]}" "${single[0]}"',
        'run_opts() {',
        '  local OPTIND=1 opt a=0 b=""',
        '  while getopts ":ab:" opt "$@"; do',
        '    case "$opt" in',
        '      a) a=$((a + 1)) ;;',
        '      b) b="$OPTARG" ;;',
        '    esac',
        '  done',
        '  REPLY="$a:$b:$OPTIND"',
        '}',
        'opt_total=0',
        'for ((i = 0; i < 40; i++)); do',
        '  run_opts -a -b "val_$i" -a rest',
        '  opt_total=$((opt_total + ${#REPLY}))',
        'done',
        'printf "opts:%d:%s\n" "$opt_total" "$REPLY"'
      ].join("\n")
    );
    assert.equal(
      result.stdout,
      "cfg:870:explicit_39||set_unset\nmapfile:520:gamma:1:solo_line\nopts:390:2:val_39:5\n"
    );
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("array slice/concat assignments, for-in array slices, local -n scalar/array namerefs, printf -v array elements, and declare -g in sync loops", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  for (const command of textCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(
      [
        "arr=(a b c d e f g h); sum_a=0",
        "for ((i = 0; i < 40; i++)); do",
        "  off=$((i % 5))",
        "  sub=(\"${arr[@]:off:3}\")",
        "  sum_a=$((sum_a + ${#sub[@]} + ${#sub[0]}))",
        "done",
        "printf \"slice:%d:%s\\n\" \"$sum_a\" \"${sub[*]}\";",
        "nums=(10 20 30 40 50 60 70 80); sum_b=0",
        "for ((i = 0; i < 40; i++)); do",
        "  off=$((i % 5))",
        "  for x in \"${nums[@]:off:3}\"; do sum_b=$((sum_b + x)); done",
        "done",
        "printf \"for_slice:%d\\n\" \"$sum_b\";",
        "a=(1 2 3); b=(4 5 6); sum_c=0",
        "for ((i = 0; i < 40; i++)); do",
        "  c=(\"${a[@]}\" \"${b[@]}\")",
        "  sum_c=$((sum_c + ${#c[@]} + ${c[4]}))",
        "done",
        "printf \"concat:%d\\n\" \"$sum_c\";",
        "bump() { local -n target=\"$1\"; target=$((target + $2)); }",
        "push_item() { local -n ref=\"$1\"; ref+=(\"$2\"); }",
        "set_glob() { declare -g GVAR=\"val_$1\"; }",
        "counter=0; items=(); fmt_arr=()",
        "for ((i = 0; i < 40; i++)); do",
        "  bump counter \"$i\"",
        "  push_item items \"$i\"",
        "  printf -v \"fmt_arr[$i]\" \"item_%04d\" \"$i\"",
        "  set_glob \"$i\"",
        "done",
        "printf \"nameref:%d:%d:%s:%s:%s\\n\" \"$counter\" \"${#items[@]}\" \"${items[39]}\" \"${fmt_arr[39]}\" \"$GVAR\""
      ].join("\n")
    );
    assert.equal(
      result.stdout,
      "slice:160:e f g\nfor_slice:4800\nconcat:440\nnameref:780:40:39:item_0039:val_39\n"
    );
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

test("local/declare -i -l -u, @U/@L/@u/@Q transforms, associative subscript arithmetic, [[ -v arr[i] ]], and unregistered [ guard", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  context.after(() => shell.dispose());

  const script = [
    "add_int() {",
    "  local -i a=\"$1\" b=\"$2\"",
    "  a+=b",
    "  res=$((res + a))",
    "}",
    "norm_case() {",
    "  local -l low=\"$1\"",
    "  local -u up=\"$1\"",
    "  out=\"$low:$up\"",
    "}",
    "res=0",
    "declare -i gtotal=0",
    "declare -l glow",
    "declare -u gup",
    "declare -a arr=([1]=10 [3]=30 [5]=50)",
    "declare -A map=([a]=10 [b]=20 [c]=30)",
    "map_sum=0",
    "vhits=0",
    "for ((i=0; i<6; i++)); do",
    "  add_int \"$i\" 4",
    "  gtotal+=i",
    "  norm_case \"AbC_$i\"",
    "  glow=\"XyZ_$i\"",
    "  gup=\"XyZ_$i\"",
    "  s=\"it's_val_$i\"",
    "  t_u=\"${s@U}\"",
    "  t_l=\"${s@L}\"",
    "  t_c=\"${s@u}\"",
    "  t_q=\"${s@Q}\"",
    "  for k in \"${!map[@]}\"; do",
    "    map_sum=$((map_sum + map[$k]))",
    "  done",
    "  if [[ -v \"arr[i]\" ]]; then",
    "    vhits=$((vhits + 1))",
    "  fi",
    "done",
    "echo \"res=$res gtotal=$gtotal out=$out glow=$glow gup=$gup\"",
    "echo \"transforms=$t_u|$t_l|$t_c|$t_q\"",
    "echo \"map_sum=$map_sum vhits=$vhits a=${a-<unset>} low=${low-<unset>} up=${up-<unset>}\"",
  ].join("\n");

  const res = await shell.exec(script);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, "");
  assert.equal(
    res.stdout,
    [
      "res=39 gtotal=15 out=abc_5:ABC_5 glow=xyz_5 gup=XYZ_5",
      "transforms=IT'S_VAL_5|it's_val_5|It's_val_5|'it'\\''s_val_5'",
      "map_sum=360 vhits=3 a=<unset> low=<unset> up=<unset>",
      "",
    ].join("\n"),
  );

  const noPredRes = await shell.exec('for i in 1 2; do echo "iter:$i"; [ -z "" ]; done');
  assert.equal(noPredRes.stdout, "iter:1\niter:2\n");
});

test("array member operators (${a[@]%.txt}, ${b[@]^^}, ${c[@]/A/X}) and prefix expansions (${!CFG_*}, ${!CFG_@}) in sync loops", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of basicCommands()) shell.commands.register(command);
  context.after(() => shell.dispose());

  const script = [
    "a=(alpha.txt beta.txt gamma.txt delta.txt)",
    "CFG_HOST=localhost",
    "CFG_PORT=8080",
    "CFG_MODE=prod",
    "cnt=0",
    "pcnt=0",
    "for ((i=0; i<6; i++)); do",
    "  b=(\"${a[@]%.txt}\")",
    "  c=(\"${b[@]^^}\")",
    "  d=(\"${c[@]/A/X}\")",
    "  for x in \"${a[@]%.txt}\"; do",
    "    cnt=$((cnt + ${#x}))",
    "  done",
    "  all=\"${!CFG_*}\"",
    "  for v in \"${!CFG_@}\"; do",
    "    pcnt=$((pcnt + ${#v}))",
    "  done",
    "done",
    "echo \"d=${d[*]} cnt=$cnt all=$all pcnt=$pcnt\"",
  ].join("\n");

  const res = await shell.exec(script);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, "");
  assert.equal(res.stdout, "d=XLPHA BETX GXMMA DELTX cnt=114 all=CFG_HOST CFG_MODE CFG_PORT pcnt=144\n");
});

for (const [name, source, expected] of [
  ["leading literal closing bracket", 's1="]a"; s2="ba]"; for i in 1 2; do echo "r1=${s1/[]a]/X} r2=${s2/[!]a]/X} r3=${s2/[^]a]/X}"; done', "r1=Xa r2=Xa] r3=Xa]\nr1=Xa r2=Xa] r3=Xa]\n"],
] as const) test(`sync loops preserve effects and values: ${name}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C.UTF-8" } });
  for (const command of basicCommands()) shell.commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
