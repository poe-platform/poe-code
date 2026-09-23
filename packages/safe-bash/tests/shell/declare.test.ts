import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { createStandardCommands } from "../../src/commands/index.js";

for (const [source, expected, diagnostic] of [
  ['f(){ printf hello; }; readonly -f f; f(){ printf changed; }; f', 'hello', 'f: readonly function'],
  ['f(){ printf hello; }; readonly -f f; f(){ printf changed; }; printf "%s:" "$?"; f', '1:hello', 'f: readonly function'],
  ['f(){ printf hello; }; readonly -f f; unset -f f; printf "%s:" "$?"; f', '1:hello', 'unset: f: cannot unset: readonly function'],
  ['readonly -f missing; printf %s "$?"', '1', 'readonly: missing: not a function'],
  ['f(){ printf hello; }; readonly -f f; (f(){ printf changed; }; f); f', 'hellohello', 'f: readonly function'],
  ['f(){ printf hello; }; (readonly -f f); f(){ printf changed; }; f', 'changed', ''],
  ['f=variable; f(){ printf hello; }; readonly -f f; unset -v f; f', 'hello', ''],
  ['f(){ printf hello; }; unset -f f; declare -F f; printf %s "$?"', '1', ''],
  ['f(){ printf hello; }; readonly -fp f; readonly -f', 'f () \n{ \n    printf hello\n}\ndeclare -fr f\n', ''],
] as const) test(`readonly functions: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
    if (diagnostic) assert.ok(result.stderr.includes(diagnostic), result.stderr);
    else assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

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

for (const [source, expected] of [
  ['VALUE=hello; export VALUE; export -n VALUE; sh -c \'printf %s "${VALUE-unset}"\'; printf ":%s" "$VALUE"', 'unset:hello'],
  ['export VALUE=old; export -n VALUE=new; bash -c \'printf %s "${VALUE-unset}"\'; printf ":%s" "$VALUE"', 'unset:new'],
  ['readonly VALUE=hello; export VALUE; export -n VALUE; envget VALUE; printf ":%s" "$VALUE"', '<unset>:hello'],
  ['f(){ printf hello; }; export -f f; bash -c f', 'hello'],
  ['f(){ printf hello; }; export -f f; bash -c \'bash -c f\'', 'hello'],
  ['f(){ printf old; }; export -f f; f(){ printf new; }; bash -c f', 'new'],
  ['f(){ printf hello; }; export -f f; export -fn f; bash -c \'type -t f\'; f', 'hello'],
  ['f(){ printf hello; }; export -f f; (export -fn f); bash -c f', 'hello'],
  ['f(){ printf hello; }; export -f f; env -i bash -c \'type -t f\'; printf %s "$?"', '1'],
  ['export AUDIT=SYNTHETIC; export -p', 'declare -x AUDIT="SYNTHETIC"\ndeclare -x PWD="/"\n'],
  ['export AUDIT=\'a"b\\c$`\'; export -p', 'declare -x AUDIT="a\\"b\\\\c\\$\\`"\ndeclare -x PWD="/"\n'],
  ["export AUDIT='a\nb'; export -p", "declare -x AUDIT=$'a\\nb'\ndeclare -x PWD=\"/\"\n"],
  ['export ABSENT; export -p', 'declare -x ABSENT\ndeclare -x PWD="/"\n'],
  ['export -p AUDIT=hello; envget AUDIT', 'hello'],
  ['f(){ printf hello; }; export -f f; export -fp', 'f () \n{ \n    printf hello\n}\ndeclare -fx f\n'],
  ['f(){ printf hello; }; export -f f; export -f', 'f () \n{ \n    printf hello\n}\ndeclare -fx f\n'],
  ['f(){ printf hello; }; export -f f; printf "f\\n" > script.sh; bash script.sh', 'hello'],
  ['f(){ printf hello; }; g(){ printf private; }; export -f f; bash -c \'type -t g\'; printf %s "$?"', '1'],
  ['export -- VALUE=hello; export -np VALUE; envget VALUE', '<unset>'],
  ['export -f missing; printf %s "$?"', '1'],
  ['export -z; printf %s "$?"', '2'],
] as const) test(`export: ${source}`, async () => {
  const { shell, commands } = setup();
  for (const command of createStandardCommands()) commands.register(command);
  try {
    const result = await shell.exec(source);
    assert.equal(result.stdout, expected);
    if (source.startsWith('export -f missing')) assert.ok(result.stderr.includes('not a function'));
    else if (source.startsWith('export -z')) assert.ok(result.stderr.includes('invalid option'));
    else assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

test('exported functions respect env -i in script shebangs', async t => {
  const { shell, fs, commands } = setup();
  for (const command of basicCommands()) commands.register(command);
  t.after(() => shell.dispose());
  await fs.writeFile('/script.sh', new TextEncoder().encode('#!/usr/bin/env -S -i bash\ntype -t f\n'), { mode: 0o755 });
  const result = await shell.exec('f(){ printf hello; }; export -f f; ./script.sh; printf %s "$?"');
  assert.equal(result.stdout, '1');
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
});
