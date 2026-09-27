import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";

function createShell() {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } });
  for (const command of [...createStandardCommands(), ...createTextProgramCommands()]) {
    shell.commands.register(command, { replace: true });
  }
  return shell;
}

const cases = [
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
];

for (const source of cases) test(`fast-path Bash parity: ${source}`, async () => {
  const bash = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
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
