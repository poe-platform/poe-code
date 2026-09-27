import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { basicCommands, printfCommand } from "../../src/commands/basic.js";
import { writeText } from "../../src/contracts/index.js";

const cases = [
  ["command substitution", 'set -e\nvalue=$(($(printf 3)-1))\nprintf "%s\\n" "$value"', "2\n"],
  ["named parameter", 'set -e\nrows=3\nvalue=$(($rows-1))\nprintf "%s\\n" "$value"', "2\n"],
  ["bare variable control", 'rows=$(printf 3); value=$((rows-1)); printf "%s\\n" "$value"', "2\n"],
  ["braced parameter", 'rows=3; printf "%s\\n" "$((${rows}-1))"', "2\n"],
  ["parameter default", 'printf "%s\\n" "$((${rows:-3}-1))"', "2\n"],
  ["quoted parameter default", 'printf "%s\\n" "$((${rows:-"3"}-1))"', "2\n"],
  ["parameter assignment persists", 'value=$((${rows:=3}-1)); printf "%s:%s\\n" "$value" "$rows"', "2:3\n"],
  ["mixed positional and named", 'set -- 4; rows=3; printf "%s\\n" "$(($1+${1}-$rows-${rows}))"', "2\n"],
  ["positional star uses IFS", 'set -- 1 2; IFS=+; printf "%s\\n" "$(($*))"', "3\n"],
  ["positional at uses spaces", 'set -- 1 + 2; IFS=:; printf "%s\\n" "$(($@))"', "3\n"],
  ["nested arithmetic", 'rows=3; printf "%s\\n" "$(( $(( $rows-1 )) + 1 ))"', "3\n"],
  ["backtick substitution", 'printf "%s\\n" "$((`printf 3`-1))"', "2\n"],
  ["double quoted operand", 'rows=3; printf "%s\\n" "$((${rows}+"$(printf 3)"-1))"', "5\n", [4, 4]],
  ["literal double quoted operand", 'printf "%s\\n" "$(("3"-1))"', "2\n", [4, 4]],
  ["no field splitting", 'IFS=3; rows=3; printf "%s\\n" "$(($rows-1))"', "2\n"],
  ["command quoting and trailing newlines", 'printf "%s\\n" "$(($(printf "%s\\n\\n" "3")-1))"', "2\n"],
  ["substitution isolation", 'rows=3; value=$(($(rows=9; printf 3)-1)); printf "%s:%s\\n" "$value" "$rows"', "2:3\n"],
  ["substitution status", 'value=$(($(printf 3; false)-1)); printf "%s:%s\\n" "$value" "$?"', "2:1\n"],
  ["expanded assignment target", 'name=rows; value=$(($name=3)); printf "%s:%s\\n" "$value" "$rows"', "3:3\n"],
  ["arithmetic side effects", 'rows=3; value=$((rows++ + $rows)); printf "%s:%s\\n" "$value" "$rows"', "6:4\n"],
  ["eager substitution before short circuit", 'value=$((0 && ${rows:=3})); printf "%s:%s\\n" "$value" "$rows"', "0:3\n"],
  ["substitution not evaluated twice", 'rows=1; value=$(( $((rows++)) + $rows )); printf "%s:%s\\n" "$value" "$rows"', "3:2\n"],
] as const;

for (const [name, source, stdout, minimumVersion] of cases) {
  test(`arithmetic expansion native control: ${name}`, context => {
    if (minimumVersion) {
      // GNU Bash introduced double-quoted arithmetic identifiers in 4.4.
      const version = spawnSync("bash", ["--noprofile", "--norc", "-c", 'printf "%s.%s" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 10000 });
      assert.ifError(version.error);
      assert.equal(version.status, 0);
      assert.equal(version.stderr, "");
      const [major, minor] = version.stdout.split(".").map(Number);
      assert.ok(Number.isInteger(major) && Number.isInteger(minor));
      if (major! < minimumVersion[0] || (major === minimumVersion[0] && minor! < minimumVersion[1])) {
        context.skip(`Native oracle requires Bash ${minimumVersion.join(".")}; host is ${version.stdout}`);
        return;
      }
    }
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  });

  test(`arithmetic expansion: ${name}`, async () => {
    const { shell } = setup();
    shell.register(printfCommand);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}

for (const [name, source] of [
  ["literal single quotes", "printf '%s\\n' $(( '3' - 1 ))"],
  ["escaped dollar", 'rows=3; printf "%s\\n" "$((\\$rows-1))"'],
  ["backslash before ordinary character", 'printf "%s\\n" "$((\\3-1))"'],
  ["single quotes in parameter default", 'printf "%s\\n" "$((${missing:-\'3\'}-1))"'],
  ["positional at does not join with IFS", 'set -- 1 2; IFS=+; printf "%s\\n" "$(($@))"'],
  ["quotes from parameter are data", 'rows=\'"3"\'; printf "%s\\n" "$(($rows-1))"'],
  ["command text from parameter is not executed", 'rows=\'$(printf 3)\'; printf "%s\\n" "$(($rows-1))"'],
] as const) test(`arithmetic expansion rejects ${name}`, async () => {
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 10000 });
  assert.ifError(native.error);
  assert.equal(native.status, 1);
  assert.equal(native.stdout, "");
  const { shell } = setup();
  shell.register(printfCommand);
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("syntax error"), result.stderr);
  } finally { await shell.dispose(); }
});

for (const [limits, limit] of [
  [{ maxExpansionBytes: 12 }, "maxExpansionBytes"],
  [{ maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
  [{ maxCommands: 1 }, "maxCommands"],
  [{ maxOutputBytes: 2 }, "maxOutputBytes"],
] as const) test(`arithmetic expansion preserves ${limit}`, async () => {
  const { shell } = setup();
  shell.register(printfCommand);
  try {
    await assert.rejects(shell.exec('value=$(($(printf 1234567890123)-1))', { limits }),
      error => error instanceof ShellLimitError && error.limit === limit);
    assert.equal((await shell.exec('printf recovered')).stdout, "recovered");
  } finally { await shell.dispose(); }
});

test("arithmetic expansion charges dynamic arithmetic to the shared parse budget", async () => {
  const { shell } = setup({ env: { rows: Array.from({ length: 100 }, () => "1").join("+") } });
  try {
    await assert.rejects(shell.exec('value=$(($rows-1))', { limits: { maxParseUnits: 100 } }),
      error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
  } finally { await shell.dispose(); }
});

test("arithmetic expansion bounds the combined parameter and literal bytes", async () => {
  const { shell } = setup({ env: { rows: "12345678901" } });
  try {
    await assert.rejects(shell.exec('value=$(($rows-1))', { limits: { maxExpansionBytes: 12 } }),
      error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  } finally { await shell.dispose(); }
});

test("arithmetic expansion executes substitutions once and before arithmetic short circuit", async () => {
  const { shell } = setup();
  let calls = 0;
  shell.register({ name: "count", async execute({ stdout }) { calls++; await writeText(stdout, "3"); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('value=$((0 && $(count))); say "$value"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0\n");
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

for (const reason of [false, { cancelled: "arithmetic expansion" }]) test(`arithmetic expansion preserves ${typeof reason} cancellation`, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  shell.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec('value=$(($(cancel)+1))', { signal: controller.signal }), error => error === reason);
    assert.equal((await shell.exec('say recovered')).stdout, "recovered\n");
  } finally { await shell.dispose(); }
});

test("arithmetic expansion retains nounset diagnostics", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('set -u\nvalue=$(($missing-1))\nsay WRONG');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "shell: line 2: missing: unbound variable\n");
  } finally { await shell.dispose(); }
});

test("arithmetic expansion resolves scalar indirection", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('rows=3; name=rows; value=$((${!name}-1)); say "$value"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("substring arithmetic offsets, indexed array variable subscripts, and multi-term add/sub chains match bash", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`
      s="abcdefghijklmnopqrstuvwxyz0123456789"
      arr=(10 20 30 40 50)
      acc=0
      for ((i=0; i<20; i++)); do
        sub="\${s:i%10:4}"
        elem="\${arr[i%5]}"
        acc=$((acc + \${#sub} + elem + 1 + 2))
      done
      args "$acc"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "[\"740\"]");
  } finally { await shell.dispose(); }
});

test("wave 41: indirect expansion, :+/:= defaults, array element case conversion, and compound command substitutions", async () => {
  const { shell } = setup();
  for (const c of basicCommands()) shell.register(c);
  try {
    const result = await shell.exec(`
      v0=10; v1=20; v2=30; v3=40
      arr=(alpha beta gamma delta)
      fmt_item() {
        local id="$1" tag="$2"
        if [[ "$id" -lt 2 ]]; then
          printf "low:%s:%s" "$id" "\${tag:-none}"
          return 0
        fi
        printf "high:%s:%s" "$id" "\${tag^^}"
      }
      acc=0
      buf=""
      for ((i = 0; i < 8; i++)); do
        idx=$((i & 3))
        k="v$idx"
        a="\${i:+set_$i}"
        unset b
        c="\${b:=def_$idx}"
        fn_out="$(fmt_item "$idx" "\${arr[idx]^^}")"
        case_out="$(case $idx in 0) echo zero;; 1) echo one;; *) echo other;; esac)"
        buf+="x"
        acc=$((acc + \${!k} + \${#a} + \${#c} + \${#fn_out} + \${#case_out}))
      done
      args "$acc:\${#buf}:$b"
    `);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["404:8:def_3"]');
  } finally { await shell.dispose(); }
});

test("wave 42: dynamic pattern trim/replace, printf -v %x/%X/%o/%u, shift in functions, and sed/cut multi-field pipelines", async () => {
  const { shell } = setup();
  for (const c of basicCommands()) shell.register(c);
  const { textCommands } = await import("../../src/commands/text.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  for (const c of textCommands()) shell.commands.register(c, { replace: true });
  for (const c of createTextProgramCommands()) shell.commands.register(c, { replace: true });
  const script = [
    'pfx="pre_"; sfx="_end"; old="foo"; new="BAR"',
    'acc=0; last=""; out=""',
    'for ((i=0; i<40; i++)); do',
    '  s="pre_foo_item_${i}_foo_end"',
    '  s1="${s#$pfx}"',
    '  s2="${s1%$sfx}"',
    '  s3="${s2//$old/$new}"',
    '  printf -v out "%03d:%s:%x:%X:%o:%u" "$i" "$s3" "$((i * 16))" "$((i * 16))" "$i" "$i"',
    '  last="$out"',
    '  acc=$((acc + ${#out}))',
    'done',
    'sum_pairs() {',
    '  local total=0',
    '  while [[ $# -ge 2 ]]; do',
    '    total=$((total + $1 + $2))',
    '    shift 2',
    '  done',
    '  while [[ $# -gt 0 ]]; do',
    '    total=$((total + $1))',
    '    shift',
    '  done',
    '  REPLY=$total',
    '}',
    'grand=0',
    'for ((i=0; i<20; i++)); do',
    '  sum_pairs "$i" "$((i+1))" "$((i+2))" "$((i+3))" "$((i+4))"',
    '  grand=$((grand + REPLY))',
    'done',
    'pipe_last=""',
    'for ((i=0; i<15; i++)); do',
    '  pipe_last=$(printf "alpha:%d:mid:%d:omega\\n" "$i" "$((i*2))" | sed "s/alpha/BETA/" | cut -d: -f1,2,4)',
    'done',
    'echo "$acc|$last|$grand|$pipe_last"'
  ].join("\n");
  const result = await shell.exec(script);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "1258|039:BAR_item_39_BAR:270:270:47:39|1150|BETA:14:28");
});


  test("wave 46: sparse array keys in groups, local -a + IFS read -a + unset element, array element trim/replace, and dirname/basename/seq/rev/head/tail/wc substitutions", async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    for (const c of basicCommands()) shell.commands.register(c, { replace: true });
    const { textCommands } = await import("../../src/commands/text.js");
    const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
    const { grepCommands } = await import("../../src/commands/grep.js");
    const { streamCommands } = await import("../../src/commands/streams.js");
    const { createStreamFormatCommands } = await import("../../src/commands/stream-format/index.js");
    for (const c of [...textCommands(), ...createTextProgramCommands(), ...grepCommands(), ...streamCommands(), ...createStreamFormatCommands()]) shell.commands.register(c, { replace: true });
    const script = [
      'parts=(a b c); unset "parts[1]"; cnt=0; { (( cnt++ )); sparse_keys="${!parts[*]}"; }; echo "$cnt:$sparse_keys"',
      'step_read_a() { local -a row; IFS=: read -r -a row <<< "$1"; unset "row[1]"; out_a="${row[0]}-${row[2]}:${#row[@]}:${!row[*]}"; }',
      'for (( i = 0; i < 16; i++ )); do step_read_a "k${i}:drop:v${i}:tail"; done',
      'echo "$out_a"',
      'arr=("pre_alpha_suf" "pre_beta_suf")',
      'step_arr_ops() { local s1="${arr[*]#pre_}"; local s2="${arr[*]%_suf}"; local s3="${arr[*]/pre_/clean_}"; out_ops="${s1}|${s2}|${s3}"; }',
      'for (( i = 0; i < 16; i++ )); do step_arr_ops; done',
      'echo "$out_ops"',
      'step_pipe() {',
      '  local d=$(dirname "$1")',
      '  local b=$(basename "$1" .log)',
      '  local top=$(printf "%s\\n" "a" "b" "c" "d" | head -n 2 | tail -n 1)',
      '  local lc=$(printf "%s\\n" "x" "y" "z" | wc -l | tr -d " ")',
      '  local sq=$(seq 1 4 | tr "\\n" ",")',
      '  local rv=$(echo "$b" | rev)',
      '  out_p="${d}/${b}:${top}:${lc}:${sq}:${rv}"',
      '}',
      'for (( i = 0; i < 8; i++ )); do step_pipe "/var/log/app_${i}.log"; done',
      'echo "$out_p"',
    ].join("\n");
    const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
    });
    const actual = await shell.exec(script);
    assert.equal(actual.exitCode, expected.status, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
  });

  test("wave 45: compound/element array assignments in groups/functions, IFS read <<<, and awk/grep/sort -u command substitutions", async () => {
    const { shell } = setup();
    for (const c of basicCommands()) shell.register(c);
    const { textCommands } = await import("../../src/commands/text.js");
    const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
    const { grepCommands } = await import("../../src/commands/grep.js");
    const { streamCommands } = await import("../../src/commands/streams.js");
    for (const c of [...textCommands(), ...createTextProgramCommands(), ...grepCommands(), ...streamCommands()]) shell.commands.register(c, { replace: true });
    const script = [
      "{ echo first; arr=(1 2); echo \"${arr[@]}\"; }",
      "arr2=(10 20); { echo second; arr2[1]=99; echo \"${arr2[@]}\"; }",
      "declare -A counts=()",
      "step_arr() {",
      "  row=(\"$1\" \"$2\" \"$3\" \"$4\")",
      "  row+=(\"tail_$1\")",
      "  row[1]=\"mid_$2\"",
      "  local slice=\"${row[*]:1:3}\"",
      "  counts[\"$2\"]+=\"x\"",
      "  out=\"$slice:${#row[@]}\"",
      "}",
      "for (( i = 0; i < 16; i++ )); do step_arr \"$i\" \"k$((i & 3))\" \"v$i\" \"z\"; done",
      "echo \"$out|${#counts[@]}|${#counts[k0]}\"",
      "parse_kv() { local k v extra; IFS=: read -r k v extra <<< \"$1\"; acc+=\"${k}=${v};\"; }",
      "acc=\"\"; parse_kv \"a:1:x\"; parse_kv \"b:2:y\"; echo \"$acc\"",
      "f1=$(echo \"svc_9:port_8009:ok\" | awk -F: '{print $2}')",
      "f2=$(echo \"$f1\" | grep -oE '[0-9]+')",
      "f3=$(printf '%s\\n' \"b\" \"a\" \"b\" \"c\" \"#skip\" | grep -v '^#' | sort -u | tr '\\n' ',')",
      "echo \"$f1:$f2|$f3\"",
    ].join("\n");
    const res = await shell.exec(script);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, [
      "first",
      "1 2",
      "second",
      "10 99",
      "mid_k3 v15 z:5|4|4",
      "a=1;b=2;",
      "port_8009:8009|a,b,c,",
      "",
    ].join("\n"));
  });
test("wave 43: static (( ... )) in functions/while, dynamic [[ == ]]/case globs, and tr -d/-s + uniq command substitution pipelines", async () => {
  const { shell } = setup();
  for (const c of basicCommands()) shell.register(c);
  const { textCommands } = await import("../../src/commands/text.js");
  const { createTextProgramCommands } = await import("../../src/commands/text-programs/index.js");
  const { streamCommands } = await import("../../src/commands/streams.js");
  for (const c of [...textCommands(), ...createTextProgramCommands(), ...streamCommands()]) shell.commands.register(c, { replace: true });
  const script = [
    'step() { (( acc += $1 )); (( count++ )); if (( acc > 50 )); then (( acc -= 25 )); fi; }',
    'acc=0; count=0; i=0; pfx="item_"; sub="_ok"; tag="alpha"; hits=0; c1=0; c2=0',
    'classify() { case "$1" in "$tag"_*_[0-9]*) (( c1++ )) ;; *beta*gamma*) (( c2++ )) ;; esac; }',
    'run_row() {',
    '  local cleaned=$(printf "%s\\n" "$1" | sed "s/raw/clean/g" | tr -d " " | cut -d: -f1,3)',
    '  local dedup=$(printf "%s\\n" "x" "x" "y" "y" "z" | uniq)',
    '  row_out="${cleaned}|${dedup//$\x27\\n\x27/,}"',
    '}',
    'while (( i < 20 )); do',
    '  step "$i"',
    '  s="item_${i}_ok"',
    '  if [[ $s == "$pfx"* && $s == *"$sub" && $s == *_[0-9]*_ok ]]; then (( hits++ )); fi',
    '  classify "alpha_mid_${i}"',
    '  (( i++ ))',
    'done',
    'run_row "  raw_42 : skip : val_99  "',
    'echo "$acc:$count:$hits:$c1:$c2:$row_out"',
  ].join("\n");
  const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  });
  const actual = await shell.exec(script);
  assert.equal(actual.exitCode, expected.status, actual.stderr);
  assert.equal(actual.stdout, expected.stdout);

});

test("wave 48: compound loop control and associative element operations", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.commands.register(command, { replace: true });
  const result = await shell.exec([
    "work() {",
    "  local -A map=([a]=\"foo_bar\" [b]=\"baz_qux\" [c]=\"skip_me\")",
    "  local -a arr=(\"pre_one_suf\" \"pre_two_suf\")",
    "  local sum=0",
    "  local i=0",
    "  while (( i < 4 )); do",
    "    (( i += 1 ))",
    "    if (( i == 2 )); then continue; fi",
    "    if (( i == 4 )); then break; fi",
    "    (( sum += i ))",
    "  done",
    "  if [[ -v map[c] ]]; then unset \"map[c]\"; fi",
    "  local out=\"\"",
    "  for k in a b c; do",
    "    if [[ -v map[$k] ]]; then out=\"${out}${k}:${map[$k]/_/=},\"; fi",
    "  done",
    "  local p0=\"${arr[0]#pre_}\"",
    "  local p1=\"${p0%_suf}\"",
    "  printf '%s|%s|%s\\n' \"$sum\" \"$out\" \"$p1\"",
    "}",
    "work"
  ].join("\n"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "4|a:foo=bar,b:baz=qux,|one\n");
});

test("wave 49: propagates multi-level continue/break across sync/async loops and fast-paths printf -v array subscripts and >/dev/null", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.commands.register(command, { replace: true });
  const result = await shell.exec([
    "declare -A map",
    "declare -a arr",
    "work() {",
    "  local sum=0",
    "  for a in 1 2 3; do",
    "    for b in 1 2 3; do",
    "      if (( b == 2 )); then continue; fi",
    "      if (( a == 2 && b == 3 )); then continue 2; fi",
    "      if (( a == 3 && b == 1 )); then break 2; fi",
    "      (( sum += a * 10 + b ))",
    "    done",
    "    (( sum += 100 ))",
    "  done",
    "  local i=0",
    "  while (( i < 3 )); do",
    "    printf -v \"arr[i]\" \"v%02d\" \"$i\"",
    "    printf -v \"map[k_$i]\" \"m%02d\" \"$i\"",
    "    (( i += 1 ))",
    "  done",
    "  printf \"%d|%s|%s\\n\" \"$sum\" \"${arr[1]}\" \"${map[k_2]}\"",
    "}",
    "work >/dev/null",
    "out=$(work)",
    "printf \"%s\\n\" \"$out\""
  ].join("\n"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "145|v01|m02\n");
});

for (const [source, stdout] of [
  ['while break; do :; done; printf "done\\n"', "done\n"],
  ['for n in 1 2; do while break 2; do :; done; printf "bad\\n"; done; printf "done\\n"', "done\n"],
  ['i=0; while (( i < 3 )); do (( i+=1 )); while continue 2; do :; done; printf "bad\\n"; done; printf "%s\\n" "$i"', "3\n"],
] as const) {
  test(`compound loop condition control flow: ${source}`, async context => {
    const { shell } = setup({ limits: { maxLoopIterations: 50 } });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], {
      encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 5000,
    });
    assert.ifError(native.error);
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, stdout);
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, native.status, actual.stderr);
    assert.equal(actual.stderr, native.stderr);
    assert.equal(actual.stdout, native.stdout);
  });
}
