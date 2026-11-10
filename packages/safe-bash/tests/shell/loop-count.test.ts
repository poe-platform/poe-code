import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const loop of ["for i in one", "for ((i=0; i<1; i++))", "while ((i++ < 1))", "until ((i++ >= 1))"]) {
  for (const command of ["break", "continue"]) {
    for (const body of [command, `! ${command}`, `! ! ${command}`, `! builtin ${command}`, `! ${command} >/dev/null`, `! { ${command}; }`, `! { ! ${command}; }`, `! eval '${command}'`, `for j in one; do ! ${command} 2; echo inner-unreachable; done`]) {
      for (const asyncLoop of [false, true]) {
        test(`${loop}: ${body} preserves Bash loop status (${asyncLoop ? "async" : "default"})`, async context => {
          const source = `i=0; ${loop}; do ${body}; echo unreachable; done; echo status:$?; i=0; if ${loop}; do ${body}; echo unreachable; done; then echo yes; else echo no; fi`;
          const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
          assert.equal(expected.error, undefined);
          const { shell } = setup();
          for (const builtin of basicCommands()) shell.commands.register(builtin);
          context.after(() => shell.dispose());
          const actual = await shell.exec(source, asyncLoop ? { signal: new AbortController().signal } : {});
          assert.equal(actual.stdout, expected.stdout);
          assert.equal(actual.stderr, expected.stderr);
          assert.equal(actual.exitCode, expected.status);
        });
      }
    }
  }
}

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
  for (const args of ["", "1", "0", "-1", "''", "junk", "9223372036854775807", "9223372036854775808", "-9223372036854775809", "1 2", "--", "-- junk", "-- --"]) {
    test(`${command} ignores arguments ${JSON.stringify(args)} outside loops`, async context => {
      const { shell } = setup();
      context.after(() => shell.dispose());
      const result = await shell.exec(`${command} ${args}; say "AFTER:$?"`);
      assert.equal(result.stdout, "AFTER:0\n");
      assert.equal(result.stderr, `shell: line 1: ${command}: only meaningful in a \`for', \`while', or \`until' loop\n`);
      assert.equal(result.exitCode, 0);
    });
  }

  test(`${command} outside loops does not trigger errexit for an invalid count`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`set -e; ${command} junk; say "AFTER:$?"`);
    assert.equal(result.stdout, "AFTER:0\n");
    assert.equal(result.stderr, `shell: line 1: ${command}: only meaningful in a \`for', \`while', or \`until' loop\n`);
    assert.equal(result.exitCode, 0);
  });

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
        assert.equal(result.stderr, `shell: line 1: ${command}: ${count}: loop count out of range\n`);
        assert.equal(result.exitCode, 0);
      } finally { await shell.dispose(); }
    });
  }
}
