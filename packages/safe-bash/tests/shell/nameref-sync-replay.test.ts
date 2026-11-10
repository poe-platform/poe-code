import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [label, source, stdout] of [
  ["quoted prefix names", 'pre_1=a; pre_2=b; for i in 1 2; do echo "iter=$i"; echo "${!pre@}"; done', "iter=1\npre_1 pre_2\niter=2\npre_1 pre_2\n"],
  ["prefix names as function arguments", 'pre_1=a; pre_2=b; f(){ echo "$#:$1:$2"; }; for i in 1 2; do echo "iter=$i"; f "${!pre@}"; done', "iter=1\n2:pre_1:pre_2\niter=2\n2:pre_1:pre_2\n"],
  ["prefix names created during function-call loop", 'pre_1=a; f(){ echo "$#:$1:$2"; }; for i in 1 2; do echo "iter=$i"; f "${!pre@}"; pre_2=b; done', "iter=1\n1:pre_1:\niter=2\n2:pre_1:pre_2\n"],
  ["empty prefix names as function arguments", 'f(){ echo "$#:$1:$2"; }; for i in 1 2; do echo "iter=$i"; f "${!absent_prefix_@}"; done', "iter=1\n0::\niter=2\n0::\n"],
  ["quoted star prefix names as scalar function argument", 'pre_1=a; pre_2=b; IFS=:; f(){ echo "$#:$1:$2"; }; for i in 1 2; do echo "iter=$i"; f "${!pre*}"; done', "iter=1\n1:pre_1:pre_2:\niter=2\n1:pre_1:pre_2:\n"],
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

for (const bounded of [false, true]) for (const loop of [false, true]) {
  for (const [expansion, count] of [
    ['"${ref[0]}"', 1], ['"${ref[1]}"', 1], ['"${ref[*]}"', 1], ['"${ref[@]}"', 0],
    ['${ref[0]}', 0], ['${ref[1]}', 0], ['${ref[*]}', 0], ['${ref[@]}', 0],
  ] as const) test(`subscripted element nameref: ${expansion}, bounded=${bounded}, loop=${loop}`, async context => {
    const body = `set -- ${expansion}; printf '%s:<%s>' "$#" "$*";`;
    const source = `arr=(zero one); declare -n ref="arr[1]"; ${loop ? `for i in 1 2; do ${body} done;` : body} printf '<%s>end' "$ref"`;
    const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C", PATH: process.env.PATH } });
    assert.equal(native.error, undefined);
    assert.equal(native.status, 0);
    assert.equal(native.stderr.length, 0);
    assert.equal(native.stdout.toString(), `${`${count}:<>`.repeat(loop ? 2 : 1)}<one>end`);

    const { shell, commands } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
    context.after(() => shell.dispose());
    for (const command of basicCommands()) commands.register(command);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array(native.stdout));
  });
}

test("element nameref and subscripted expansion can share a command", async context => {
  const { shell, commands } = setup();
  context.after(() => shell.dispose());
  for (const command of basicCommands()) commands.register(command);
  const result = await shell.exec('a=(one two); declare -n r="a[1]"; printf "<%s>" "$r" "${r[0]}"; printf end');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "<two><>end");
});

test("subscripted element nameref evaluates its index and unset operators", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('a=(one two); i=0; declare -n r="a[1]"; args "${r[i++]}" "$i" "${r[0]:-fallback}" "${#r[0]}" "$r"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), ["", "1", "fallback", "0", "two"]);
});

for (const selector of ["0", "@", "*"]) test(`subscripted element nameref cannot assign an invalid array name: ${selector}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`a=(one two); declare -n r="a[1]"; args "\${r[${selector}]:=new}"; args end`);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /invalid variable name/);
});
