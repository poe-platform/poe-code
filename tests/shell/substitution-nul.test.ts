import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const stdin of ["a\0b", "a\0b\n\n", "a\n\0", "\0\0", "é\0🙂\n"]) {
  test(`command substitution removes NUL before trimming newlines: ${JSON.stringify(stdin)}`, async () => {
    const source = 'value=$(pass); say "<$value>"';
    const expected = bashResult('pass() { cat; }; say() { printf "%s\\n" "$*"; }; ' + source, { stdin });
    const { shell } = setup();
    const actual = await shell.exec(source, { stdin });
    assert.equal(actual.stdout, expected.stdout);
    assert.equal(actual.exitCode, expected.exitCode);
  });
}

test("substitution sanitization leaves ordinary binary pipelines unchanged", async () => {
  const { shell } = setup();
  const input = new Uint8Array([65, 0, 66, 10]);
  assert.deepEqual((await shell.exec("pass | pass", { stdin: input })).stdoutBytes, input);
});
