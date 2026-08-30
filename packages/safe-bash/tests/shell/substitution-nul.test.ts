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
    assert.equal(actual.stderr, "shell: line 1: warning: command substitution: ignored null byte in input\n");
  });
}

test("substitution sanitization leaves ordinary binary pipelines unchanged", async () => {
  const { shell } = setup();
  const input = new Uint8Array([65, 0, 66, 10]);
  assert.deepEqual((await shell.exec("pass | pass", { stdin: input })).stdoutBytes, input);
  const substitution = await shell.exec('value=$(pass); args "$value"', { stdin: Uint8Array.of(0xc3, 0, 0xa9, 10) });
  assert.equal(substitution.stdout, '["é"]');
  assert.equal(substitution.stderr, "shell: line 1: warning: command substitution: ignored null byte in input\n");
});
