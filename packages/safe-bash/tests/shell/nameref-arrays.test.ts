import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

const cases = [
  ['a=(a b c); declare -n r=a; read -a r <<< "x y z"; args "${a[*]}" "${r[*]}"', ["x y z", "x y z"]],
  ['a=(a b c); declare -n r=a; mapfile -t r <<< $\'u\\nv\'; args "${a[*]}"', ["u v"]],
  ['a=(a b c); declare -n r=a; readarray -t r <<< $\'u\\nv\'; args "${a[*]}"', ["u v"]],
  ['declare -n r=target; declare -i r=2+3; target=4+5; args "$target" "$r"', ["9", "9"]],
  ['declare -n r=target; declare -u r=hello; target=world; args "$target"', ["WORLD"]],
  ['declare -n r=target; declare -l r=HELLO; target=WORLD; args "$target"', ["world"]],
  ['f(){ local -n r=target; local -i r=2+3; target=4+5; }; f; args "$target"', ["9"]],
  ['f(){ local r=target; local -n r; r=Z; }; f; args "$target"', ["Z"]],
  ['declare -n r=target; declare -u r; declare +u r; target=hello; args "$r"', ["hello"]],
  ['declare -n r=target; declare -x r; declare +x r; envget target', "<unset>"],
  ['a=(a b c); f(){ local -n r=a; read -a r <<< "x y"; }; f; args "${a[*]}"', ["x y"]],
  ['a=(a b c); f(){ local -n r=a; mapfile -t r <<< $\'u\\nv\'; }; f; args "${a[*]}"', ["u v"]],
  ['a=(a b c); f(){ local -n r=a; readarray -t r <<< $\'u\\nv\'; }; f; args "${a[*]}"', ["u v"]],
  ['f(){ local -n r=target; local -u r=hello; target=world; }; f; args "$target"', ["WORLD"]],
  ['f(){ local -n r=target; local -l r=HELLO; target=WORLD; }; f; args "$target"', ["world"]],
  ['target=hello; f(){ local -n r=target; local -x r; }; f; envget target', "hello"],
  ['declare -n r="a[1]"; r=Z; args "$r" "${a[1]}"', ["Z", "Z"]],
  ['target=hello; declare -n r=target; declare -x r; envget target', "hello"],
  ['a=(a b c); read "a[1]" <<< X; args "${a[*]}"', ["a X c"]],
  ['declare -A a; a[key]=old; read "a[key]" <<< X; args "${a[key]}"', ["X"]],
  ['a=(a b c); declare -n r="a[1]"; r=Z; args "${a[*]}" "$r" "${r^^}" "${r:-default}"', ["a Z c", "Z", "Z", "Z"]],
  ['declare -A a; a[key]=old; declare -n r="a[key]"; r=Z; args "${a[key]}" "$r"', ["Z", "Z"]],
  ['a=(a b c); declare -n r="a[1]"; read r <<< X; args "${a[*]}" "$r"', ["a X c", "X"]],
  ['a=(a b c); declare -n r="a[1]"; r+=Z; args "${a[*]}"', ["a bZ c"]],
  ['a=(a b c); declare -n r="a[1]"; declare r+=Z; args "${a[*]}"', ["a bZ c"]],
  ['a=(a b c); declare -n r="a[1]"; declare -u r=hello; args "${a[*]}" "$r"', ["a HELLO c", "HELLO"]],
  ['a=(a b c); declare -n r=a; declare r=Z; args "${a[*]}"', ["Z b c"]],
  ['a=(a b c); declare -n r=a; read -r "r[1]" <<< X; args "${a[*]}"', ["a X c"]],
  ['a=(10 20 30); declare -n r="a[i]"; i=1; declare -n s=r; ((s+=5)); i=2; args "$s" "${a[*]}"', ["30", "10 25 30"]],
  ['declare -A a; a[key]=10; declare -n r="a[key]"; ((r+=5)); args "$r"; unset r; [[ ! -v r ]]', ["15"]],
  ['f(){ local -n r="a[1]"; r=Z; }; a=(a b c); f; args "${a[*]}"', ["a Z c"]],
  ['a=(10 20 30); declare -n r="a[1]"; args "$((r+5))"; ((r=99)); args "${a[*]}"', '["25"]["10 99 30"]'],
  ['a=(a b c); declare -n r="a[1]"; [[ -v r ]] || exit 9; unset r; args "${!a[@]}" "${a[*]}"; [[ ! -v r ]]', ["0", "2", "a c"]],
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
    if (typeof expected === "string") assert.equal(result.stdout, expected);
    else assert.deepEqual(JSON.parse(result.stdout), expected);
  });
}

for (const source of [
  'declare -n r=bad-name; args "$?"; [[ ! -R r ]]',
  'f(){ local r=bad-name; local -n r; args "$?"; [[ ! -R r ]]; }; f',
  'r=bad-name; declare -n r; args "$?"; [[ ! -R r ]]',
  'declare -n r=""; args "$?"; [[ ! -R r ]]',
]) test(`reject invalid nameref target: ${source}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["1"]);
  assert.ok(result.stderr.includes("invalid name reference"));
});

test("element references preserve owned bytes through read and expansion", async context => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  context.after(() => shell.dispose());
  const result = await shell.exec('a=(old); declare -n r="a[0]"; read -r r <<< "$(printf "\\377")"; printf %s "$r"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual([...result.stdoutBytes], [255]);
});

test("declaration readonly attribute protects the referenced target", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('target=old; declare -n r=target; declare -r r; target=new');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("readonly variable"));
});

test("local readonly attribute protects the referenced target", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec('target=old; f(){ local -n r=target; local -r r; target=new; }; f');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("readonly variable"));
});
