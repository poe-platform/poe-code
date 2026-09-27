import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { setup } from "./helpers.js";
import { printfCommand } from "../../src/commands/basic.js";
import { ShellLimitError } from "../../src/shell/index.js";

for (const [name, source] of [
  ["named parameter", 'x=5; (( $x == 5 )) && printf "ok\\n"'],
  ["special and positional parameters", 'set -- 10 20; (( $# == 2 && $1 == 10 )) && printf "ok\\n"'],
  ["array length", 'a=(x y z); (( ${#a[@]} == 3 )) && printf "ok\\n"'],
  ["default and assignment", '(( ${x:=5} == 5 && ${missing:-0} == 0 )); printf "%s:%s\\n" "$?" "$x"'],
  ["command substitutions", '(( $(printf 5) == `printf 5` )); printf "%s\\n" "$?"'],
  ["eager expansion", '(( 0 && ${x:=5} )); printf "%s:%s\\n" "$?" "$x"'],
  ["status parameter", 'false; (( $? == 1 )) && printf "ok\\n"'],
  ["braced bitwise expansion", 'x=1; (( ${x} & 2 == 0 )); printf "%s\\n" "$?"'],
  ["whole expression expansion", 'expression="1 | 2 == 0"; (( $expression )); printf "%s\\n" "$?"'],
  ["wide bitwise operand", 'x=4294967296; (( ($x | 2) == 4294967298 )); printf "%s\\n" "$?"'],
  ["negated bitwise status", 'x=1; ! (( $x ^ 2 >= 0 )); printf "%s:%s\\n" "$?" "${PIPESTATUS[*]}"'],
  ["division diagnostic", 'x=1; (( $x / 0 == 0 )); printf "%s\\n" "$?"'],
  ["loop clauses expand each iteration", 'start=0; limit=3; step=1; for (( i=$start; i<$limit; i+=$(printf "%s" "$step") )); do printf "%s\\n" "$i"; limit=2; done'],
] as const) {
  test(`arithmetic command expansion: ${name}`, async () => {
    const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", timeout: 2000, env: { PATH: process.env.PATH, LC_ALL: "C" } });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0);
    if (name !== "division diagnostic") assert.equal(native.stderr, "");
    const { shell } = setup();
    shell.register(printfCommand);
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, native.status, result.stderr);
      if (name === "division diagnostic") assert.ok(result.stderr.includes("division by 0"), result.stderr);
      else assert.equal(result.stderr, native.stderr);
      assert.equal(result.stdout, native.stdout);
    } finally { await shell.dispose(); }
  });
}

test("expanded binary comparison preserves parse admission", async () => {
  const { shell } = setup({ env: { x: "1" } });
  try {
    await assert.rejects(shell.exec('(( $x & 2 == 0 ))', { limits: { maxParseUnits: 10 } }),
      error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
    assert.equal((await shell.exec('(( $x & 2 == 0 ))')).exitCode, 1);
  } finally { await shell.dispose(); }
});

test("expanded binary comparison preserves cancellation during substitution", async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = { cancelled: "expanded binary comparison" };
  shell.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec('(( $(cancel) & 2 == 0 ))', { signal: controller.signal }), error => error === reason);
    assert.equal((await shell.exec('x=1; (( $x & 2 == 0 ))')).exitCode, 1);
  } finally { await shell.dispose(); }
});

for (const operator of ["&", "|", "^", "+", "-", "*", "/", "%"]) {
  for (const comparison of ["==", "!=", "<", ">", "<=", ">="]) {
    for (const grouped of [false, true]) {
      const binary = `$x ${operator} 2`;
      const expression = `${grouped ? `(${binary})` : binary} ${comparison} 0`;
      test(`expanded arithmetic precedence: ${expression}`, async () => {
        const source = `x=1; (( ${expression} ))`;
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", timeout: 2000, env: { PATH: process.env.PATH, LC_ALL: "C" } });
        assert.ifError(native.error);
        assert.equal(native.signal, null);
        const { shell } = setup();
        try {
          const result = await shell.exec(source);
          assert.equal(result.exitCode, native.status, result.stderr);
          assert.equal(result.stderr, native.stderr);
          assert.equal(result.stdout, native.stdout);
        } finally { await shell.dispose(); }
      });
    }
  }
}
