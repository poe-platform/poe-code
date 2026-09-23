import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const command of ["exit", "return"]) {
  for (const [argument, status] of [["9223372036854775807", 255], ["-9223372036854775808", 0], ["9007199254740993", 1], ["-257", 255], ["+000257", 1], [" \t257\n", 1], ["0".repeat(4096) + "257", 1]] as const) {
    test(`${command} accepts signed-long status ${JSON.stringify(argument.length > 80 ? "many leading zeroes" : argument)}`, async () => {
      const { shell } = setup();
      try {
        const body = `${command} '${argument}'; say BODY_AFTER`;
        const result = await shell.exec(command === "return" ? `f() { ${body}; }; f; say "AFTER:$?"` : body);
        assert.equal(result.stdout, command === "return" ? `AFTER:${status}\n` : "");
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, command === "return" ? 0 : status);
      } finally { await shell.dispose(); }
    });
  }
  for (const argument of ["9223372036854775808", "-9223372036854775809", "+009223372036854775808", "999999999999999999999999999999999999999"]) {
    test(`${command} rejects invalid or out-of-range status ${JSON.stringify(argument)}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(command === "return"
          ? `f() { return '${argument}'; say BODY_AFTER; }; f; say "AFTER:$?"`
          : `exit '${argument}'; say "AFTER:$?"`);
        assert.equal(result.stdout, "AFTER:2\n");
        assert.equal(result.stderr, `${command}: ${argument}: numeric argument required\n`);
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}

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
