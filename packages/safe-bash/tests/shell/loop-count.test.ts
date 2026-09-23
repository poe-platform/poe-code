import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const command of ["break", "continue"]) {
  for (const count of ["2", "9007199254740992", "9223372036854775807", "+009223372036854775807", " \t9223372036854775807\n", "0".repeat(4096) + "9223372036854775807"]) {
    test(`${command} clamps valid decimal count ${count.length > 80 ? "with many leading zeroes" : JSON.stringify(count)}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`for a in 1 2; do for b in 1 2; do say "$a:$b"; ${command} '${count}'; say BODY_AFTER; done; say OUTER_AFTER; done; say "AFTER:$?"`);
        assert.equal(result.stdout, command === "break" ? "1:1\nAFTER:0\n" : "1:1\n2:1\nAFTER:0\n");
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }

  for (const count of ["9223372036854775808", "-9223372036854775809", "999999999999999999999999999999999999999", "1.0", "1e0", "0x1", "2x", "junk", "NaN", "", "+"]) {
    test(`${command} rejects invalid or out-of-range count ${JSON.stringify(count)}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`for a in 1 2; do say "ITER:$a"; ${command} '${count}'; say BODY_AFTER; done; say "AFTER:$?"`);
        assert.equal(result.stdout, "ITER:1\n");
        assert.equal(result.stderr, `${command}: ${count}: numeric argument required\n`);
        assert.equal(result.exitCode, 2);
      } finally { await shell.dispose(); }
    });
  }

  for (const count of ["0", "-1", "-9223372036854775808"]) {
    test(`${command} preserves failed unwind for nonpositive decimal count ${count}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`for a in 1; do ${command} '${count}'; say BODY_AFTER; done; say "AFTER:$?"`);
        assert.equal(result.stdout, "AFTER:1\n");
        assert.equal(result.stderr, `${command}: invalid loop count\n`);
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
