import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const cases = [
  ['a=(zero one two); declare -n r=a; args "${r[0]}" "${r[1]}" "${#r[@]}" "${#r[*]}" "${r[*]}"', ["zero", "one", "3", "3", "zero one two"]],
  ['a=("two words" "" tail); declare -n r=a; args "${r[@]}"', ["two words", "", "tail"]],
  ['f(){ local -n r=$1; args "${r[1]}" "${#r[@]}" "${r[@]}"; }; a=(10 20 30); f a', ["20", "3", "10", "20", "30"]],
  ['declare -A a; a[foo]=bar; declare -n r=a; args "${r[foo]}" "${#r[@]}" "${#r[*]}" "${r[@]}" "${r[*]}"', ["bar", "1", "1", "bar", "bar"]],
  ['a=([2]=two [5]="five words"); declare -n r=a; declare -n s=r; args "${s[-1]}" "${!s[@]}"', ["five words", "2", "5"]],
] as const;

for (const [source, expected] of cases) {
  test(`nameref array expansion: ${source}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), expected);
  });
}
