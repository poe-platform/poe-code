import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const cases = [
  ['arr=(old0 old1 old2); unset arr; arr[1]=new1; say "keys=${!arr[*]} vals=${arr[*]}"', "keys=1 vals=new1\n"],
  ['arr=(old0 old1); unset arr; arr[0]+=suffix; say "vals=${arr[*]}"', "vals=suffix\n"],
  ['arr=(old0 old1); unset arr; arr+=(new); say "keys=${!arr[*]} vals=${arr[*]}"', "keys=0 vals=new\n"],
  ['f() { local -a arr=(old0 old1 old2); }; f; arr[1]=new1; say "keys=${!arr[*]} vals=${arr[*]}"', "keys=1 vals=new1\n"],
  ['f() { local -a arr=(old0 old1); }; f; arr[0]+=suffix; say "vals=${arr[*]}"', "vals=suffix\n"],
  ['declare -a ZZfresh; ZZrecycled=(1 2); unset ZZrecycled; declare -a ZZrecycled; say "vars=${!ZZ*}"', "vars=\n"],
  ['ZZrecycled=(); unset ZZrecycled; declare -a ZZrecycled; say "vars=${!ZZ*}"', "vars=\n"],
  ['f() { local -a ZZrecycled=(1 2); }; f; f() { local -a ZZrecycled; say "vars=${!ZZ*}"; }; f', "vars=\n"],
] as const;

for (const [source, stdout] of cases) {
  test(`recycled arrays start fresh: ${source}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  });
}
