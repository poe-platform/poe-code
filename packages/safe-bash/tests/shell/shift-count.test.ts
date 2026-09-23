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

for (const [argument, status, count] of [["0", 0, 2], ["-0", 0, 2], ["2", 0, 0], ["3", 1, 2], ["-1", 1, 2], ["9223372036854775807", 1, 2], ["-9223372036854775808", 1, 2], ["1 2", 1, 2]] as const) {
  test(`shift preserves range and argument-count validation for ${argument}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`set -- first second; shift ${argument}; say "AFTER:$?:COUNT:$#"`);
      assert.equal(result.stdout, `AFTER:${status}:COUNT:${count}\n`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
