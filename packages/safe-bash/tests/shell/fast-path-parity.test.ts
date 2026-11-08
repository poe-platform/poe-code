import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { bashExecutable } from "../helpers/bash-oracle.js";

function createShell(fs = createMemoryFileSystem()) {
  const shell = new Shell({ fs, env: { LC_ALL: "C" } });
  for (const command of [...createStandardCommands(), ...createTextProgramCommands()]) {
    shell.commands.register(command, { replace: true });
  }
  return shell;
}

const cases = [
  ...["for i in 1 2", "for ((i=1; i<=2; i++))"].flatMap(loop => [
    "(( x = i + 1 ))",
    "(( x = i - 2 ))",
    "[[ $i -gt 0 ]]",
    "[[ $i -lt 0 ]]",
    "(( x = i + 1 )); [[ $x -gt 0 ]]",
    "x=$((i + 1)); (( x += 1 ))",
    "(( x = i + 1 )); x=$((i + 2))",
    "x=$((i + 1)); [[ $x -gt 0 ]]",
    "[[ $i -gt 0 ]]; x=$((i + 1))",
  ].map(body => `echo seed; ${loop}; do ${body}; done; printf '<%s>:%s\\n' "$_" "$?"`)),
  ...["/", "//", "/#", "/%"].map(operator =>
    'v="]a]b"; for i in 1 2; do echo "${v' + operator + '[]a]/X}" "${v' + operator + '[!]]/X}" "${v' + operator + '[^]]/X}"; done'),
  ...[
    ["]", "^[]a]+$"],
    ["x]", "^[^]]+$"],
    ["x", "^[^]]+$"],
    ["foo", "^(?:foo)$"],
    ["", "^()$"],
  ].flatMap(([subject, pattern]) => ["", "[[ a =~ a ]]; "].map(prime =>
    `${prime}subject='${subject}'; pattern='${pattern}'; for i in 1 2; do [[ $subject =~ $pattern ]] 2>/dev/null; printf '%s:<%s>:<%s>\\n' "$?" "\${BASH_REMATCH[0]}" "\${BASH_REMATCH[1]}"; done`)),
  'd=";"; read -r -d "$d" <<< "value;"; printf "<%s>\\n" "$_"',
  'd=";"; for i in 1 2; do read -r -d "$d"; printf "<%s>\\n" "$_"; done <<< "one;two;"',
  `s=$'a\\nb'; for i in 1 2; do [[ $s =~ ^.+$ ]]; echo "$?"; [[ foo =~ ^(?:foo)$ ]] 2>/dev/null; echo "$?"; [[ ']a' =~ ^[]a]+$ ]]; echo "$?"; done`,
  'x="a]b"; for i in 1 2; do echo "${x/[]a]/Z} ${x/[!]]/Z}"; done',
  'other=(); arr=("${other[@]}"); printf "%s\\n" "${#arr[@]}"',
  'other=(x "y z"); arr=("${other[@]}"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'other=(x y); arr=(start); arr+=("${other[@]}"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'other=(x y z); arr=("${!other[@]}"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'other=(w x y z); arr=("${other[@]:1:2}"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'other=(x y); f() { if true; then arr=("${other[@]}"); fi; }; f; printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'x=$(printf "abc\\n" | grep xyz); printf "%s|%s|%s\\n" "$?" "${PIPESTATUS[*]}" "$x"',
  'if x=$(printf "abc\\n" | grep xyz); then echo wrong; else echo right; fi',
  'x=$(printf "abc\\n" | grep xyz) || echo right',
  'x=$(printf "abc\\n" | grep xyz) && echo wrong; echo end',
  '! x=$(printf "abc\\n" | grep xyz); printf "%s|%s\\n" "$?" "${PIPESTATUS[*]}"',
  'x=$(printf "20\\n1e5\\n+10\\nInfinity\\n" | sort -n); printf "%s\\n" "$x"',
  'x=$(printf "1e2\\n100\\n1.0\\n" | sort -nu); printf "%s\\n" "$x"',
  'x=$(printf "20\\n1e5\\n+10\\nInfinity\\n" | sort -rn); printf "%s\\n" "$x"',
  'x=$(printf "123\\nabc\\n" | grep "[[:digit:]]"); printf "%s|%s\\n" "$x" "$?"',
  'x=$(printf "]\\na\\nb\\n" | grep "[]a]"); printf "%s|%s\\n" "$x" "$?"',
  `x=$(printf "apple\\nbanana\\ncherry\\n" | grep -F $'apple\\ncherry'); printf "%s|%s\\n" "$x" "$?"`,
  `x=$(printf "  a   b\\n" | awk -F" " '{print $1}'); printf "%s\\n" "$x"`,
  `x=$(printf "   \\nx y\\n" | awk '{print $NF}'); printf "[%s]\\n" "$x"`,
  ...["", '-F" "'].flatMap(separator => [
    `x=$(printf " \\t \\nx y\\n" | awk ${separator} '{print $NF, $1}'); printf "[%s]\\n" "$x"`,
    `x=$(awk ${separator} '{print $NF, $1}' <(printf " \\t \\nx y\\n")); printf "[%s]\\n" "$x"`,
  ]),
  ...['"héllo:world"', "$'1:2\\n3:4'", "$'a\\\\:b'"].map(value => `count=0; x=${value}; f() { if true; then count=$((count + 1)); IFS=: read a b <<< "$x"; fi; }; f; f; printf "%s|%s|%s\\n" "$count" "$a" "$b"`),
  'count=0; x="héllo:world"; f() { if true; then count=$((count + 1)); IFS=: read -r a b <<< "$x"; fi; }; f; f; printf "%s|%s|%s\\n" "$count" "$a" "$b"',
  'count=0; x=ascii; f() { if true; then count=$((count + 1)); x="héllo:world"; IFS=: read -r a b <<< "$x"; fi; }; f; f; printf "%s|%s|%s\\n" "$count" "$a" "$b"',
  ...['"héllo:world"', "$'1:2\\n3:4'", "$'a\\\\:b'"].map(value => `count=; x=${value}; f() { if true; then count+=x; IFS=: read a b <<< "$x"; fi; }; f; f; printf "%s|%s|%s\\n" "$count" "$a" "$b"`),
  'count=; x="héllo:world"; for i in 1 2; do count+=x; IFS=: read -r a b <<< "$x"; done; printf "%s|%s|%s\\n" "$count" "$a" "$b"',
  'count=; x="héllo:world"; while true; do count+=x; IFS=: read -r a b <<< "$x"; break; done; printf "%s|%s|%s\\n" "$count" "$a" "$b"',
  'count=; x="héllo:world"; f() { if true; then count+=x; IFS=: read -r a b <<< "$x"; fi; }; outer() { f; f; }; outer; printf "%s|%s|%s\\n" "$count" "$a" "$b"',
  'other=(x y); arr=("prefix${other[@]}suffix"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'other=(); arr=(start); arr+=("${other[@]}"); printf "%s\\n" "${#arr[@]}" "${arr[@]}"',
  'echo "${PIPESTATUS[*]}"; x=$(printf "abc\\n" | grep xyz); printf "%s|%s\\n" "$?" "${PIPESTATUS[*]}"',
  'x=$(printf "abc\\n" | grep xyz)$(printf ok); printf "%s|%s\\n" "$?" "$x"',
  'x=$(printf ok)$(printf "abc\\n" | grep xyz); printf "%s|%s\\n" "$?" "$x"',
  'while break; do echo wrong; done; echo done',
  'arr=(a); count=0; for ((i=0;i<3;i++)); do count=$((count+1)); done; printf "%s|%s\\n" "$count" "${PIPESTATUS[*]}"',
];

for (const separator of ["", '-F" "']) test(`awk file substitution retains zero-field records with ${separator || "default FS"}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode(" \t \nx y\n"));
  const shell = createShell(fs);
  try {
    const result = await shell.exec(`x=$(awk ${separator} '{print $NF, $1}' /input); printf "[%s]\\n" "$x"`);
    assert.equal(result.stdout, "[ \t  \ny x]\n");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("[ \t  \ny x]\n"));
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});

for (const source of cases) test(`fast-path Bash parity: ${source}`, async () => {
  // Bash 5.2's substitution length optimization miscounts an initial ] in a
  // negated bracket. Its equivalent escaped spelling avoids that oracle bug.
  // Keep the original source under test, including both ! and ^ spellings.
  const oracleSource = source.replaceAll("[!]]/", "[!\\]]/").replaceAll("[^]]/", "[^\\]]/");
  const bash = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", oracleSource], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  assert.ifError(bash.error);
  const shell = createShell();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, bash.stdout);
    assert.equal(result.stderr, bash.stderr);
    assert.equal(result.exitCode, bash.status);
  } finally {
    await shell.dispose();
  }
});

for (const [pipeline, expected] of [
  ['printf "a\\nb\\n" | head -n 1', "a\n"],
  ['printf "20\\n1e5\\n" | sort -n', "1e5\n20\n"],
  ['printf "hi\\nhi\\n" | sort -u', "hi\n"],
  ['printf "123\\nabc\\n" | grep "[[:digit:]]"', "123\n"],
  [`printf "  a   b\\n" | awk -F" " '{print $1}'`, "a\n"],
  [`printf "${"word ".repeat(80)}héllo\\n" | awk '{print $NF}'`, "héllo\n"],
  [`printf "${"123\\n".repeat(80)}abc\\n" | grep "[[:digit:]]"`, "123\n".repeat(80)],
] as const) test(`pipeline substitution works without global Buffer: ${pipeline}`, async () => {
  const shell = createShell();
  const buffer = globalThis.Buffer;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    const result = await shell.exec(`x=$(${pipeline}); printf "%s\\n" "$x"`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.Buffer = buffer;
    await shell.dispose();
  }
});

test("compound arithmetic fallback keeps diagnostics in shell stderr", async context => {
  const log = context.mock.method(console, "log", () => {});
  const shell = createShell();
  try {
    const result = await shell.exec("if true; then (( 1 / 0 )); fi");
    assert.match(result.stderr, /division by 0/u);
    assert.equal(log.mock.callCount(), 0);
  } finally { await shell.dispose(); }
});

for (const [source, stdout] of [
  ['for i in {1..3}; do echo "hi_$i"; done', 'hi_1\nhi_2\nhi_3\n'],
  ['for ((i=1; i<=3; i++)); do echo "hi_$i"; done', 'hi_1\nhi_2\nhi_3\n'],
  ['while read -r x; do echo "$x"; done <<< "hello"', 'hello\n'],
  ['mapfile -t lines <<< "hello"; printf "%s\\n" "${lines[@]}"', 'hello\n'],
  ['eval "echo ok"', 'ok\n'],
  ["trap 'echo done' EXIT; trap -p", "trap -- 'echo done' EXIT\ndone\n"],
  ['prefix_a=1; prefix_b=2; echo "${!prefix*}"', 'prefix_a prefix_b\n'],
  ['echo hello | xargs echo', 'hello\n'],
  ['x=aaa; echo "${x/a/b}"', 'baa\n'],
  ['x="éa"; echo "${x^^}"', 'éA\n'],
] as const) test(`shell fast paths without global Buffer: ${source}`, async () => {
  const shell = createShell();
  const buffer = globalThis.Buffer;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.Buffer = buffer;
    await shell.dispose();
  }
});
