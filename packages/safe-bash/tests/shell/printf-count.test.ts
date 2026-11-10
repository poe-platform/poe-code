import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const [initial, subscript, stdout, diagnostic] of [
  ["a=(OLD TWO)", "@", "1:1:2:OLD:TWO:OLD\n", "a[@]: bad array subscript"],
  ["a=(OLD TWO)", "*", "1:1:2:OLD:TWO:OLD\n", "a[*]: bad array subscript"],
  ["unset a", "@", "1:1:0:::\n", "a[@]: bad array subscript"],
  ["unset a", "*", "1:1:0:::\n", "a[*]: bad array subscript"],
  ["a=(OLD TWO); readonly a", "@", "1:1:2:OLD:TWO:OLD\n", "a[@]: bad array subscript"],
  ["a=(OLD TWO); readonly a", "*", "1:1:2:OLD:TWO:OLD\n", "a[*]: bad array subscript"],
  ["a=(OLD TWO)", "1", "0:1:2:OLD:X:OLD\n", ""],
  ["declare -A a=([keep]=OLD)", "@", "0:1:2:::OLD\n", ""],
  ["declare -A a=([keep]=OLD)", "*", "0:1:2:::OLD\n", ""],
  ["a=(OLD TWO)", "1/0", "", '1/0: division by 0 (error token is "0")'],
] as const) {
  test(`printf -v formats before rejecting an array destination: ${initial}; a[${subscript}]`, async context => {
    const script = `${initial}; key=''; n=old; printf -v 'a[${subscript}]' 'X%n' n; echo "$?:$n:\${#a[@]}:\${a[0]}:\${a[1]}:\${a[keep]}"`;
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script, "shell"], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C.UTF-8" }, timeout: 2000,
    });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    assert.equal(oracle.status, subscript === "1/0" ? 1 : 0);
    assert.equal(oracle.stdout.toString(), stdout);
    assert.equal(oracle.stderr.toString(), diagnostic ? `shell: line 1: ${diagnostic}\n` : "");
    const { shell, commands } = setup({ env: { LC_ALL: "C.UTF-8" } });
    for (const command of basicCommands()) commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.exitCode, oracle.status, result.stderr);
    assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
    assert.deepEqual(result.stderrBytes, new Uint8Array(oracle.stderr));
  });
}

for (const [name, script] of [
  ["variable output", `n=old; printf -v value '%s%n:%s' 'a b' n z; rc=$?; printf '%s|%s|%s' "$rc" "$value" "$n"`],
  ["stdout and format reuse", `printf '%s%n' a n bb m; printf '|%s|%s' "$n" "$m"`],
  ["variable output and format reuse", `printf -v value '%s%n' a n bb m; printf '%s|%s|%s' "$value" "$n" "$m"`],
  ["byte counts and padding", String.raw`printf -v value 'é:%5s%%\000%n:%s%n' x n z m; printf '%s|%s|%s' "$value" "$n" "$m"`],
  ["empty and missing destinations", `printf 'ab%n:%n:z' ''; printf '|%s' "$?"`],
  ["invalid destination stops output", `printf -v value 'ab%n:tail' 'a[1]'; printf '|%s|%s' "$?" "$value"`],
  ["readonly destination", `readonly n=old; printf 'ab%n:tail' n; printf '|%s|%s' "$?" "$n"`],
  ["local destination", `n=outer; f(){ local n; printf 'abc%n' n; printf '|%s' "$n"; }; f; printf '|%s' "$n"`],
  ["array destination", `n=(old tail); printf 'abc%n' n; printf '|%s|%s' "\${n[0]}" "\${n[1]}"`],
  ["subshell isolation", `n=old; (printf 'abc%n' n; printf '|%s' "$n"); printf '|%s' "$n"`],
  ["dynamic width and precision", `printf '%*.*s%+5n' 6 2 abcd n; printf '|%s' "$n"`],
  ["zero count", `n=old; printf '%n' n; printf '|%s' "$n"`],
  ["temporary assignment", `n=old; n=temp printf 'abc%n' n; printf '|%s' "$n"`],
  ["loop fallback", `for ((i=0;i<3;i++)); do printf '%s%n' "$i" n; printf '|%s' "$n"; done`],
  ["builtin and command dispatch", `builtin printf 'ab%n' n; command printf 'abc%n' m; printf '|%s|%s' "$n" "$m"`],
] as const) {
  test(`printf %n: ${name}`, async () => {
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000 });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    const { shell, commands } = setup({ env: { LC_ALL: "C" } });
    for (const command of basicCommands()) commands.register(command);
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status, result.stderr);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.equal(result.stderr.length > 0, oracle.stderr.length > 0);
    } finally { await shell.dispose(); }
  });
}
