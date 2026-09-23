import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

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
          ? `exit '${argument}'; say BODY_AFTER`
          : `f() { return '${argument}'; say BODY_AFTER; }; f; say "AFTER:$?"`;
        const result = await shell.exec(script);
        assert.equal(result.exitCode, command === "exit" ? 2 : 0);
        assert.equal(result.stdout, command === "exit" ? "" : "AFTER:2\n");
        assert.equal(result.stderr, `${command}: ${argument}: numeric argument required\n`);
      } finally { await shell.dispose(); }
    });
  }
}
