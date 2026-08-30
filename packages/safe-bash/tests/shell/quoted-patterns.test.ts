import assert from "node:assert/strict";
import { test } from "node:test";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

for (const source of [
  'value="abc*def"; say "${value%"*"*}"',
  'value="abc*def"; say "${value%\'*\'*}"',
  'value="abc*def"; say "${value%\\**}"',
  'value="abc*def"; say "${value%%"*"*}"',
  'value="abc*def"; say "${value#*"*"}"',
  'value="abc*def"; say "${value##*"*"}"',
  'value="abc*def"; pattern="*"; say "${value%"$pattern"*}"',
  'value="abc*def"; pattern="*"; say "${value%%$pattern}"',
  'value="abc?def"; say "${value%"?"*}"',
  'value="abc[def]"; say "${value%"["*}"',
  'value="abc*def"; say "${value%$(say "*")*}"',
  'value="abc*def"; say "${value%"$(say "*")"*}"',
]) {
  test(`parameter removal preserves pattern quoting: ${source}`, async () => {
    const expected = bashResult('say() { printf "%s\\n" "$*"; }; ' + source);
    const { shell } = setup();
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, { stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode });
  });
}
