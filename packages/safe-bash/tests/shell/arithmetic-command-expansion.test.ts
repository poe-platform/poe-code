import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { printfCommand } from "../../src/commands/basic.js";

for (const [name, source] of [
  ["named parameter", 'x=5; (( $x == 5 )) && printf "ok\\n"'],
  ["special and positional parameters", 'set -- 10 20; (( $# == 2 && $1 == 10 )) && printf "ok\\n"'],
  ["array length", 'a=(x y z); (( ${#a[@]} == 3 )) && printf "ok\\n"'],
  ["default and assignment", '(( ${x:=5} == 5 && ${missing:-0} == 0 )); printf "%s:%s\\n" "$?" "$x"'],
  ["command substitutions", '(( $(printf 5) == `printf 5` )); printf "%s\\n" "$?"'],
  ["eager expansion", '(( 0 && ${x:=5} )); printf "%s:%s\\n" "$?" "$x"'],
  ["status parameter", 'false; (( $? == 1 )) && printf "ok\\n"'],
  ["loop clauses expand each iteration", 'start=0; limit=3; step=1; for (( i=$start; i<$limit; i+=$(printf "%s" "$step") )); do printf "%s\\n" "$i"; limit=2; done'],
] as const) {
  test(`arithmetic command expansion: ${name}`, async () => {
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", timeout: 2000, env: { PATH: process.env.PATH, LC_ALL: "C" } });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0);
    assert.equal(native.stderr, "");
    const { shell } = setup();
    shell.register(printfCommand);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.stdout, native.stdout);
    } finally { await shell.dispose(); }
  });
}
