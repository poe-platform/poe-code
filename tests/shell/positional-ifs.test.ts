import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const prefix of ["unset IFS", "IFS=", "IFS=:,", "IFS=' '"]) {
  test(`quoted star joins using the first IFS character: ${prefix}`, async () => {
    const source = `set -- one "two words" "" three; ${prefix}; say "<$*>"`;
    const expected = bashResult('say() { printf "%s\\n" "$*"; }; ' + source);
    const { shell } = setup();
    const actual = await shell.exec(source);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.stdout, expected.stdout);
  });
}
