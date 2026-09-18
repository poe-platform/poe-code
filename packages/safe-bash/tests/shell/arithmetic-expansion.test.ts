import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { printfCommand } from "../../src/commands/basic.js";
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
  ["double quoted operand", 'rows=3; printf "%s\\n" "$((${rows}+"$(printf 3)"-1))"', "5\n"],
  ["literal double quoted operand", 'printf "%s\\n" "$(("3"-1))"', "2\n"],
  ["no field splitting", 'IFS=3; rows=3; printf "%s\\n" "$(($rows-1))"', "2\n"],
  ["command quoting and trailing newlines", 'printf "%s\\n" "$(($(printf "%s\\n\\n" "3")-1))"', "2\n"],
  ["substitution isolation", 'rows=3; value=$(($(rows=9; printf 3)-1)); printf "%s:%s\\n" "$value" "$rows"', "2:3\n"],
  ["substitution status", 'value=$(($(printf 3; false)-1)); printf "%s:%s\\n" "$value" "$?"', "2:1\n"],
  ["expanded assignment target", 'name=rows; value=$(($name=3)); printf "%s:%s\\n" "$value" "$rows"', "3:3\n"],
  ["arithmetic side effects", 'rows=3; value=$((rows++ + $rows)); printf "%s:%s\\n" "$value" "$rows"', "6:4\n"],
  ["eager substitution before short circuit", 'value=$((0 && ${rows:=3})); printf "%s:%s\\n" "$value" "$rows"', "0:3\n"],
  ["substitution not evaluated twice", 'rows=1; value=$(( $((rows++)) + $rows )); printf "%s:%s\\n" "$value" "$rows"', "3:2\n"],
] as const;

for (const [name, source, stdout] of cases) {
  test(`arithmetic expansion native control: ${name}`, () => {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 2000 });
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
  const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C" }, timeout: 2000 });
  assert.ifError(native.error);
  assert.equal(native.status, 1);
  assert.equal(native.stdout, "");
  const { shell } = setup();
  shell.register(printfCommand);
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("arithmetic syntax error"), result.stderr);
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

test("arithmetic expansion retains the unsupported scalar indirection restriction", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('rows=3; name=rows; value=$((${!name}-1))');
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("Unsupported indirect parameter expansion"), result.stderr);
  } finally { await shell.dispose(); }
});
