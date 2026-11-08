import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";

for (const [script, expected] of [
  ['arr=(10 20); say "$((arr + 5))"; x=$((arr + 5)); say "$x"', '15\n15\n'],
  ['arr=(10 20); i=0; ((i++, arr + 1)); say "$i"; x=$((i++, arr + 1)); say "$i:$x"', '1\n2:11\n'],
  ['declare -ia arr=(10 20); arr+=("arr[0] + 5" "arr[2] + 1"); say "${arr[@]}"', '10 20 15 16\n'],
  ['declare -ia arr; arr=([0]="10" [1]="arr[0] + 5"); say "${arr[@]}"', '10 15\n'],
  ['declare -ia arr=(10 "arr[0]+5"); say "${arr[@]}"', '10 15\n'],
  ['declare -ia arr=(99 88); arr=("arr[1]+1" "arr[0]+2"); say "${arr[@]}"', '1 3\n'],
  ['declare -ia arr=(10 20); arr+=([0]+=5 [1]="arr[0]+1"); say "${arr[@]}"', '15 16\n'],
  ['declare -ia arr=(10); i=0; arr+=("i++, arr[0]+1" "i++, arr[1]+1"); say "$i:${arr[@]}"', '2:10 11 12\n'],
  ['declare -ia arr=(10 20); arr+=("arr[0]=99, 30" "arr[2]+1"); say "${arr[@]}"', '99 20 30 31\n'],
  ['declare -ria arr=(10 "arr[0]+5"); say "${arr[@]}"; arr[0]=3', '10 15\n'],
  ['arr=(1 2); say "${arr[arr[0]]}"; arr=(10 20); x=${arr[arr[0]/10]}; say "$x"', '2\n20\n'],
  ['arr=([0]=10 [arr[0]+1]=20); say "${!arr[@]}:${arr[@]}"', '0 11:10 20\n'],
  ['arr=(10 20); arr[1]=$((arr[0]=99, 55)); say "${arr[@]}"', '99 55\n'],
  ['arr=(10 20); arr+=($((arr[0]=99, 30))); say "${arr[@]}"', '99 20 30\n'],
] as const) test(`array arithmetic observes sequential assignments: ${script}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(script);
    if (script.startsWith('declare -r')) {
      assert.ok(result.stderr.includes('readonly'), result.stderr);
      assert.notEqual(result.exitCode, 0);
    } else {
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    }
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const kind of ["a", "A"]) {
  for (const [attribute, initial, assigned, appended, expected] of [
    ["i", "1+2", "5+6", "2*5", "13:11:15"],
    ["l", "HELLO", "WORLD", "FOO", "hellofoo:world:bar"],
    ["u", "hello", "world", "foo", "HELLOFOO:WORLD:BAR"],
  ]) test(`${kind} array ${attribute} transforms compound, element and zero writes`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const zero = attribute === "i" ? "2+3" : "bAr";
      const result = await shell.exec(`declare -${kind}${attribute} v=([0]=${initial}); v[1]=${assigned}; v[0]+=${appended}; printf '%s:' "\${v[0]}"; printf '%s:' "\${v[1]}"; v=${zero}; v+=${attribute === "i" ? "10" : ""}; printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
  for (const local of [false, true]) test(`${kind} readonly declaration without initializer (${local ? "local" : "global"})`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const body = `declare -${kind} v=([0]=old); ${local ? "local" : "declare"} -${kind}r v; v[0]=new`;
      const result = await shell.exec(local ? `f(){ ${body}; }; f` : body);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("readonly"), result.stderr);
    } finally { await shell.dispose(); }
  });
}

for (const kind of ["a", "A"]) {
  for (const attribute of ["i", "l", "u"]) test(`${kind} ${attribute} attributes on declarations without initializers and local restoration`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const value = attribute === "i" ? "3+4" : "MiXeD";
      const expected = attribute === "i" ? "7" : attribute === "l" ? "mixed" : "MIXED";
      const result = await shell.exec(`declare -${kind} v=([0]=outer); f(){ local -${kind}${attribute} v; v[0]=${value}; printf '%s:' "\${v[0]}"; }; f; printf '%s:' "\${v[0]}"; declare -${kind}${attribute} v; v[0]=${value}; printf '%s:' "\${v[0]}"; declare +${attribute} v; v[0]=${value}; printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `${expected}:outer:${expected}:${value}`);
    } finally { await shell.dispose(); }
  });
  test(`${kind} integer compound replacement and append`, async () => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    try {
      const result = await shell.exec(`declare -${kind}i v=([0]=2); v+=([0]+=3*4 [1]=5+6); printf '%s:%s:' "\${v[0]}" "\${v[1]}"; v=([0]=6*7); printf '%s' "\${v[0]}"`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "14:11:42");
    } finally { await shell.dispose(); }
  });
}
