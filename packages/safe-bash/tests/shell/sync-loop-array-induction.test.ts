import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

const scripts = [
  'arr=(); for i in 1 2 3; do arr+=("$i"); done; echo "${arr[@]}"',
  'arr=(); for ((i=0;i<3;i++)); do arr+=("$i"); done; echo "${arr[@]}"',
  'arr=(zero); for i in 1 2; do arr[$((i+1))]="v$i"; done; echo "${arr[@]}"',
  'arr=(zero); for ((i=0;i<3;i++)); do arr[$((i+1))]="v$i"; done; echo "${arr[@]}"',
  'readonly -a arr=(zero); for i in 1 2; do arr+=("$i"); done',
  'readonly -a arr=(zero); for ((i=0;i<3;i++)); do arr+=("$i"); done',
  ...['$arr', '${arr}', '${#arr}', '${arr:-fb}', '${arr^}', '${arr#h}', '${arr/h/H}', '${arr:0:2}'].flatMap(value => [
    `arr=(hello world); for i in 1 2; do echo "${value}" b; done`,
    `arr=(hello world); for i in 1 2; do printf '%s\\n' "${value}"; done`,
    `arr=(hello world); for i in 1 2; do x="${value}"; done; echo "$x"`,
  ]),
  'arr=(hello world); for i in 1 2; do [[ "$arr" == hello ]] && echo ok || echo bad; done',
  'arr=([2]=world); for i in 1 2; do echo "${arr:-fb}" "${#arr}"; done',
  'arr=(); for i in 1 2; do read -ra arr <<< "hello world"; echo "$arr"; done',
  'arr=(); for i in 1 2; do mapfile -t arr <<< "hello"; echo "$arr"; done',
  ...['IFS=: read -r i', 'read -r "i"', 'printf -v "i" %s'].map(command =>
    `for i in {1..2}; do ${command} ${command.startsWith('printf') ? 'abc' : '<<< "abc"'}; printf '%d\\n' "$i"; done`),
  'i=0; while ((i<2)); do IFS=: read -r i <<< "10000000000000000"; printf "%d\\n" "$i"; done',
  'for REPLY in 1 2; do IFS=: read -r <<< "abc"; printf "%d\\n" "$REPLY"; done',
];

const loopScripts = scripts.flatMap(script => [
  script,
  script.replace("for i in 1 2; do", "for ((i=1;i<=2;i++)); do"),
  script.replace("for i in 1 2; do", "j=0; while ((j++<2)); do"),
]);

for (const script of new Set(loopScripts)) test(`sync loop matches Bash: ${script}`, async () => {
  const expected = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(expected.error, undefined);
  // macOS ships Bash 3, before case conversion and mapfile were introduced.
  const stdout = script.includes("${arr^}")
    ? script.includes(" b;") ? "Hello b\nHello b\n" : script.includes('echo "$x"') ? "Hello\n" : "Hello\nHello\n"
    : script.includes("mapfile") ? "hello\nhello\n" : expected.stdout;
  const modernFeature = script.includes("${arr^}") || script.includes("mapfile");
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec(script);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, modernFeature ? 0 : expected.status);
    assert.equal(Boolean(result.stderr), modernFeature ? false : Boolean(expected.stderr));
  } finally { await shell.dispose(); }
});
