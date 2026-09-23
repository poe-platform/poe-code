import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [source, expected] of [
  ['declare a=hello; printf %s "$a"', 'hello'],
  ['declare -i a=1; a="2+3"; printf %s "$a"', '5'],
  ['declare -l a=HELLO; a=WORLD; printf %s "$a"', 'world'],
  ['declare -u a=hello; printf %s "$a"', 'HELLO'],
  ['declare -n ref=target; target=hello; printf %s "$ref"; ref=world; printf %s "$target"', 'helloworld'],
  ['declare -x VALUE=hello; sh -c \'printf %s "$VALUE"\'', 'hello'],
  ['f(){ declare -g a=hello; }; f; printf %s "$a"', 'hello'],
  ['a=outer; f(){ declare a=inner; printf %s "$a"; }; f; printf %s "$a"', 'innerouter'],
  ['declare -i a=7; f(){ declare -I a; a=2+3; printf "[%s]" "$a"; }; f; printf "[%s]" "$a"', '[5][7]'],
  ['f(){ printf SYNTHETIC; }; declare -F f', 'f\n'],
  ['f(){ printf SYNTHETIC; }; declare -f f', 'f () \n{ \n    printf SYNTHETIC\n}\n'],
  ['f(){ printf SYNTHETIC; }; declare -ft f; printf %s "$?"', '0'],
  ['declare -i a=7; (a=2+3; printf %s "$a"); printf %s "$a"', '57'],
  ['declare -i a=7; declare +i a; a=2+3; printf %s "$a"', '2+3'],
  ['declare -r a=old; declare a=new; printf %s "$a"', 'old'],
  ['a=outer; f(){ declare -r a=inner; printf %s "$a"; }; f; a=new; printf %s "$a"', 'innernew'],
  ['declare -i target=1; declare -n ref=target; ref=2+3; printf %s "$ref"', '5'],
  ['declare -a a; a[1]=hello; printf %s "${a[1]}"', 'hello'],
  ['declare -l a; a=$(printf "\\377ABC"); printf %s "$a"', '\ufffdabc'],
] as const) test(`declare: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    if (!source.startsWith('declare -r')) assert.equal(result.stderr, "");
    else assert.ok(result.stderr.includes("readonly variable"));
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});
