import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [source, expected, diagnostic] of [
  ['arr=(a b c); for ((i=0;i<2;i++)); do unset "arr[@]"; done; printf "%s" "${#arr[@]}"', '0', false],
  ['arr=(a b c); for ((i=0;i<2;i++)); do unset "arr[*]"; done; printf "%s" "${#arr[@]}"', '0', false],
  ['declare -A map=([a]=1 [b]=2); for ((i=0;i<1;i++)); do unset "map[@]"; done; printf "%s" "${#map[@]}"', '2', false],
  ['declare -A map=([a]=1 [b]=2); for ((i=0;i<1;i++)); do unset "map[*]"; done; printf "%s" "${#map[@]}"', '2', false],
  ['arr=(a b c d e f); for ((i=0;i<2;i++)); do unset "arr[i*2+1]"; done; printf "%s:%s:%s" "${#arr[@]}" "${arr[1]-U}" "${arr[3]-U}"', '4:U:U', false],
  ['arr=(a b c d); j=1; for ((i=0;i<2;i++)); do unset arr[i+j]; done; printf "%s" "${#arr[@]}"', '2', false],
  ['arr=(a b c d); for ((i=0;i<2;i++)); do unset "arr[(i+1)]"; done; printf "%s" "${#arr[@]}"', '2', false],
  ['arr=(a b); for ((i=0;i<1;i++)); do unset "arr[-10]"; st=$?; done; printf "%s:%s" "$st" "${#arr[@]}"', '1:2', true],
  ['arr=(a b); unset "arr[-10]"; printf "%s" "$?"', '1', true],
  ['arr=(a b c); for ((i=1;i<2;i++)); do unset "arr[-i]"; done; printf "%s:%s" "${#arr[@]}" "${arr[2]-U}"', '2:U', false],
  ['arr=(a b c); for ((i=0;i<2;i++)); do unset "arr[1]"; done; printf "%s:%s" "${#arr[@]}" "${arr[1]-U}"', '2:U', false],
  ['arr=(a b); unset "arr[-10]" 2>/dev/null; printf "%s" "$?"', '1', false],
  ['declare -A map=([a]=1 [b]=2); unset "map[@]"; printf "%s" "${#map[@]}"', '2', false],
  ['declare -A map=(["*"]=star ["@"]=at [k]=keep); for ((i=0;i<1;i++)); do unset "map[*]" "map[@]"; done; printf "%s:%s" "${#map[@]}" "${map[k]}"', '1:keep', false],
] as const) test(`unset compatibility: ${source}`, async t => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stdout, expected);
  assert.equal(result.exitCode, 0);
  if (diagnostic) assert.match(result.stderr, /bad array subscript/);
  else assert.equal(result.stderr, "");
});
