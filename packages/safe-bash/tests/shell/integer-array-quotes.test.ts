import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { nativeOptions, runNative } from "./extensions/trap/oracle.js";

for (const source of [
  'a=(10 20); declare -i z; z=a[1]+5; echo "z=$z"',
  'a=(10 20); declare -i z; z=a+5; echo "z=$z"',
  'a=(10 20); declare -i z=a[1]+5; echo "$z"',
  'a=(10 20); declare -i z=3; z+=a[1]+5; echo "$z"',
  'a=(10 20); i=0; declare -i z; z="a[i++]+a[i]"; echo "$z:$i"',
  'a=(10 20); declare -i z; z="a[1]++"; echo "$z:${a[1]}"',
  'a=(10 20); declare -i z; z="(a[1]=3)+2"; echo "$z:${a[1]}"',
  'a=(10 20); declare -ai b; b[0]="a[1]+5"; echo "${b[0]}"',
  "(( '5' == 5 )); echo $?",
  String.raw`(( 1 + \2 == 3 )); echo $?`,
  "for (( i='0'; i<'2'; i++ )); do echo \"i=$i\"; done",
  String.raw`for (( i=\0; i<\2; i++ )); do echo "i=$i"; done`,
  "n=5; (( 'n' == 5 )); echo $?",
  "(( 1 '2' )); echo $?",
  String.raw`(( 1 \2 )); echo $?`,
  String.raw`(( !\2 )); echo $?`,
  'n=5; (( "$n" == 5 )); echo $?',
  '(( $(echo 5) == 5 )); echo $?',
]) test(`integer array and arithmetic quotes: ${source}`, nativeOptions(), async t => {
  const native = runNative(source);
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stdout, native.stdout.toString());
  assert.equal(result.stderr, native.stderr.toString());
  assert.equal(result.exitCode, native.status);
});
