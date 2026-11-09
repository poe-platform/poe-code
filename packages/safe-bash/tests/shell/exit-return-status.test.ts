import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const command of ["exit", "return"]) {
  for (const [args, operand] of [["x 4", "x"], ["-- x 4", "x"], ["9223372036854775808 4", "9223372036854775808"]]) {
    test(`${command} validates the first status before extra operands: ${args}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const script = command === "exit"
        ? `exit ${args}; say "AFTER:$?"`
        : `f() { return ${args}; say BODY_AFTER; }; f; say "AFTER:$?"`;
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "AFTER:2\n");
      assert.equal(result.stderr, `${command}: ${operand}: numeric argument required\n`);
    });
  }
}

for (const command of ["exit", "return"]) {
  const invocation = command === "exit"
    ? "exit 4 x"
    : "f() { return 4 x; say BODY_AFTER; }; f";
  for (const [script, stdout, exitCode] of [
    [`${invocation}; say AFTER`, "", 1],
    [`${invocation}\nsay AFTER`, "", 1],
    [`${invocation} || say RECOVER; say AFTER`, "", 1],
    [`(${invocation}; say CHILD_AFTER); say "PARENT:$?"`, "PARENT:1\n", 0],
    [`value=$(${invocation}; say CHILD_AFTER); say "PARENT:$?:<$value>"`, "PARENT:1:<>\n", 0],
  ] as const) {
    test(`${command} extra operands terminate only the current shell: ${script}`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(script);
      assert.equal(result.stdout, stdout);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stderr, `${command}: too many arguments\n`);
    });
  }
}

for (const [script, stdout, exitCode] of [
  ["exit 4; say AFTER", "", 4],
  ['f() { return 4; say BODY_AFTER; }; f; say "AFTER:$?"', "AFTER:4\n", 0],
] as const) {
  test(`valid status preserves exit/return scope: ${script}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.stderr, "");
  });
}

for (const [script, exitCode, stdout] of [
  ['exit junk; say "AFTER:$?"', 0, "AFTER:2\n"],
  ["exit junk", 2, ""],
  ["set -e; exit junk; say BODY_AFTER", 2, ""],
  ['exit junk || say "RECOVER:$?"', 0, "RECOVER:2\n"],
  ['f() { exit junk; say "BODY:$?"; }; f; say "AFTER:$?"', 0, "BODY:2\nAFTER:0\n"],
] as const) {
  test(`Bash 5.3 exit numeric error: ${script}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "exit: junk: numeric argument required\n");
    } finally { await shell.dispose(); }
  });
}

for (const command of ["exit", "return"]) {
  for (const [argument, status] of [[" 0 ", 0], ["\t0\t", 0], ["0\n", 0], ["\n\v\f\r +257 \t", 1], [" \t-1\n", 255], ["0007", 7]] as const) {
    test(`${command} accepts decimal status ${JSON.stringify(argument)}`, async () => {
      const { shell } = setup();
      try {
        const script = command === "exit"
          ? `exit '${argument}'; say BODY_AFTER`
          : `f() { return '${argument}'; say BODY_AFTER; }; f; say "AFTER:$?"`;
        const result = await shell.exec(script);
        assert.equal(result.exitCode, command === "exit" ? status : 0);
        assert.equal(result.stdout, command === "exit" ? "" : `AFTER:${status}\n`);
        assert.equal(result.stderr, "");
      } finally { await shell.dispose(); }
    });
  }

  for (const argument of ["", " \t\n", " + ", " 1 2 ", " 1.0 ", " 1e0 ", " 0x1 ", " 2x ", "\u00a00\u00a0"]) {
    test(`${command} rejects nondecimal status ${JSON.stringify(argument)}`, async () => {
      const { shell } = setup();
      try {
        const script = command === "exit"
          ? `exit '${argument}'; say "AFTER:$?"`
          : `f() { return '${argument}'; say BODY_AFTER; }; f; say "AFTER:$?"`;
        const result = await shell.exec(script);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "AFTER:2\n");
        assert.equal(result.stderr, `${command}: ${argument}: numeric argument required\n`);
      } finally { await shell.dispose(); }
    });
  }
}
