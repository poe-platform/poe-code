import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const argument of ["1.0", "1e0", "0x1", "junk", "", "+", "1 0", "\u00a01\u00a0", "9223372036854775808", "-9223372036854775809"]) {
  test(`shift rejects nondecimal or overflowing count ${JSON.stringify(argument)}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift '${argument}'; say "AFTER:$?:COUNT:$#:$1:$2"`);
      assert.equal(result.stdout, "AFTER:2:COUNT:2:first:second\n");
      assert.equal(result.stderr, `shift: ${argument}: numeric argument required\n`);
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
    assert.equal(result.stderr, "shift: too many arguments\n");
    assert.equal(result.exitCode, exitCode);
  });
}

for (const command of ["shift", "builtin shift", "command shift"]) {
  test(`${command} validates the numeric count before extra operands`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -- first second; ${command} x y; say "AFTER:$?:COUNT:$#:$1:$2"`);
    assert.equal(result.stdout, "AFTER:2:COUNT:2:first:second\n");
    assert.equal(result.stderr, "shift: x: numeric argument required\n");
    assert.equal(result.exitCode, 0);
  });
}

for (const argument of ["-1", "-- -1", "-9223372036854775808"]) {
  test(`shift diagnoses negative count ${argument} without changing positionals`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift ${argument}; say "AFTER:$?:COUNT:$#:$1:$2"`);
      assert.equal(result.stdout, "AFTER:1:COUNT:2:first:second\n");
      assert.equal(result.stderr, `shift: ${argument === "-- -1" ? "-1" : argument}: shift count out of range\n`);
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
