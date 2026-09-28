import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [label, source, stdout] of [
  ["quoted prefix names", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; echo "${!pre@}"; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
  ["prefix names as function arguments", 'pre_1=a; pre_2=b; f(){ echo "$#:$1:$2"; }; for i in 1 2; do echo "iter=$i"; f "${!pre@}"; done', "iter=1\n2:pre_1:pre_2\niter=2\n2:pre_1:pre_2\n"],
  ["prefix names with changing IFS", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; IFS=; echo ${!pre@}; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
  ["nested prefix names", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; echo "${missing:-${!pre@}}"; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
  ["local nameref with dynamic target", 'arr=(a b); f(){ local -n ref="$1"; echo "ref=$ref"; }; for i in arr "arr[@]"; do echo "iter=$i"; f "$i"; done', "iter=arr\nref=a\niter=arr[@]\nref=a b\n"],
  ["nameref target inspection", 'x=hello; declare -n ref=x; for i in 1 2; do echo "iter=$i"; y="${!ref}"; done; echo "y=$y"', "iter=1\niter=2\ny=x\n"],
  ["indirect array element", 'arr=(zero one); ptr="arr[0]"; for i in 1 2; do echo "iter=$i"; y="${!ptr}"; done; echo "y=$y"', "iter=1\niter=2\ny=zero\n"],
  ["local member nameref", 'arr=(a b); f(){ local -n ref="arr[@]"; echo "ref=$ref"; }; for i in 1 2; do echo "iter=$i"; f; done', "iter=1\nref=a b\niter=2\nref=a b\n"],
  ["changing indirect target", 'x=value; ptr=x; for i in x "arr[0]"; do echo "iter=$i"; ptr=$i; y="${!ptr}"; done', "iter=x\niter=arr[0]\n"],
] as const) {
  test(`${label} does not replay loop effects`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, stdout);
  });
}

test("empty indirect target reports its error without replay", async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('ptr=""; for i in 1 2; do echo "iter=$i"; y="${!ptr}"; done');
  assert.equal(result.stdout, "iter=1\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /invalid variable name/);
});

for (const selector of ["1", "@", "*", "0"]) {
  test(`subscripted nameref rejects additional [${selector}]`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec('arr=(zero one); declare -n ref="arr[0]"; echo "${ref[' + selector + ']}"');
    assert.equal(result.stdout, "");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /bad substitution/);
  });
}
