import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

for (const [name, source, expected] of [
  ["array backslashes", "s='a\\b c'; arr=(init); for ((i=1;i<=2;i++)); do arr=( $s ); done; printf '%d:%s|%s\\n' \"${#arr[@]}\" \"${arr[0]}\" \"${arr[1]}\"", "2:a\\b|c\n"],
  ["array unmatched globs", "s='item[0] val?1 a*b'; arr=(init); for ((i=1;i<=2;i++)); do arr=( $s ); done; printf '%d:%s|%s|%s\\n' \"${#arr[@]}\" \"${arr[0]}\" \"${arr[1]}\" \"${arr[2]}\"", "3:item[0]|val?1|a*b\n"],
  ["array changing IFS", "s=a:b:c; arr=(init); for ((i=1;i<=2;i++)); do IFS=:; arr=( $s ); done; IFS=' '; printf '%d:%s|%s|%s\\n' \"${#arr[@]}\" \"${arr[0]}\" \"${arr[1]}\" \"${arr[2]}\"", "3:a|b|c\n"],
  ["nested for changing IFS", "s=a:b:c; out=; for ((i=1;i<=2;i++)); do IFS=:; for x in $s; do out+=\"$x,\"; done; done; echo \"out=[$out]\"", "out=[a,b,c,a,b,c,]\n"],
  ["array arithmetic substring", "s=0123456789; arr=(init); for ((i=1;i<=2;i++)); do arr=( ${s:i*2+1:3} ); done; printf '%d:%s\\n' \"${#arr[@]}\" \"${arr[0]}\"", "1:567\n"],
  ["nested for arithmetic substring", "s='0 1 2 3 4 5 6'; out=; for ((i=0;i<=1;i++)); do for x in ${s:i*2+1:3}; do out+=\"$x,\"; done; done; echo \"out=[$out]\"", "out=[1,2,]\n"],
  ["array dynamic pattern", "s='a b c'; sub=b; arr=(init); for ((i=1;i<=2;i++)); do arr=( ${s#*$sub} ); done; printf '%d:%s\\n' \"${#arr[@]}\" \"${arr[0]}\"", "1:c\n"],
  ["nested for dynamic pattern", "s='a b c'; sub=b; out=; for ((i=1;i<=2;i++)); do for x in ${s#*$sub}; do out+=\"$x,\"; done; done; echo \"$out\"", "c,c,\n"],
  ["tr unbounded repeat", "for ((i=1;i<=2;i++)); do r=$(echo abc | tr abc '[x*]'); done; echo \"r=[$r]\"", "r=[xxx]\n"],
  ["tr counted repeat", "for ((i=1;i<=2;i++)); do r=$(echo abc | tr abc '[x*3]'); done; echo \"r=[$r]\"", "r=[xxx]\n"],
] as const) for (const loop of ["arithmetic", "words"]) test(`loop expansion regression: ${name} (${loop})`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const command of [...basicCommands(), ...streamCommands()]) shell.commands.register(command);
  context.after(() => shell.dispose());
  const script = loop === "arithmetic" ? source : source
    .replace("for ((i=1;i<=2;i++))", "for i in 1 2")
    .replace("for ((i=0;i<=1;i++))", "for i in 0 1");
  const result = await shell.exec(script);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
