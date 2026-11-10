import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const [source, stdout, stderr, exitCode] of [
  ['set -- a b; printf "pre: ";\nshift -1; printf %s "$?"', "pre: 1", "shell: line 2: shift: -1: shift count out of range\n", 0],
  ['set -- a b; printf "pre: ";\nshift -- 2 3; printf %s "$?"', "pre: ", "shell: line 2: shift: too many arguments\n", 1],
  ['set -- a b; printf "pre: ";\nshift 5; printf %s "$?"', "pre: 1", "", 0],
  ['set -- one two; shift 1; printf "%s:%s:%s" "$?" "$#" "$*"', "0:1:two", "", 0],
] as const) {
  test(`shift diagnostic acceptance: ${source}`, async context => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.deepEqual([result.stdout, result.stderr, result.exitCode], [stdout, stderr, exitCode]);
  });
}

for (const command of ["shift", "builtin shift", "command shift"]) {
  test(`${command} reports the named shell and source line`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`bash -c 'set -- a b;\n\n${command} -1' named-shell`);
    assert.equal(result.stderr, "named-shell: line 3: shift: -1: shift count out of range\n");
    assert.equal(result.exitCode, 1);
  });
}

for (const command of ["bash /shift.sh", ". /shift.sh"]) {
  test(`${command} reports the script filename and source line`, async context => {
    const { shell, fs } = setup();
    context.after(() => shell.dispose());
    await fs.writeFile("/shift.sh", new TextEncoder().encode("set -- a b\n\nshift -1"));
    const result = await shell.exec(command);
    assert.equal(result.stderr, "/shift.sh: line 3: shift: -1: shift count out of range\n");
    assert.equal(result.exitCode, 1);
  });
}

for (const [options, argument, positionals, diagnostic, status] of [
  ["", "3", "a b", "", 1],
  ["shopt -s shift_verbose;", "3", "a b", "3: ", 1],
  ["shopt -s shift_verbose;", "-- +03", "a b", "+03: ", 1],
  ["shopt -s shift_verbose;", "", "", "", 1],
  ["shopt -s shift_verbose;", "--", "", "", 1],
  ["shopt -s shift_verbose; shopt -u shift_verbose;", "3", "a b", "", 1],
  ["shopt -u shift_verbose;", "-1", "a b", "-1: ", 1],
  ["shopt -s shift_verbose;", "0", "a b", "", 0],
] as const) {
  test(`shift_verbose behavior: ${options} shift ${argument} with (${positionals})`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -- ${positionals}; ${options} shift ${argument}; say "$?|$*"`);
    assert.equal(result.stdout, `${status}|${positionals}\n`);
    const verbose = options === "shopt -s shift_verbose;" && status === 1;
    assert.equal(result.stderr, verbose || diagnostic ? `shell: line 1: shift: ${diagnostic}shift count out of range\n` : "");
    assert.equal(result.exitCode, 0);
  });
}

for (const posix of [undefined, "", "1"]) {
  test(`shift_verbose startup and session state with POSIXLY_CORRECT=${JSON.stringify(posix)}`, async context => {
    const { shell } = setup({ env: posix === undefined ? {} : { POSIXLY_CORRECT: posix } });
    context.after(() => shell.dispose());
    const initial = await shell.exec('shopt -p shift_verbose; shopt -q shift_verbose; say "$?"; shift', { onState() {} });
    const enabled = posix !== undefined;
    assert.equal(initial.stdout, `shopt -${enabled ? "s" : "u"} shift_verbose\n${enabled ? 0 : 1}\n`);
    assert.equal(initial.stderr, enabled ? "shell: line 1: shift: shift count out of range\n" : "");
    assert.equal(initial.exitCode, 1);
    const changed = await shell.exec(`shopt -${enabled ? "u" : "s"} shift_verbose`, { state: initial.state });
    assert.equal(changed.state?.options?.shift_verbose, !enabled);
    const restored = await shell.exec(`(shopt -${enabled ? "s" : "u"} shift_verbose); shopt -q shift_verbose; say "$?"; shift`, { state: changed.state });
    assert.equal(restored.stdout, `${enabled ? 1 : 0}\n`);
    assert.equal(restored.stderr, enabled ? "" : "shell: line 1: shift: shift count out of range\n");
    assert.equal(restored.exitCode, 1);
  });
}

test("nested bash initializes shift_verbose from its exported environment", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`POSIXLY_CORRECT=1 bash -c 'shopt -p shift_verbose; shift; shopt -u shift_verbose; shift'`);
  assert.equal(result.stdout, "shopt -s shift_verbose\n");
  assert.equal(result.stderr, "bash: line 1: shift: shift count out of range\n");
  assert.equal(result.exitCode, 1);
});

for (const command of ["shift --help", "shift --help ignored", "builtin shift --help", "command shift --help"]) {
  for (const inFunction of [false, true]) {
    test(`${command} prints help without shifting ${inFunction ? "in a function" : "at top level"}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const source = `${command}; say "status=$? args=$*"`;
      const result = await shell.exec(inFunction ? `f() { ${source}; }; f a b` : `set -- a b; ${source}`);
      assert.equal(result.stdout, [
        "shift: shift [n]",
        "    Shift positional parameters.",
        "    ",
        "    Rename the positional parameters $N+1,$N+2 ... to $1,$2 ...  If N is",
        "    not given, it is assumed to be 1.",
        "    ",
        "    Exit Status:",
        "    Returns success unless N is negative or greater than $#.",
        "status=2 args=a b",
        "",
      ].join("\n"));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    });
  }
}

test("shift treats --help after -- as a numeric operand", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('set -- a b; shift -- --help; say "status=$? args=$*"');
  assert.equal(result.stdout, "status=2 args=a b\n");
  assert.equal(result.stderr, "shell: line 1: shift: --help: numeric argument required\n");
  assert.equal(result.exitCode, 0);
});

for (const argument of ["1.0", "1e0", "0x1", "junk", "", "+", "1 0", "\u00a01\u00a0", "9223372036854775808", "-9223372036854775809"]) {
  test(`shift rejects nondecimal or overflowing count ${JSON.stringify(argument)}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift '${argument}'; say "AFTER:$?:COUNT:$#:$1:$2"`);
      assert.equal(result.stdout, "AFTER:2:COUNT:2:first:second\n");
      assert.equal(result.stderr, `shell: line 1: shift: ${argument}: numeric argument required\n`);
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const argument of [undefined, "1", "+01", " \t1\n", "0".repeat(4096) + "1"]) {
  test(`shift accepts decimal count ${argument === undefined ? "by default" : argument.length > 80 ? "with leading zeroes" : JSON.stringify(argument)}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift ${argument === undefined ? "" : `'${argument}'`}; say "AFTER:$?:COUNT:$#:$1"`);
      assert.equal(result.stdout, "AFTER:0:COUNT:1:second\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [argument, status, count] of [["0", 0, 2], ["-0", 0, 2], ["2", 0, 0], ["3", 1, 2], ["-- 3", 1, 2], ["9223372036854775807", 1, 2]] as const) {
  test(`shift preserves range validation for ${argument}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift ${argument}; say "AFTER:$?:COUNT:$#"`);
      assert.equal(result.stdout, `AFTER:${status}:COUNT:${count}\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [name, source, stdout, exitCode] of [
  ["same line", "shift 1 2; say after", "", 1],
  ["separate lines", "shift 1 2\nsay after", "", 1],
  ["builtin wrapper", "builtin shift 1 2; say after", "", 1],
  ["command wrapper", "command shift 1 2; say after", "", 1],
  ["or list", "shift 1 2 || say recovered; say after", "", 1],
  ["subshell", '(shift 1 2; say child); say "parent:$?:$*"', "parent:1:first second\n", 0],
  ["function", "f() { shift 1 2; say child; }; f a b; say after", "", 1],
  ["loop", "for i in 1 2; do shift 1 2; say child; done; say after", "", 1],
  ["expanded operands", "counts='1 2'; shift $counts; say after", "", 1],
  ["negative count", "shift -1 2; say after", "", 1],
  ["out-of-range count", "shift 3 2; say after", "", 1],
  ["exit trap", `trap 'say "exit:$?:$*"' EXIT; shift 1 2; say after`, "exit:1:first second\n", 1],
] as const) {
  test(`shift extra operands terminate the current shell: ${name}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -- first second; ${source}`);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "shell: line 1: shift: too many arguments\n");
    assert.equal(result.exitCode, exitCode);
  });
}

for (const command of ["shift", "builtin shift", "command shift"]) {
  test(`${command} validates the numeric count before extra operands`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -- first second; ${command} x y; say "AFTER:$?:COUNT:$#:$1:$2"`);
    assert.equal(result.stdout, "AFTER:2:COUNT:2:first:second\n");
    assert.equal(result.stderr, "shell: line 1: shift: x: numeric argument required\n");
    assert.equal(result.exitCode, 0);
  });
}

for (const argument of ["-1", "-- -1", "-9223372036854775808"]) {
  test(`shift diagnoses negative count ${argument} without changing positionals`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift ${argument}; say "AFTER:$?:COUNT:$#:$1:$2"`);
      assert.equal(result.stdout, "AFTER:1:COUNT:2:first:second\n");
      assert.equal(result.stderr, `shell: line 1: shift: ${argument === "-- -1" ? "-1" : argument}: shift count out of range\n`);
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const operand of ["bad", "9223372036854775808"]) {
  for (const [name, source, stdout, exitCode] of [
    ["unguarded", `shift ${operand}; say continued`, "", 2],
    ["separate lines", `shift ${operand}\nsay continued`, "", 2],
    ["or list", `shift ${operand} || say recovered; say continued`, "recovered\ncontinued\n", 0],
    ["condition", `if shift ${operand}; then say unexpected; fi; say continued`, "continued\n", 0],
    ["negated", `! shift ${operand}; say continued`, "continued\n", 0],
    ["command wrapper", `command shift ${operand}; say "continued:$?"`, "continued:2\n", 0],
    ["builtin wrapper", `builtin shift ${operand}; say "continued:$?"`, "continued:2\n", 0],
    ["subshell", `(shift ${operand}; say unexpected); say "parent:$?"`, "parent:2\n", 0],
    ["function", `f() { shift ${operand}; say unexpected; }; f; say continued`, "", 2],
    ["guarded function", `f() { shift ${operand}; say continued; }; f || say recovered`, "continued\n", 0],
    ["exit trap", `trap 'say "exit:$?:$*"' EXIT; shift ${operand}; say continued`, "exit:2:first second\n", 2],
  ] as const) {
    test(`POSIX shift numeric error ${operand}: ${name}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`POSIXLY_CORRECT=1; set -- first second; ${source}`);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, `shell: line 1: shift: ${operand}: numeric argument required\n`);
      assert.equal(result.exitCode, exitCode);
    });
  }
}

test("shift numeric errors terminate with inherited POSIXLY_CORRECT", async context => {
  const { shell } = setup({ env: { POSIXLY_CORRECT: "" } });
  context.after(() => shell.dispose());
  const result = await shell.exec('set -- first second; shift bad; say continued');
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 1: shift: bad: numeric argument required\n");
  assert.equal(result.exitCode, 2);
});

for (const operand of ["3", "-1"]) {
  test(`POSIX shift range error ${operand} remains recoverable`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`POSIXLY_CORRECT=1; set -- first second; shift ${operand}; say "continued:$?:$*"`);
    assert.equal(result.stdout, "continued:1:first second\n");
    assert.equal(result.stderr, operand === "-1" ? "shell: line 1: shift: -1: shift count out of range\n" : "");
    assert.equal(result.exitCode, 0);
  });
}
